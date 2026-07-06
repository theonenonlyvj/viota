import { env, runInDurableObject } from 'cloudflare:test'
import { it, expect } from 'vitest'
import { initGame } from '@viota/engine'
import { runMigrations, MIGRATIONS, GameRepository } from '../src/do/storage'
import { serializeState } from '../src/do/state-codec'

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

it('creates every Phase-1 table and stamps schema_version', async () => {
  await runInDurableObject(stubFor('storage-schema'), (_i, state: any) => {
    const sql = state.storage.sql
    runMigrations(sql)

    const tables = [...sql.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
      .map((r: any) => r.name as string)
    for (const t of ['meta', 'initial_state', 'snapshot', 'moves', 'seats', 'timers', 'schema_version']) {
      expect(tables).toContain(t)
    }
    const version = [...sql.exec('SELECT version FROM schema_version')][0] as any
    expect(version.version).toBe(MIGRATIONS.length)
  })
})

it('migrations are idempotent (running twice is clean, one version row)', async () => {
  await runInDurableObject(stubFor('storage-idem'), (_i, state: any) => {
    const sql = state.storage.sql
    runMigrations(sql)
    const repo = new GameRepository(sql)
    repo.putMeta({ move_index: 0, status: 'active', current_seat: 0, player_count: 2, engine_version: 'e1', game_uuid: 'g-1' })

    // Second run must not throw, must not duplicate the version row, must not lose data.
    runMigrations(sql)

    const versions = [...sql.exec('SELECT version FROM schema_version')]
    expect(versions.length).toBe(1)
    expect((versions[0] as any).version).toBe(MIGRATIONS.length)
    expect(repo.getMeta()?.game_uuid).toBe('g-1')
  })
})

it('forward-migrates a 1st-generation DO to a 2nd-generation schema without data loss', async () => {
  await runInDurableObject(stubFor('storage-forward'), (_i, state: any) => {
    const sql = state.storage.sql
    // Simulate a DO created on the 1st-gen schema (only v1 applied).
    runMigrations(sql, [MIGRATIONS[0]!])
    const repo = new GameRepository(sql)
    repo.putSeat({
      seat_index: 0, owner_account_id: 'acct-A', ghost_id: null, owner_type: 'human',
      display_name: 'Alice', ai_difficulty: null, controlled_by_ai: false,
      disconnected_at: null, last_seen_at: null, final_score: null,
    })

    // Ship a 2nd-gen schema: an idempotent forward ALTER.
    const v2 = (s: any) => s.exec('ALTER TABLE seats ADD COLUMN test_added_col TEXT')
    runMigrations(sql, [MIGRATIONS[0]!, v2])

    // Version advanced, the new column exists, the old row survived.
    expect(([...sql.exec('SELECT version FROM schema_version')][0] as any).version).toBe(2)
    const seat = [...sql.exec('SELECT seat_index, display_name, test_added_col FROM seats')][0] as any
    expect(seat.display_name).toBe('Alice')
    expect(seat.test_added_col).toBe(null)
  })
})

it('repository round-trips meta, initial_state (immutable), snapshot, seats, moves', async () => {
  await runInDurableObject(stubFor('storage-repo'), (_i, state: any) => {
    const sql = state.storage.sql
    runMigrations(sql)
    const repo = new GameRepository(sql)

    // meta
    repo.putMeta({ move_index: 0, status: 'active', current_seat: 0, player_count: 2, engine_version: 'engine-test', game_uuid: 'uuid-xyz' })
    expect(repo.getMeta()).toMatchObject({ player_count: 2, engine_version: 'engine-test', game_uuid: 'uuid-xyz', status: 'active' })

    // initial_state is write-once / immutable
    const gs1 = initGame(2)
    repo.putInitialState(gs1)
    const firstJson = serializeState(gs1)
    const gs2 = initGame(2) // a DIFFERENT deal
    repo.putInitialState(gs2) // must be a no-op
    expect(serializeState(repo.getInitialState()!)).toBe(firstJson)

    // snapshot is rebuildable (overwritable)
    repo.putSnapshot(gs1)
    repo.putSnapshot(gs2)
    expect(serializeState(repo.getSnapshot()!)).toBe(serializeState(gs2))

    // seats
    repo.putSeat({
      seat_index: 0, owner_account_id: 'a0', ghost_id: null, owner_type: 'human',
      display_name: 'P0', ai_difficulty: null, controlled_by_ai: false,
      disconnected_at: null, last_seen_at: null, final_score: null,
    })
    repo.putSeat({
      seat_index: 1, owner_account_id: null, ghost_id: null, owner_type: 'ai',
      display_name: 'Bot', ai_difficulty: 'medium', controlled_by_ai: true,
      disconnected_at: null, last_seen_at: null, final_score: null,
    })
    const seats = repo.getSeats()
    expect(seats.length).toBe(2)
    expect(seats[0]!.owner_account_id).toBe('a0')
    expect(seats[1]!.controlled_by_ai).toBe(true)
    expect(seats[1]!.ai_difficulty).toBe('medium')

    // getMovesSince on an empty log
    expect(repo.getMovesSince(0)).toEqual([])
  })
})
