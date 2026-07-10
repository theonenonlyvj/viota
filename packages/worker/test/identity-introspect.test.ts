import { SELF, env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyD1Schema } from '../src/d1/schema'
import { signVGamesToken } from '../src/jwt'

const SECRET = 'test-jwt-secret-0123456789-abcdefghijklmnop'
const DB = () => (env as unknown as { DB: D1Database }).DB

function intro(token: string): Promise<Response> {
  return SELF.fetch('https://example.com/auth/introspect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
}

describe('/auth/introspect', () => {
  beforeAll(async () => {
    await applyD1Schema(DB())
    const now = Date.now()
    await DB()
      .prepare(
        `INSERT INTO accounts (id,credential_hash,display_name,created_at,status,token_epoch,origin_game,must_change_pw,login_fail_count,last_seen_at) VALUES ('ia','ci','I',?,'claimed',2,'jaipur',0,0,?)`,
      )
      .bind(now, now)
      .run()
  })

  it('validates a good token and returns canonical id + status', async () => {
    const t = await signVGamesToken({ accountId: 'ia', status: 'claimed', epoch: 2 }, SECRET)
    const r = await intro(t)
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ valid: true, accountId: 'ia', status: 'claimed' })
  })

  it('returns {valid:false} for garbage', async () => {
    const r = await intro('garbage')
    expect(r.status).toBe(200)
    const body = (await r.json()) as { valid: boolean }
    expect(body.valid).toBe(false)
  })

  it('returns {valid:false} for a stale-epoch token', async () => {
    const t = await signVGamesToken({ accountId: 'ia', status: 'claimed', epoch: 1 }, SECRET)
    const body = (await (await intro(t)).json()) as { valid: boolean }
    expect(body.valid).toBe(false)
  })

  it('returns {valid:false} for an unknown account id', async () => {
    const t = await signVGamesToken({ accountId: 'no-such-account', status: 'ghost', epoch: 0 }, SECRET)
    const body = (await (await intro(t)).json()) as { valid: boolean }
    expect(body.valid).toBe(false)
  })

  it('always returns HTTP 200, even on bad JSON', async () => {
    const r = await SELF.fetch('https://example.com/auth/introspect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(r.status).toBe(200)
    expect((await r.json()) as { valid: boolean }).toMatchObject({ valid: false })
  })
})
