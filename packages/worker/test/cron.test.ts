import { env, runInDurableObject, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { it, expect, describe, beforeAll } from 'vitest'
import worker from '../src/index'
import { GameRepository, type SqlLike } from '../src/do/storage'
import { applyAndPersist } from '../src/do/apply'
import { applyD1Schema } from '../src/d1/schema'
import { ABANDON_MS } from '../src/do/constants'
import { seedScriptedGame } from './helpers'

const DB = () => (env as unknown as { DB: D1Database }).DB

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

async function runCron(): Promise<void> {
  const ctx = createExecutionContext()
  await worker.scheduled!(
    { cron: '* * * * *', scheduledTime: Date.now(), noRetry() {} } as unknown as ScheduledController,
    env as never,
    ctx,
  )
  await waitOnExecutionContext(ctx)
}

beforeAll(async () => {
  await applyD1Schema(DB())
})

describe('cron sweep -> DO /tick', () => {
  it('finds a stale active game and pokes its DO, draining the archive outbox', async () => {
    const gameUuid = `stale-${crypto.randomUUID()}`
    // A stale lobby-registry row: active, but no activity for > ABANDON_MS.
    await DB()
      .prepare("INSERT INTO games (game_uuid, status, last_activity_at, player_count) VALUES (?, 'active', ?, 2)")
      .bind(gameUuid, Date.now() - ABANDON_MS - 5000)
      .run()

    // Seed the DO with a committed-but-UNFLUSHED move (simulating a prior D1 hiccup).
    const stub = stubFor(gameUuid)
    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const seeded = seedScriptedGame(sql)
      const repo = seeded.repo
      repo.putMeta({ ...repo.getMeta()!, game_uuid: gameUuid }) // match the D1 registry row
      state.storage.transactionSync(() =>
        applyAndPersist(sql, repo, {
          seatIndex: 0, move: seeded.game.script[0]!.move, clientMoveId: crypto.randomUUID(), accountId: 'acct-0',
        }),
      )
      expect(repo.unflushedOutbox()).toEqual([1]) // enqueued, not yet flushed
    })

    await runCron()

    // The DO received the /tick and drained its outbox to D1.
    await runInDurableObject(stub, (_i: any, state: any) => {
      expect(new GameRepository(state.storage.sql as SqlLike).unflushedOutbox()).toEqual([])
    })
    const row = await DB()
      .prepare('SELECT move_index FROM moves WHERE game_uuid = ? AND move_index = 1')
      .bind(gameUuid)
      .first()
    expect(row).toBeTruthy()
  })

  it('leaves a fresh active game alone (last_activity within the window)', async () => {
    const gameUuid = `fresh-${crypto.randomUUID()}`
    await DB()
      .prepare("INSERT INTO games (game_uuid, status, last_activity_at, player_count) VALUES (?, 'active', ?, 2)")
      .bind(gameUuid, Date.now())
      .run()

    const stub = stubFor(gameUuid)
    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const seeded = seedScriptedGame(sql)
      seeded.repo.putMeta({ ...seeded.repo.getMeta()!, game_uuid: gameUuid })
      state.storage.transactionSync(() =>
        applyAndPersist(sql, seeded.repo, {
          seatIndex: 0, move: seeded.game.script[0]!.move, clientMoveId: crypto.randomUUID(), accountId: 'acct-0',
        }),
      )
    })

    await runCron()

    // Not stale -> never poked -> its outbox row is still unflushed.
    await runInDurableObject(stub, (_i: any, state: any) => {
      expect(new GameRepository(state.storage.sql as SqlLike).unflushedOutbox()).toEqual([1])
    })
  })
})
