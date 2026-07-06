import { SELF, env } from 'cloudflare:test'
import { it, expect, describe, beforeAll } from 'vitest'
import { applyD1Schema } from '../src/d1/schema'
import { hashCredential, sanitizeDisplayName } from '../src/d1/accounts'
import { verifyToken } from '../src/jwt'
import { TEST_JWT_SECRET } from './helpers'

const DB = () => (env as unknown as { DB: D1Database }).DB

// A fresh, high-entropy 256-bit-style credential per call (hex of 32 bytes) so
// shared-storage tests never collide on credential_hash.
function mintCredential(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function authQuick(deviceCredential: string, displayName: string): Promise<Response> {
  return SELF.fetch('https://example.com/auth/quick', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceCredential, displayName }),
  })
}

beforeAll(async () => {
  await applyD1Schema(DB())
})

describe('POST /auth/quick', () => {
  it('mint-new returns a usable JWT whose subject is the new account id', async () => {
    const res = await authQuick(mintCredential(), 'Alice')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string; accountId: string }
    expect(typeof body.accountId).toBe('string')
    expect(body.accountId.length).toBeGreaterThan(0)
    const verified = await verifyToken(body.token, TEST_JWT_SECRET)
    expect(verified?.accountId).toBe(body.accountId)
  })

  it('the SAME credential re-authenticates the SAME account (even with a new display name)', async () => {
    const cred = mintCredential()
    const a = (await (await authQuick(cred, 'First')).json()) as { accountId: string }
    const b = (await (await authQuick(cred, 'Renamed')).json()) as { accountId: string }
    expect(b.accountId).toBe(a.accountId) // credential_hash is the lookup key
  })

  it('a DIFFERENT credential mints a DIFFERENT account (same display name is fine)', async () => {
    const a = (await (await authQuick(mintCredential(), 'Twins')).json()) as { accountId: string }
    const b = (await (await authQuick(mintCredential(), 'Twins')).json()) as { accountId: string }
    expect(b.accountId).not.toBe(a.accountId)
  })

  it('sanitizes the display name (strips control/zero-width + HTML metachars)', async () => {
    const cred = mintCredential()
    const dirty = '  <b>Ev​il</b>  ' // HTML tags, zero-width, a control char
    const { accountId } = (await (await authQuick(cred, dirty)).json()) as { accountId: string }
    const row = await DB()
      .prepare('SELECT display_name FROM accounts WHERE id = ?')
      .bind(accountId)
      .first<{ display_name: string }>()
    expect(row?.display_name).toBe('bEvil/b') // < > & stripped, zero-width + control gone, trimmed
    expect(sanitizeDisplayName(dirty)).toBe('bEvil/b') // helper matches the wire behavior
  })

  it('caps the display name at 24 code points', async () => {
    expect(sanitizeDisplayName('x'.repeat(50))).toHaveLength(24)
  })

  it('rejects an empty/invalid credential (400)', async () => {
    expect((await authQuick('', 'Nobody')).status).toBe(400)
    expect((await authQuick('short', 'Nobody')).status).toBe(400)
  })

  it('NEVER stores the raw credential — only its SHA-256 hash', async () => {
    const cred = mintCredential()
    const { accountId } = (await (await authQuick(cred, 'Secret')).json()) as { accountId: string }
    const row = await DB()
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .bind(accountId)
      .first<Record<string, unknown>>()
    expect(row?.credential_hash).toBe(await hashCredential(cred))
    expect(row?.credential_hash).not.toBe(cred) // the hash, not the secret
    // the raw credential appears in NO column of the stored row
    expect(JSON.stringify(row)).not.toContain(cred)
  })
})
