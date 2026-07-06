import { env, runInDurableObject } from 'cloudflare:test'
import { it, expect, describe } from 'vitest'
import { AIAgent } from '@viota/engine'
import { GameRepository, type SqlLike } from '../src/do/storage'
import { serializeState } from '../src/do/state-codec'
import { replay } from '../src/do/replay'
import { applyAndPersist } from '../src/do/apply'
import { driveIfAI, toMovePayload } from '../src/do/drive'
import { hasTimer } from '../src/do/timers'
import { seedLiveGame } from './helpers'

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

const NOW = 5_000_000
/** DriveDeps with a spy nudge. `state` is the DurableObjectState (has storage). */
function deps(state: any, sink?: number[]) {
  return { ctx: state, nudge: (i: number) => sink?.push(i) }
}

/** Apply a human move (engine-generated, legal) for the current seat. */
function playHuman(state: any, sql: SqlLike, repo: GameRepository, seat: number, tag: string) {
  const move = toMovePayload(AIAgent('medium')(repo.getSnapshot()!, seat))
  return state.storage.transactionSync(() =>
    applyAndPersist(sql, repo, { seatIndex: seat, move, clientMoveId: tag, accountId: `acct-${seat}`, now: NOW }),
  )
}

describe('driveIfAI', () => {
  it('drives ONE medium AI move for a covered current seat and paces the next with an ai_step', async () => {
    await runInDurableObject(stubFor('drive-one'), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      // seats 0 and 1 AI (so the turn advances to another AI seat -> a tick is armed)
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [0, 1], presentSeats: [0], now: NOW })
      const nudges: number[] = []

      driveIfAI(deps(state, nudges), repo, sql, NOW)

      // exactly one AI move committed, turn advanced to the other AI seat
      const rows = repo.getMovesSince(0)
      expect(rows.length).toBe(1)
      expect(rows[0]!.by_ai).toBe(true)
      expect(rows[0]!.ai_difficulty).toBe('medium')
      expect(rows[0]!.client_move_id).toBe('ai:0:1') // deterministic id
      expect(nudges).toEqual([1])
      // next seat (1) is AI -> a paced ai_step is armed for it
      expect(hasTimer(sql, 'ai_step', 1)).toBe(true)
    })
  })

  it('FREEZES (drives nothing) when no human is present', async () => {
    await runInDurableObject(stubFor('drive-freeze'), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      // AI seat but NOBODY present (no fresh last_seen_at anywhere)
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [0, 1], presentSeats: [], now: NOW })
      driveIfAI(deps(state), repo, sql, NOW)
      expect(repo.getMovesSince(0).length).toBe(0) // frozen
    })
  })

  it('does nothing on a human seat turn (but arms a soft AFK deadline once)', async () => {
    await runInDurableObject(stubFor('drive-human-turn'), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [1], presentSeats: [0], now: NOW })
      // current seat is 0 (human, present)
      driveIfAI(deps(state), repo, sql, NOW)
      expect(repo.getMovesSince(0).length).toBe(0)
      expect(hasTimer(sql, 'soft', 0)).toBe(true) // present idler protection
    })
  })

  it('FLAGSHIP: drives a full 4-player all-AI-covered game to a natural end (never stalls)', async () => {
    await runInDurableObject(stubFor('drive-flagship-a'), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      // all four seats AI-covered, one human watching (present) -> the loop must
      // carry the ENTIRE game to a terminal state via chained drives.
      const { repo } = seedLiveGame(sql, { playerCount: 4, aiSeats: [0, 1, 2, 3], presentSeats: [0], now: NOW })
      const nudges: number[] = []

      let steps = 0
      while (repo.getMeta()!.status === 'active' && steps < 600) {
        driveIfAI(deps(state, nudges), repo, sql, NOW) // constant now: watcher stays present
        steps++
      }

      const meta = repo.getMeta()!
      expect(meta.status === 'completed' || meta.status === 'stalemate').toBe(true)
      const rows = repo.getMovesSince(0)
      expect(rows.length).toBeGreaterThan(8) // multiple turn wrap-arounds
      expect(rows.every((r) => r.by_ai)).toBe(true) // every move is a driven AI move
      expect(nudges.length).toBe(rows.length) // a nudge per committed AI move
      // the log is legal + complete: replay == live snapshot, byte-for-byte
      expect(serializeState(replay(repo.getInitialState()!, rows))).toBe(serializeState(repo.getSnapshot()!))
    })
  })

  it('FLAGSHIP: drives the single AI seat on EVERY one of its turns while humans play, to the end', async () => {
    await runInDurableObject(stubFor('drive-flagship-b'), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const AI_SEAT = 3
      const { repo } = seedLiveGame(sql, {
        playerCount: 4,
        aiSeats: [AI_SEAT],
        presentSeats: [0, 1, 2],
        now: NOW,
      })

      let steps = 0
      let aiTurns = 0
      let aiDriven = 0
      while (repo.getMeta()!.status === 'active' && steps < 900) {
        const cur = repo.getMeta()!.current_seat
        const before = repo.getMeta()!.move_index
        if (cur === AI_SEAT) {
          aiTurns++
          driveIfAI(deps(state), repo, sql, NOW)
          if (repo.getMeta()!.move_index > before) aiDriven++ // an AI move committed this turn
        } else {
          playHuman(state, sql, repo, cur, `h-${steps}`)
        }
        steps++
      }

      const meta = repo.getMeta()!
      expect(meta.status === 'completed' || meta.status === 'stalemate').toBe(true)
      expect(aiTurns).toBeGreaterThan(3) // multiple wrap-arounds
      expect(aiDriven).toBe(aiTurns) // NO STALL: every AI turn produced a move
      const rows = repo.getMovesSince(0)
      expect(rows.filter((r) => r.seat_index === AI_SEAT).every((r) => r.by_ai)).toBe(true)
      expect(rows.filter((r) => r.seat_index !== AI_SEAT).every((r) => !r.by_ai)).toBe(true)
      expect(serializeState(replay(repo.getInitialState()!, rows))).toBe(serializeState(repo.getSnapshot()!))
    })
  })

  it('a reclaim mid-AI-chain makes the next drive a no-op (AI does not play for a returned seat)', async () => {
    await runInDurableObject(stubFor('drive-reclaim-noop'), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const { repo } = seedLiveGame(sql, { playerCount: 4, aiSeats: [0, 1, 2, 3], presentSeats: [0], now: NOW })

      driveIfAI(deps(state), repo, sql, NOW) // drive seat 0 -> turn 1
      driveIfAI(deps(state), repo, sql, NOW) // drive seat 1 -> turn 2
      const beforeReclaim = repo.getMeta()!.move_index
      expect(repo.getMeta()!.current_seat).toBe(2)

      // The human for seat 2 RETURNS mid-chain: clear AI control on their seat.
      repo.setControlledByAi(2, false)

      driveIfAI(deps(state), repo, sql, NOW) // next iteration must be a NO-OP
      expect(repo.getMeta()!.move_index).toBe(beforeReclaim) // nothing committed
      const rows = repo.getMovesSince(0)
      expect(rows.some((r) => r.seat_index === 2)).toBe(false) // AI never played seat 2
    })
  })
})

