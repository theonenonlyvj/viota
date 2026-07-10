import { SELF, env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyD1Schema } from '../src/d1/schema'

const DB = () => (env as unknown as { DB: D1Database }).DB

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function post(path: string, body: unknown): Promise<Response> {
  return SELF.fetch('https://example.com' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/auth/quick with device_credentials', () => {
  beforeAll(async () => {
    await applyD1Schema(DB())
  })

  it('mints a ghost + a device_credentials row', async () => {
    const r = await post('/auth/quick', { deviceCredential: 'cred-aaaaaaaaaaaaaaaa', displayName: 'Neo' })
    expect(r.status).toBe(200)
    const { accountId } = (await r.json()) as any
    const dev = await DB().prepare(`SELECT account_id FROM device_credentials WHERE account_id=?`).bind(accountId).first()
    expect(dev).toBeTruthy()
  })

  it('re-auths the SAME account on the same credential', async () => {
    const a = (await (await post('/auth/quick', { deviceCredential: 'cred-bbbbbbbbbbbbbbbb', displayName: 'A' })).json()) as any
    const b = (await (await post('/auth/quick', { deviceCredential: 'cred-bbbbbbbbbbbbbbbb', displayName: 'A' })).json()) as any
    expect(a.accountId).toBe(b.accountId)
  })

  it('backfills a device row for a legacy account that has only credential_hash', async () => {
    // simulate a pre-existing viota account (no device_credentials row)
    const now = Date.now()
    const h = await sha256hex('legacy-cred-cccccccccccc')
    await DB()
      .prepare(
        `INSERT INTO accounts (id, credential_hash, display_name, created_at, status, token_epoch, origin_game, must_change_pw, login_fail_count, last_seen_at)
      VALUES ('legacyacc', ?, 'Legacy', ?, 'ghost', 0, 'iota', 0, 0, ?)`,
      )
      .bind(h, now, now)
      .run()
    const r = await post('/auth/quick', { deviceCredential: 'legacy-cred-cccccccccccc', displayName: 'Legacy' })
    const { accountId } = (await r.json()) as any
    expect(accountId).toBe('legacyacc')
    const dev = await DB().prepare(`SELECT credential_hash FROM device_credentials WHERE account_id='legacyacc'`).first()
    expect(dev).toBeTruthy() // backfilled
  })
})
