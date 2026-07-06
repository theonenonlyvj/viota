import { SELF, env, runInDurableObject } from 'cloudflare:test'
import { it, expect, describe } from 'vitest'
import { GameRepository, type MoveRow, type SqlLike } from '../src/do/storage'
import { serializeState } from '../src/do/state-codec'
import { replay } from '../src/do/replay'
import { applyAndPersist } from '../src/do/apply'
import { computeReversibleTail } from '../src/do/veto'
import { seedScriptedGame } from './helpers'
import { authHeaders, mintToken } from './helpers'

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

// --- Unit: the reversible-tail predicate ------------------------------------
function mrow(over: Partial<MoveRow>): MoveRow {
  return {
    move_index: 1, turn_number: 1, seat_index: 0, type: 'play', payload: '{}',
    score_delta: 0, score_after: 0, by_ai: false, ai_difficulty: null,
    controlling_account_id: null, client_move_id: null, reverted: false, created_at: 0,
    ...over,
  }
}
const idx = (rows: MoveRow[]) => rows.map((r) => r.move_index)

describe('computeReversibleTail', () => {
  it('is empty when the last non-reverted row is not by_ai on the seat', () => {
    const rows = [mrow({ move_index: 1, by_ai: true, seat_index: 0 }), mrow({ move_index: 2, by_ai: false, seat_index: 0 })]
    expect(computeReversibleTail(rows, 0)).toEqual([])
  })

  it('is a single trailing AI move on the seat', () => {
    const rows = [mrow({ move_index: 1, by_ai: false, seat_index: 1 }), mrow({ move_index: 2, by_ai: true, seat_index: 0 })]
    expect(idx(computeReversibleTail(rows, 0))).toEqual([2])
  })

  it('spans a WHOLE AI turn: a wild_recycle + play pair on the seat', () => {
    const rows = [
      mrow({ move_index: 1, by_ai: false, seat_index: 1 }),
      mrow({ move_index: 2, by_ai: true, seat_index: 0, type: 'wild_recycle' }),
      mrow({ move_index: 3, by_ai: true, seat_index: 0, type: 'play' }),
    ]
    expect(idx(computeReversibleTail(rows, 0))).toEqual([2, 3])
  })

  it('breaks the run at a move on ANY other seat (never crosses turns)', () => {
    const rows = [
      mrow({ move_index: 1, by_ai: true, seat_index: 0 }),
      mrow({ move_index: 2, by_ai: true, seat_index: 1 }),
      mrow({ move_index: 3, by_ai: true, seat_index: 0 }),
    ]
    expect(idx(computeReversibleTail(rows, 0))).toEqual([3])
  })

  it('ignores already-reverted rows', () => {
    const rows = [
      mrow({ move_index: 1, by_ai: true, seat_index: 0, reverted: true }),
      mrow({ move_index: 2, by_ai: true, seat_index: 0 }),
    ]
    expect(idx(computeReversibleTail(rows, 0))).toEqual([2])
  })
})

// --- Integration: /veto against real DO storage -----------------------------
/** Apply a scripted step through the engine, optionally as a server-minted AI move. */
function applyStep(state: any, repo: GameRepository, game: any, i: number, byAi: boolean) {
  const sql = state.storage.sql as SqlLike
  const s = game.script[i]
  return state.storage.transactionSync(() =>
    applyAndPersist(sql, repo, {
      seatIndex: s.seatIndex,
      move: s.move,
      clientMoveId: `${byAi ? 'ai' : 'h'}-${i}`,
      accountId: byAi ? null : s.accountId,
      byAi,
      aiDifficulty: byAi ? 'medium' : null,
      now: 1000 + i,
    }),
  )
}

