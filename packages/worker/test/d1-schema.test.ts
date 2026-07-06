import { env } from 'cloudflare:test'
import { it, expect, describe } from 'vitest'
import { applyD1Schema } from '../src/d1/schema'

// The vitest miniflare D1 binding is provisioned from wrangler.toml's
// [[d1_databases]] binding = "DB". There is no auto-migration, so we apply the
// schema ourselves. Storage is shared across files (singleWorker) — the schema
// is idempotent, so re-applying here is harmless.
const DB = () => (env as unknown as { DB: D1Database }).DB

describe('applyD1Schema', () => {
  it('is idempotent (applying twice does not throw)', async () => {
    await applyD1Schema(DB())
    await applyD1Schema(DB()) // second application must be a no-op, not an error
  })

  it('creates the four archive tables', async () => {
    await applyD1Schema(DB())
    const { results } = await DB()
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all<{ name: string }>()
    const names = results.map((r) => r.name)
    expect(names).toEqual(expect.arrayContaining(['accounts', 'games', 'game_players', 'moves']))
  })

  it('creates the cross-session analytics indexes', async () => {
    await applyD1Schema(DB())
    const { results } = await DB()
      .prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all<{ name: string }>()
    const names = results.map((r) => r.name)
    // (status,last_activity_at) drives the cron sweep; code resolves the lobby
    // registry; account_id is THE cross-game player-history join.
    expect(names).toEqual(
      expect.arrayContaining([
        'idx_games_status_activity',
        'idx_games_code',
        'idx_game_players_account',
      ]),
    )
  })

  it('enforces credential_hash uniqueness (the lookup key), not display_name', async () => {
    await applyD1Schema(DB())
    const hash = `hash-${crypto.randomUUID()}`
    await DB()
      .prepare('INSERT INTO accounts (id, credential_hash, display_name, created_at) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), hash, 'Samename', Date.now())
      .run()
    // A DIFFERENT account with the SAME display_name is fine (no collision)...
    await DB()
      .prepare('INSERT INTO accounts (id, credential_hash, display_name, created_at) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), `hash-${crypto.randomUUID()}`, 'Samename', Date.now())
      .run()
    // ...but the SAME credential_hash collides (UNIQUE).
    await expect(
      DB()
        .prepare('INSERT INTO accounts (id, credential_hash, display_name, created_at) VALUES (?, ?, ?, ?)')
        .bind(crypto.randomUUID(), hash, 'Other', Date.now())
        .run(),
    ).rejects.toThrow()
  })
})
