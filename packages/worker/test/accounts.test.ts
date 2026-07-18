import { SELF, env } from 'cloudflare:test'
import { it, expect, describe, beforeAll } from 'vitest'
import { applyGameSchema, applyIdentitySchema } from '../src/d1/schema'
import { hashCredential, sanitizeDisplayName } from '../src/d1/accounts'
import { verifyToken } from '../src/jwt'
import { TEST_JWT_SECRET } from './helpers'

const DB = () => (env as unknown as { DB: D1Database }).DB
// accounts live behind IDENTITY_DB post-split (viota-worker aliases DB->
// IDENTITY_DB when routing identity paths — see src/index.ts) — reads here
// go straight to the binding rather than through that alias.
const IDENTITY_DB = () => (env as unknown as { IDENTITY_DB: D1Database }).IDENTITY_DB

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

async function claimAccount(token: string, username: string): Promise<Response> {
  return SELF.fetch('https://example.com/auth/set-credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ username, password: 'hunter2' }),
  })
}

beforeAll(async () => {
  await applyGameSchema(DB())
  await applyIdentitySchema(IDENTITY_DB())
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

  it('rejects a new guest name that matches a claimed VGames username', async () => {
    const claimed = (await (await authQuick(mintCredential(), 'Runner Owner')).json()) as { token: string }
    expect((await claimAccount(claimed.token, 'runner_reserved')).status).toBe(200)

    const response = await authQuick(mintCredential(), 'Runner_Reserved')

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'name_reserved' })
  })

  it('still re-authenticates an existing ghost after its display name becomes reserved', async () => {
    const existingCredential = mintCredential()
    const existing = (await (await authQuick(existingCredential, 'Later_Reserved')).json()) as {
      accountId: string
    }
    const owner = (await (await authQuick(mintCredential(), 'Owner')).json()) as { token: string }
    expect((await claimAccount(owner.token, 'later_reserved')).status).toBe(200)

    const response = await authQuick(existingCredential, 'Later_Reserved')
    const body = (await response.json()) as { accountId: string }

    expect(response.status).toBe(200)
    expect(body.accountId).toBe(existing.accountId)
  })

  it('sanitizes the display name (strips control/zero-width + HTML metachars)', async () => {
    const cred = mintCredential()
    const dirty = '  <b>Ev​il</b>  ' // HTML tags, zero-width, a control char
    const { accountId } = (await (await authQuick(cred, dirty)).json()) as { accountId: string }
    const row = await IDENTITY_DB()
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
    const row = await IDENTITY_DB()
      .prepare('SELECT origin_game FROM accounts WHERE id = ?')
      .bind(accountId)
      .first<{ origin_game: string }>()
    expect(row?.origin_game).toBe('jaipur')
  })

  it('mints origin_game for VWiki Race quick accounts', async () => {
    const { accountId } = (await (await authQuick(mintCredential(), 'WikiGhost', 'vwiki-race')).json()) as {
      accountId: string
    }
    const row = await IDENTITY_DB()
      .prepare('SELECT origin_game FROM accounts WHERE id = ?')
      .bind(accountId)
      .first<{ origin_game: string }>()
    expect(row?.origin_game).toBe('vwiki-race')
  })

  it('defaults origin_game to "iota" when `game` is absent (existing viota clients) or unrecognized', async () => {
    const { accountId: noneId } = (await (await authQuick(mintCredential(), 'NoGame')).json()) as {
      accountId: string
    }
    const noneRow = await IDENTITY_DB()
      .prepare('SELECT origin_game FROM accounts WHERE id = ?')
      .bind(noneId)
      .first<{ origin_game: string }>()
    expect(noneRow?.origin_game).toBe('iota')

    const { accountId: bogusId } = (await (await authQuick(mintCredential(), 'BogusGame', 'not-a-real-game')).json()) as {
      accountId: string
    }
    const bogusRow = await IDENTITY_DB()
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
    const row = await IDENTITY_DB()
      .prepare('SELECT origin_game FROM accounts WHERE id = ?')
      .bind(a)
      .first<{ origin_game: string }>()
    expect(row?.origin_game).toBe('jaipur')
  })

  it('NEVER stores the raw credential — only its SHA-256 hash', async () => {
    const cred = mintCredential()
    const { accountId } = (await (await authQuick(cred, 'Secret')).json()) as { accountId: string }
    const row = await IDENTITY_DB()
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .bind(accountId)
      .first<Record<string, unknown>>()
    expect(row?.credential_hash).toBe(await hashCredential(cred))
    expect(row?.credential_hash).not.toBe(cred) // the hash, not the secret
    // the raw credential appears in NO column of the stored row
    expect(JSON.stringify(row)).not.toContain(cred)
  })
})
