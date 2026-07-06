import { SELF, env } from 'cloudflare:test'
import { it, expect, describe, beforeAll } from 'vitest'
import { applyD1Schema } from '../src/d1/schema'
import { hashCredential } from '../src/d1/accounts'

const DB = () => (env as unknown as { DB: D1Database }).DB

function mintCredential(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Create a quick account, returning its token + accountId. */
async function quickAccount(cred: string, name: string): Promise<{ token: string; accountId: string }> {
  const res = await SELF.fetch('https://example.com/auth/quick', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceCredential: cred, displayName: name }),
  })
  return (await res.json()) as { token: string; accountId: string }
}

/** Seed a solo ghost game_players row keyed by ghost_id (= hash of the device cred). */
async function seedGhostGame(ghostId: string): Promise<string> {
  const gameUuid = `ghost-${crypto.randomUUID()}`
  await DB()
    .prepare(
      `INSERT INTO game_players (game_uuid, seat_index, account_id, ghost_id, owner_type, display_name, final_score)
       VALUES (?, 0, NULL, ?, 'ghost', 'Solo', NULL)`,
    )
    .bind(gameUuid, ghostId)
    .run()
  return gameUuid
}

async function claim(token: string, ghostId: string, deviceCredential: string): Promise<Response> {
  return SELF.fetch('https://example.com/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ghostId, deviceCredential }),
  })
}

beforeAll(async () => {
  await applyD1Schema(DB())
})

describe('POST /claim', () => {
  it('a valid claim reassigns the ghost games to the caller, idempotently', async () => {
    const credA = mintCredential()
    const a = await quickAccount(credA, 'Ann')
    const ghostId = await hashCredential(credA) // ghost games are keyed by the credential
    const g1 = await seedGhostGame(ghostId)
    const g2 = await seedGhostGame(ghostId)

    const res = await claim(a.token, ghostId, credA)
    expect(res.status).toBe(200)
    expect((await res.json()).claimed).toBe(2)

    const rows = await DB()
      .prepare('SELECT account_id FROM game_players WHERE game_uuid IN (?, ?)')
      .bind(g1, g2)
      .all<{ account_id: string }>()
    expect(rows.results.every((r) => r.account_id === a.accountId)).toBe(true)

    // A second identical claim is a benign 0-change no-op (still owned by A).
    const again = await claim(a.token, ghostId, credA)
    expect(again.status).toBe(200)
    expect((await again.json()).claimed).toBe(0)
  })

  it('account B CANNOT claim account A ghost games with the wrong credential (403)', async () => {
    const credA = mintCredential()
    const ghostId = await hashCredential(credA)
    const gA = await seedGhostGame(ghostId)

    const credB = mintCredential()
    const b = await quickAccount(credB, 'Bob') // B is a valid, authenticated account...

    // ...but B presents ITS OWN credential, which does not hash to A's ghost id.
    const res = await claim(b.token, ghostId, credB)
    expect(res.status).toBe(403)

    // A's ghost game is untouched (never reassigned to B).
    const row = await DB().prepare('SELECT account_id FROM game_players WHERE game_uuid = ?').bind(gA).first<{ account_id: string | null }>()
    expect(row!.account_id).toBeNull()
  })

  it('rejects an unauthenticated claim (401)', async () => {
    const cred = mintCredential()
    const ghostId = await hashCredential(cred)
    const res = await SELF.fetch('https://example.com/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ghostId, deviceCredential: cred }),
    })
    expect(res.status).toBe(401)
  })
})
