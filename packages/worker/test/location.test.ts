import { env } from 'cloudflare:test'
import { it, expect, describe, beforeAll } from 'vitest'
import { applyD1Schema } from '../src/d1/schema'
import { handleAuthQuick } from '../src/d1/accounts'

const DB = () => (env as unknown as { DB: D1Database }).DB
const ENV = () => env as unknown as { DB: D1Database; JWT_SECRET?: string }

beforeAll(async () => {
  await applyD1Schema(DB())
})

function mintCredential(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A minimal Request stub carrying only what handleAuthQuick reads: json() + cf. */
function reqWith(body: object, cf?: unknown): Request {
  return { json: async () => body, cf } as unknown as Request
}

async function geoRow(accountId: string) {
  return DB()
    .prepare('SELECT country, region, timezone FROM accounts WHERE id = ?')
    .bind(accountId)
    .first<{ country: string | null; region: string | null; timezone: string | null }>()
}

describe('POST /auth/quick captures coarse request.cf geo', () => {
  it('stores country/region/timezone from a mocked request.cf at account creation', async () => {
    const cred = mintCredential()
    const res = await handleAuthQuick(
      reqWith({ deviceCredential: cred, displayName: 'Geo' }, { country: 'US', region: 'Texas', timezone: 'America/Chicago' }),
      ENV(),
    )
    expect(res.status).toBe(200)
    const { accountId } = (await res.json()) as { accountId: string }
    expect(await geoRow(accountId)).toEqual({ country: 'US', region: 'Texas', timezone: 'America/Chicago' })
  })

  it('stores nulls when request.cf is absent (Miniflare/tests) and still succeeds', async () => {
    const res = await handleAuthQuick(reqWith({ deviceCredential: mintCredential(), displayName: 'NoGeo' }), ENV())
    expect(res.status).toBe(200)
    const { accountId } = (await res.json()) as { accountId: string }
    expect(await geoRow(accountId)).toEqual({ country: null, region: null, timezone: null })
  })

  it('tolerates a partial cf (missing fields -> null) without throwing', async () => {
    const res = await handleAuthQuick(
      reqWith({ deviceCredential: mintCredential(), displayName: 'Partial' }, { country: 'CA' }),
      ENV(),
    )
    expect(res.status).toBe(200)
    const { accountId } = (await res.json()) as { accountId: string }
    expect(await geoRow(accountId)).toEqual({ country: 'CA', region: null, timezone: null })
  })

  it('does NOT overwrite geo on re-auth of an existing account (INSERT-only)', async () => {
    const cred = mintCredential()
    const first = (await (await handleAuthQuick(
      reqWith({ deviceCredential: cred, displayName: 'First' }, { country: 'US', region: 'Texas', timezone: 'America/Chicago' }),
      ENV(),
    )).json()) as { accountId: string }

    // Re-auth the SAME credential from a different location — geo must not change.
    const again = (await (await handleAuthQuick(
      reqWith({ deviceCredential: cred, displayName: 'First' }, { country: 'GB', region: 'England', timezone: 'Europe/London' }),
      ENV(),
    )).json()) as { accountId: string }
    expect(again.accountId).toBe(first.accountId)
    expect(await geoRow(first.accountId)).toEqual({ country: 'US', region: 'Texas', timezone: 'America/Chicago' })
  })
})
