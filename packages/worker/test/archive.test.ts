import { env, runInDurableObject } from 'cloudflare:test'
import { it, expect, describe, beforeAll } from 'vitest'
import { GameRepository, type SqlLike, type MoveRow } from '../src/do/storage'
import { applyAndPersist } from '../src/do/apply'
import { applyD1Schema } from '../src/d1/schema'
import { seedScriptedGame } from './helpers'

const DB = () => (env as unknown as { DB: D1Database }).DB

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

/** Give the seeded scripted game a UNIQUE game_uuid so the shared D1 never
 *  collides across tests (moves PK is (game_uuid, move_index)). */
function seedUnique(sql: SqlLike): { repo: GameRepository; gameUuid: string; game: ReturnType<typeof seedScriptedGame>['game'] } {
  const { repo, game } = seedScriptedGame(sql)
  const gameUuid = `arch-${crypto.randomUUID()}`
  repo.putMeta({ ...repo.getMeta()!, game_uuid: gameUuid })
  return { repo, gameUuid, game }
}

beforeAll(async () => {
  await applyD1Schema(DB())
})

describe('DO -> D1 archive write-through', () => {
  it('a committed move appears in the D1 moves archive', async () => {
    const stub = stubFor(`archive-move-${crypto.randomUUID()}`)
    let gameUuid = ''
    await runInDurableObject(stub, async (i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const seeded = seedUnique(sql)
      gameUuid = seeded.gameUuid
      // Commit the first scripted move (seat 0 plays) inside a sync txn.
      const res = state.storage.transactionSync(() =>
        applyAndPersist(sql, seeded.repo, {
          seatIndex: 0,
          move: seeded.game.script[0]!.move,
          clientMoveId: crypto.randomUUID(),
          accountId: 'acct-0',
        }),
      )
      expect('ok' in res && res.ok).toBe(true)
      // insertMove enqueued the outbox row; drain it to D1 (awaited, not waitUntil).
      await i.flushOutbox(Date.now())
    })

    const row = await DB()
      .prepare('SELECT * FROM moves WHERE game_uuid = ? AND move_index = 1')
      .bind(gameUuid)
      .first<Record<string, unknown>>()
    expect(row).toBeTruthy()
    expect(row!.type).toBe('play')
    expect(Number(row!.seat_index)).toBe(0)
    expect(Number(row!.reverted)).toBe(0)

    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      // The outbox row is now marked flushed.
      expect(new GameRepository(sql).unflushedOutbox()).toEqual([])
    })
  })

  it("re-flushes a vetoed move so its `reverted` flips to 1 in D1", async () => {
    const stub = stubFor(`archive-veto-${crypto.randomUUID()}`)
    let gameUuid = ''
    await runInDurableObject(stub, async (i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const seeded = seedUnique(sql)
      gameUuid = seeded.gameUuid
      const repo = seeded.repo
      // Hand-insert an AI move (by_ai) at index 1 and flush it (reverted=0).
      const m: MoveRow = {
        move_index: 1, turn_number: 1, seat_index: 0, type: 'pass',
        payload: JSON.stringify({ type: 'pass', trades: [], tradeOrder: [] }),
        score_delta: 0, score_after: 0, by_ai: true, ai_difficulty: 'medium',
        controlling_account_id: 'acct-0', client_move_id: 'ai:0:1', reverted: false,
        created_at: Date.now(),
      }
      state.storage.transactionSync(() => {
        repo.insertMove(m) // also enqueues the outbox row
        repo.putMeta({ ...repo.getMeta()!, move_index: 1 })
      })
      await i.flushOutbox(Date.now())
    })

    let d1 = await DB().prepare('SELECT reverted FROM moves WHERE game_uuid = ? AND move_index = 1').bind(gameUuid).first<{ reverted: number }>()
    expect(Number(d1!.reverted)).toBe(0)

    // Now revert it in the DO + re-enqueue for re-flush (what handleVeto does).
    await runInDurableObject(stub, async (i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const repo = new GameRepository(sql)
      repo.markReverted(1)
      repo.enqueueOutbox(1)
      await i.flushOutbox(Date.now())
    })

    d1 = await DB().prepare('SELECT reverted FROM moves WHERE game_uuid = ? AND move_index = 1').bind(gameUuid).first<{ reverted: number }>()
    expect(Number(d1!.reverted)).toBe(1) // the veto's reverted flip propagated
  })

  it('a game-end archiveTick force-flushes: zero unflushed outbox rows + finalized games row', async () => {
    const stub = stubFor(`archive-end-${crypto.randomUUID()}`)
    let gameUuid = ''
    await runInDurableObject(stub, async (i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const seeded = seedUnique(sql)
      gameUuid = seeded.gameUuid
      const repo = seeded.repo
      // Write the games create-row first, then force the game terminal with two
      // enqueued moves and run the end archive tick.
      await i.archiveTick(Date.now()) // no-op create-side (games row not yet written)
      state.storage.transactionSync(() => {
        for (const mi of [1, 2]) {
          repo.insertMove({
            move_index: mi, turn_number: mi, seat_index: 0, type: 'pass',
            payload: JSON.stringify({ type: 'pass', trades: [], tradeOrder: [] }),
            score_delta: 0, score_after: 0, by_ai: false, ai_difficulty: null,
            controlling_account_id: 'acct-0', client_move_id: `c${mi}`, reverted: false,
            created_at: Date.now(),
          })
        }
        repo.putMeta({ ...repo.getMeta()!, move_index: 2, status: 'completed' })
        repo.putSnapshot({ ...repo.getSnapshot()!, scores: [7, 3] })
      })
      // Seed the games row so the end-finalize UPDATE has a target.
      await DB().prepare('INSERT INTO games (game_uuid, status, player_count) VALUES (?, ?, ?)').bind(gameUuid, 'active', 2).run()
      await i.archiveTick(Date.now())
      expect(new GameRepository(sql).unflushedOutbox()).toEqual([]) // zero unflushed
    })

    const g = await DB().prepare('SELECT status, outcome, winner_seat FROM games WHERE game_uuid = ?').bind(gameUuid).first<any>()
    expect(g.status).toBe('completed')
    expect(g.outcome).toBe('completed')
    expect(Number(g.winner_seat)).toBe(0) // scores [7,3] -> seat 0
    const moves = await DB().prepare('SELECT COUNT(*) AS c FROM moves WHERE game_uuid = ?').bind(gameUuid).first<{ c: number }>()
    expect(Number(moves!.c)).toBe(2)
  })

  it('a D1 write throwing NEVER stalls the move: it still commits in the DO, outbox stays unflushed', async () => {
    const stub = stubFor(`archive-fail-${crypto.randomUUID()}`)
    const brokenDb = { prepare() { throw new Error('D1 down') } } as unknown as D1Database
    await runInDurableObject(stub, async (i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const seeded = seedUnique(sql)
      const repo = seeded.repo
      const res = state.storage.transactionSync(() =>
        applyAndPersist(sql, repo, {
          seatIndex: 0, move: seeded.game.script[0]!.move, clientMoveId: crypto.randomUUID(), accountId: 'acct-0',
        }),
      )
      expect('ok' in res && res.ok).toBe(true) // the move COMMITTED despite D1 being down

      await i.flushOutbox(Date.now(), brokenDb) // D1 throws...
      // ...the move row is still in DO storage and the outbox row is still unflushed.
      expect(repo.getMove(1)).toBeTruthy()
      expect(repo.unflushedOutbox()).toEqual([1]) // retained for the cron/tick retry
    })
  })
})