describe('POST /veto', () => {
  it('(a) reverts a trailing AI move on the seat; the human then plays at the next index and replay == live', async () => {
    // Seed a scripted 2-seat game and apply step 0 as a server-minted AI move for seat 0.
    await runInDurableObject(stubFor('veto-a'), (_i: any, state: any) => {
      const { repo, game } = seedScriptedGame(state.storage.sql)
      const r = applyStep(state, repo, game, 0, true) // seat 0 AI play
      expect(r).toMatchObject({ ok: true, moveIndex: 1 })
      expect(repo.getMeta()!.current_seat).toBe(1)
    })

    // Seat 0's human vetoes → the AI move is undone, seat 0 is back on turn.
    const vres = await SELF.fetch('https://example.com/games/veto-a/veto', {
      method: 'POST',
      headers: await authHeaders('acct-0'),
    })
    expect(vres.status).toBe(200)
    const vbody = (await vres.json()) as any
    expect(vbody.ok).toBe(true)
    expect(vbody.moveIndex).toBe(1) // index stays at the max (not decremented)
    expect(vbody.reverted).toEqual([1])
    expect(vbody.snapshot.mySeat).toBe(0)
    expect('drawPile' in vbody.snapshot).toBe(false)
    const myHand = vbody.snapshot.myHand

    await runInDurableObject(stubFor('veto-a'), (_i: any, state: any) => {
      const repo = new GameRepository(state.storage.sql as SqlLike)
      expect(repo.getMeta()!.current_seat).toBe(0) // control back to the human
      expect(repo.getMeta()!.move_index).toBe(1)
      expect(repo.getMovesSince(0).find((m) => m.move_index === 1)!.reverted).toBe(true)
      expect(repo.getSeats()[0]!.controlled_by_ai).toBe(false)
    })

    // The human plays their real move — it lands at the NEXT index (2).
    const mres = await SELF.fetch('https://example.com/games/veto-a/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeaders('acct-0')) },
      body: JSON.stringify({
        seatIndex: 0,
        move: { type: 'play', placements: [{ card: myHand[0], position: { x: 2, y: 0 } }] },
        clientMoveId: crypto.randomUUID(),
      }),
    })
    expect(mres.status).toBe(200)
    expect((await mres.json()).moveIndex).toBe(2)

    // The persisted log (reverted AI move skipped + the human move) replays to
    // the live snapshot, byte-for-byte.
    await runInDurableObject(stubFor('veto-a'), (_i: any, state: any) => {
      const repo = new GameRepository(state.storage.sql as SqlLike)
      const replayed = replay(repo.getInitialState()!, repo.getMovesSince(0))
      expect(serializeState(replayed)).toBe(serializeState(repo.getSnapshot()!))
    })
  })

  it('(b) reverts a WHOLE AI turn that includes a wild_recycle (both rows)', async () => {
    await runInDurableObject(stubFor('veto-b'), (_i: any, state: any) => {
      const { repo, game } = seedScriptedGame(state.storage.sql)
      applyStep(state, repo, game, 0, false) // seat 0 human play
      applyStep(state, repo, game, 1, true) // seat 1 AI wild_recycle
      applyStep(state, repo, game, 2, true) // seat 1 AI pass (terminal action)
      expect(repo.getMeta()!.current_seat).toBe(0)
    })

    const vres = await SELF.fetch('https://example.com/games/veto-b/veto', {
      method: 'POST',
      headers: await authHeaders('acct-1'), // seat 1's owner
    })
    expect(vres.status).toBe(200)
    const vbody = (await vres.json()) as any
    expect(vbody.reverted).toEqual([2, 3]) // BOTH the recycle and the pass

    await runInDurableObject(stubFor('veto-b'), (_i: any, state: any) => {
      const repo = new GameRepository(state.storage.sql as SqlLike)
      const rows = repo.getMovesSince(0)
      expect(rows.find((m) => m.move_index === 1)!.reverted).toBe(false) // seat 0's play survives
      expect(rows.find((m) => m.move_index === 2)!.reverted).toBe(true)
      expect(rows.find((m) => m.move_index === 3)!.reverted).toBe(true)
      expect(repo.getMeta()!.current_seat).toBe(1) // back to seat 1
      expect(repo.getSeats()[1]!.controlled_by_ai).toBe(false)
      // replay equality holds after the multi-row revert
      expect(serializeState(replay(repo.getInitialState()!, rows))).toBe(serializeState(repo.getSnapshot()!))
    })
  })

  it('(c) is NOT vetoable (409) when another seat committed on top — nothing reverted', async () => {
    await runInDurableObject(stubFor('veto-c'), (_i: any, state: any) => {
      const { repo, game } = seedScriptedGame(state.storage.sql)
      applyStep(state, repo, game, 0, true) // seat 0 AI play
      applyStep(state, repo, game, 1, false) // seat 1 human wild_recycle (committed on top)
    })

    const vres = await SELF.fetch('https://example.com/games/veto-c/veto', {
      method: 'POST',
      headers: await authHeaders('acct-0'), // seat 0 tries to veto
    })
    expect(vres.status).toBe(409)
    expect((await vres.json()).vetoable).toBe(false)

    await runInDurableObject(stubFor('veto-c'), (_i: any, state: any) => {
      const repo = new GameRepository(state.storage.sql as SqlLike)
      // NOTHING reverted — seat 0's AI move (move 1) is untouched.
      expect(repo.getMovesSince(0).every((m) => !m.reverted)).toBe(true)
    })
  })

  it('(d) a non-owner cannot veto the seat (403 / 401), nothing reverted', async () => {
    await runInDurableObject(stubFor('veto-d'), (_i: any, state: any) => {
      const { repo, game } = seedScriptedGame(state.storage.sql)
      applyStep(state, repo, game, 0, true) // seat 0 AI play (vetoable by acct-0)
    })

    // no token
    expect((await SELF.fetch('https://example.com/games/veto-d/veto', { method: 'POST' })).status).toBe(401)
    // a valid token for an account that owns no seat here
    const res = await SELF.fetch('https://example.com/games/veto-d/veto', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await mintToken('acct-nobody')}` },
    })
    expect(res.status).toBe(403)

    await runInDurableObject(stubFor('veto-d'), (_i: any, state: any) => {
      const repo = new GameRepository(state.storage.sql as SqlLike)
      expect(repo.getMovesSince(0).every((m) => !m.reverted)).toBe(true)
    })
  })
})
