import { SELF, env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyGameSchema, applyIdentitySchema } from '../src/d1/schema'
import { signVGamesToken } from '../src/jwt'

const SECRET = 'test-jwt-secret-0123456789-abcdefghijklmnop'
const DB = () => (env as unknown as { DB: D1Database }).DB
const IDENTITY_DB = () => (env as unknown as { IDENTITY_DB: D1Database }).IDENTITY_DB

async function insertAccount(
  id: string,
  displayName: string,
  status: string,
  mergedInto: string | null,
  tokenEpoch: number,
): Promise<void> {
  const now = Date.now()
  await IDENTITY_DB()
    .prepare(
      `INSERT INTO accounts (id,credential_hash,display_name,created_at,status,merged_into,token_epoch,origin_game,must_change_pw,login_fail_count,last_seen_at)
       VALUES (?,?,?,?,?,?,?,'iota',0,0,?)`,
    )
    .bind(id, `ci-${id}`, displayName, now, status, mergedInto, tokenEpoch, now)
    .run()
}

async function insertAliasChain(
  prefix: string,
  aliasCount: number,
): Promise<{ headId: string; aliases: string[] }> {
  const headId = `${prefix}-head`
  await insertAccount(headId, `${prefix} Head`, 'claimed', null, 1)
  const aliases: string[] = []
  let mergedInto = headId
  for (let i = 0; i < aliasCount; i++) {
    const id = `${prefix}-${String(i).padStart(2, '0')}`
    await insertAccount(id, id, 'merged', mergedInto, 0)
    aliases.push(id)
    mergedInto = id
  }
  return { headId, aliases }
}

function intro(token: string): Promise<Response> {
  return SELF.fetch('https://example.com/auth/introspect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
}

describe('/auth/introspect', () => {
  beforeAll(async () => {
    await applyGameSchema(DB())
    await applyIdentitySchema(IDENTITY_DB())
    await insertAccount('ia', 'I', 'claimed', null, 2)
  })

  it('validates a good token and returns canonical id + status', async () => {
    const t = await signVGamesToken({ accountId: 'ia', status: 'claimed', epoch: 2 }, SECRET)
    const r = await intro(t)
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({
      valid: true,
      accountId: 'ia',
      status: 'claimed',
      displayName: 'I',
      aliases: [],
    })
  })

  it('returns a ghost identity receipt', async () => {
    await insertAccount('ghost-receipt', 'Guest', 'ghost', null, 0)
    const token = await signVGamesToken({ accountId: 'ghost-receipt', status: 'ghost', epoch: 0 }, SECRET)

    const body = await (await intro(token)).json()
    expect(body).toEqual({
      valid: true,
      accountId: 'ghost-receipt',
      status: 'ghost',
      displayName: 'Guest',
      aliases: [],
    })
  })

  it('returns the canonical display name and durable sorted aliases', async () => {
    await insertAccount('head', 'theonenonlyvj', 'claimed', null, 4)
    await insertAccount('old-b', 'Old B', 'merged', 'head', 2)
    await insertAccount('old-a', 'Old A', 'merged', 'old-b', 1)
    const token = await signVGamesToken(
      { accountId: 'head', status: 'claimed', epoch: 4 },
      SECRET,
    )

    const body = await (await intro(token)).json()
    expect(body).toEqual({
      valid: true,
      accountId: 'head',
      status: 'claimed',
      displayName: 'theonenonlyvj',
      aliases: ['old-a', 'old-b'],
    })
  })

  it('rejects a malformed cycle that starts from a claimed account', async () => {
    await insertAccount('cycle-a', 'Cycle A', 'claimed', 'cycle-b', 5)
    await insertAccount('cycle-b', 'Cycle B', 'merged', 'cycle-a', 2)
    const token = await signVGamesToken(
      { accountId: 'cycle-a', status: 'claimed', epoch: 5 },
      SECRET,
    )

    const body = await (await intro(token)).json()
    expect(body).toEqual({ valid: false })
  })

  it('returns every alias when the graph contains exactly 64 accounts', async () => {
    const { headId, aliases } = await insertAliasChain('limit', 63)
    const token = await signVGamesToken(
      { accountId: headId, status: 'claimed', epoch: 1 },
      SECRET,
    )

    const body = await (await intro(token)).json()
    expect(body).toEqual({
      valid: true,
      accountId: headId,
      status: 'claimed',
      displayName: 'limit Head',
      aliases,
    })
  })

  it('rejects an alias graph containing more than 64 accounts', async () => {
    const { headId } = await insertAliasChain('over-limit', 64)
    const token = await signVGamesToken(
      { accountId: headId, status: 'claimed', epoch: 1 },
      SECRET,
    )

    const body = await (await intro(token)).json()
    expect(body).toEqual({ valid: false })
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