describe('reclaim-race guard (must-fix #4, in-txn abort)', () => {
  it('aborts an AI move whose seat is no longer controlled_by_ai — writing nothing', async () => {
    await runInDurableObject(stubFor('drive-guard-control'), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [0], presentSeats: [0], now: NOW })
      // current seat 0, but the human reclaimed (controlled_by_ai=0) between the
      // drive loop's decision and the commit.
      repo.setControlledByAi(0, false)
      const move = toMovePayload(AIAgent('medium')(repo.getSnapshot()!, 0))
      const r = state.storage.transactionSync(() =>
        applyAndPersist(sql, repo, {
          seatIndex: 0,
          move,
          clientMoveId: 'ai:0:1',
          accountId: null,
          byAi: true,
          aiDifficulty: 'medium',
          expectedSeat: 0,
          requireAiControlled: true,
          now: NOW,
        }),
      )
      expect(r).toEqual({ error: 'reclaimed' })
      expect(repo.getMovesSince(0).length).toBe(0)
      expect(repo.getMeta()!.move_index).toBe(0)
    })
  })

  it('aborts an AI move when the turn has already advanced past the expected seat', async () => {
    await runInDurableObject(stubFor('drive-guard-turn'), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [0, 1], presentSeats: [0], now: NOW })
      // The turn is on seat 0, but this stale AI move targets seat 1.
      const move = toMovePayload(AIAgent('medium')(repo.getSnapshot()!, 1))
      const r = state.storage.transactionSync(() =>
        applyAndPersist(sql, repo, {
          seatIndex: 1,
          move,
          clientMoveId: 'ai:1:1',
          accountId: null,
          byAi: true,
          expectedSeat: 1,
          requireAiControlled: true,
          now: NOW,
        }),
      )
      expect(r).toEqual({ error: 'reclaimed' })
      expect(repo.getMovesSince(0).length).toBe(0)
    })
  })
})
