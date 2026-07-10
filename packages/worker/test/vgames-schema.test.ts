import { env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyD1Schema } from '../src/d1/schema'

const DB = () => (env as unknown as { DB: D1Database }).DB

describe('vgames identity schema', () => {
  beforeAll(async () => {
    await applyD1Schema(DB())
  })

  it('adds the new accounts columns', async () => {
    const cols = await DB().prepare(`PRAGMA table_info(accounts)`).all()
    const names = cols.results.map((r: any) => r.name)
    for (const c of [
      'status',
      'password_hash',
      'must_change_pw',
      'token_epoch',
      'claimed_at',
      'last_seen_at',
      'merged_into',
      'origin_game',
      'login_fail_count',
      'login_locked_until',
    ]) {
      expect(names, `accounts.${c}`).toContain(c)
    }
    expect(names).toContain('credential_hash') // unchanged, still present
    expect(names).toContain('username')
  })

  it('creates device_credentials / account_merges / external_identities', async () => {
    for (const t of ['device_credentials', 'account_merges', 'external_identities']) {
      const r = await DB()
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .bind(t)
        .first()
      expect(r, t).toBeTruthy()
    }
  })

  it('creates the leaderboard views and the partial merge index', async () => {
    const v = await DB()
      .prepare(`SELECT name FROM sqlite_master WHERE type='view' AND name IN ('v_leaderboard','v_leaderboard_all')`)
      .all()
    expect(v.results.length).toBe(2)
    const idx = await DB()
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='uidx_merge_active'`)
      .first()
    expect(idx).toBeTruthy()
  })

  it('game_players gains result/stats/ai_move_count/total_moves; games gains game_type/seed', async () => {
    const gp = (await DB().prepare(`PRAGMA table_info(game_players)`).all()).results.map((r: any) => r.name)
    for (const c of ['result', 'stats', 'ai_move_count', 'total_moves']) expect(gp).toContain(c)
    const g = (await DB().prepare(`PRAGMA table_info(games)`).all()).results.map((r: any) => r.name)
    for (const c of ['game_type', 'seed']) expect(g).toContain(c)
  })
})
