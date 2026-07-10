import { SELF, env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyD1Schema } from '../src/d1/schema'

const DB = () => (env as unknown as { DB: D1Database }).DB

function q(path: string, body: unknown): Promise<Response> {
  return SELF.fetch('https://example.com' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/auth/login', () => {
  beforeAll(async () => {
    await applyD1Schema(DB())
    const tok = ((await (await q('/auth/quick', { deviceCredential: 'cred-login-000000000', displayName: 'Log' })).json()) as {
      token: string
    }).token
    await SELF.fetch('https://example.com/auth/set-credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
      body: JSON.stringify({ username: 'logger', password: 'hunter2' }),
    })
  })

  it('logs in with correct credentials on a fresh device and binds it', async () => {
    const r = await q('/auth/login', { username: 'logger', password: 'hunter2', deviceCredential: 'cred-newdevice-11111' })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { token: string; accountId: string; mustChangePassword: boolean }
    expect(body.token).toBeTruthy()
    expect(body.mustChangePassword).toBe(false)
    const dev = await DB().prepare(`SELECT account_id FROM device_credentials WHERE account_id=?`).bind(body.accountId).all()
    expect(dev.results.length).toBeGreaterThanOrEqual(2) // original + newly bound
  })

  it('returns generic 401 on wrong password', async () => {
    const r = await q('/auth/login', { username: 'logger', password: 'nope', deviceCredential: 'd-wrong-pw-000000000' })
    expect(r.status).toBe(401)
    expect((await r.json()) as { error: string }).toMatchObject({ error: 'invalid_credentials' })
  })

  it('returns the SAME generic 401 on unknown user (anti-enumeration)', async () => {
    const r = await q('/auth/login', { username: 'ghostuser', password: 'whatever', deviceCredential: 'd-unknown-user-00000' })
    expect(r.status).toBe(401)
    expect((await r.json()) as { error: string }).toMatchObject({ error: 'invalid_credentials' })
  })

  it('mints a token that verifies via requireCanonicalAccount (vgames token, not legacy)', async () => {
    const r = await q('/auth/login', { username: 'logger', password: 'hunter2', deviceCredential: 'cred-verify-device-1' })
    const { token, accountId } = (await r.json()) as { token: string; accountId: string }
    const acc = await DB().prepare(`SELECT status FROM accounts WHERE id=?`).bind(accountId).first<{ status: string }>()
    expect(acc!.status).toBe('claimed')
    // A vgames token carries claims a plain legacy `signToken` never would —
    // verified indirectly via a successful /auth/set-credentials-style authed call.
    const r2 = await SELF.fetch('https://example.com/auth/set-credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({ username: 'reclaim_attempt', password: 'abcdef' }),
    })
    expect(r2.status).toBe(409) // already claimed, not ghost -> proves the token authenticated correctly
  })
})
