import { env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyD1Schema } from '../src/d1/schema'

const DB = () => (env as unknown as { DB: D1Database }).DB

describe('stats schema (migration 0004)', () => {
  beforeAll(async () => {
    await applyD1Schema(DB())
  })

  it('game_players gains opponent_kind', async () => {
    const cols = await DB().prepare(`PRAGMA table_info(game_players)`).all()
    const names = cols.results.map((r: any) => r.name)
    expect(names).toContain('opponent_kind')
    // Unchanged P1 columns still present alongside it.
    expect(names).toContain('result')
    expect(names).toContain('stats')
  })

  it('opponent_kind is nullable and writable with human/ai values', async () => {
    const gameUuid = `stats-schema-${crypto.randomUUID()}`
    await DB().prepare('INSERT INTO games (game_uuid, status, player_count) VALUES (?, ?, ?)').bind(gameUuid, 'completed', 2).run()
    await DB()
      .prepare('INSERT INTO game_players (game_uuid, seat_index, owner_type, opponent_kind) VALUES (?, ?, ?, ?)')
      .bind(gameUuid, 0, 'human', 'ai')
      .run()
    await DB()
      .prepare('INSERT INTO game_players (game_uuid, seat_index, owner_type) VALUES (?, ?, ?)')
      .bind(gameUuid, 1, 'ai')
      .run()

    const rows = (
      await DB().prepare('SELECT seat_index, opponent_kind FROM game_players WHERE game_uuid = ? ORDER BY seat_index').bind(gameUuid).all<any>()
    ).results
    expect(rows[0].opponent_kind).toBe('ai')
    expect(rows[1].opponent_kind).toBeNull() // nullable, no default
  })
})
