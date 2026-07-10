import { env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyD1Schema } from '../src/d1/schema'
import { canonical } from '../src/identity/canonical'

const DB = () => (env as unknown as { DB: D1Database }).DB

async function acct(id: string, merged_into: string | null, status = merged_into ? 'merged' : 'ghost') {
  await DB()
    .prepare(
      `INSERT INTO accounts (id, credential_hash, display_name, created_at, status, merged_into, token_epoch, last_seen_at, origin_game, must_change_pw, login_fail_count)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'iota', 0, 0)`,
    )
    .bind(id, 'ch_' + id, id, Date.now(), status, merged_into, Date.now())
    .run()
}

describe('canonical', () => {
  beforeAll(async () => {
    await applyD1Schema(DB())
  })
  it('follows a merge chain to the live head', async () => {
    await acct('C', null)
    await acct('B', 'C')
    await acct('A', 'B')
    expect((await canonical(DB(), 'A'))!.id).toBe('C')
    expect((await canonical(DB(), 'C'))!.status).toBe('ghost')
  })
  it('is safe on a malformed cycle', async () => {
    await acct('X', 'Y', 'merged')
    await acct('Y', 'X', 'merged')
    const r = await canonical(DB(), 'X', 8)
    expect(r).not.toBeNull() // returns last-seen without infinite loop
  })
  it('returns null for unknown id', async () => {
    expect(await canonical(DB(), 'nope')).toBeNull()
  })
})
