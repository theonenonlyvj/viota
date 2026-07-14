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

async function authQuick(deviceCredential: string, displayName: string, game?: string): Promise<Response> {
  return SELF.fetch('https://example.com/auth/quick', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(game === undefined ? { deviceCredential, displayName } : { deviceCredential, displayName, game }),
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

  it('mints origin_game from an optional, allowlisted `game` field (Fix M3)', async () => {
    const { accountId } = (await (await authQuick(mintCredential(), 'JaipurGhost', 'jaipur')).json()) as {
      accountId: string
    }
    const row = await DB()
      .prepare('SELECT origin_game FROM accounts WHERE id = ?')
      .bind(accountId)
      .first<{ origin_game: string }>()
    expect(row?.origin_game).toBe('jaipur')
  })

  it('mints origin_game for Vikipedia quick accounts', async () => {
    const { accountId } = (await (await authQuick(mintCredential(), 'WikiGhost', 'vikipedia')).json()) as {
      accountId: string
    }
    const row = await DB()
      .prepare('SELECT origin_game FROM accounts WHERE id = ?')
      .bind(accountId)
      .first<{ origin_game: string }>()
    expect(row?.origin_game).toBe('vikipedia')
  })

  it('defaults origin_game to "iota" when `game` is absent (existing viota clients) or unrecognized', async () => {
    const { accountId: noneId } = (await (await authQuick(mintCredential(), 'NoGame')).json()) as {
      accountId: string
    }
    const noneRow = await DB()
      .prepare('SELECT origin_game FROM accounts WHERE id = ?')
      .bind(noneId)
      .first<{ origin_game: string }>()
    expect(noneRow?.origin_game).toBe('iota')

    const { accountId: bogusId } = (await (await authQuick(mintCredential(), 'BogusGame', 'not-a-real-game')).json()) as {
      accountId: string
    }
    const bogusRow = await DB()
      .prepare('SELECT origin_game FROM accounts WHERE id = ?')
      .bind(bogusId)
      .first<{ origin_game: string }>()
    expect(bogusRow?.origin_game).toBe('iota')
  })

  it('never overwrites an EXISTING account\'s origin_game on re-auth (game is CREATE-only)', async () => {
    const cred = mintCredential()
    const { accountId: a } = (await (await authQuick(cred, 'First', 'jaipur')).json()) as { accountId: string }
    // Same credential re-authenticates the same account; a later/different
    // `game` on re-auth must NOT relabel it.
    const { accountId: b } = (await (await authQuick(cred, 'First', 'iota')).json()) as { accountId: string }
    expect(b).toBe(a)
    const row = await DB()
      .prepare('SELECT origin_game FROM accounts WHERE id = ?')
      .bind(a)
      .first<{ origin_game: string }>()
    expect(row?.origin_game).toBe('jaipur')
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
