import { env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyIdentitySchema } from '../src/d1/schema'
import { signVGamesToken, signToken } from '../src/jwt'
import { requireCanonicalAccount } from '../src/identity/authctx'

const SECRET = 'test-jwt-secret-0123456789-abcdefghijklmnop'
const IDENTITY_DB = () => (env as unknown as { IDENTITY_DB: D1Database }).IDENTITY_DB
const ENV = () => ({ ...(env as unknown as { DB: D1Database; IDENTITY_DB: D1Database; JWT_SECRET?: string }) })

const req = (tok: string) => new Request('https://x/whatever', { headers: { authorization: 'Bearer ' + tok } })

describe('requireCanonicalAccount', () => {
  beforeAll(async () => {
    await applyIdentitySchema(IDENTITY_DB())
    const now = Date.now()
    await IDENTITY_DB()
      .prepare(
        `INSERT INTO accounts (id,credential_hash,display_name,created_at,status,token_epoch,origin_game,must_change_pw,login_fail_count,last_seen_at) VALUES ('live','chl','L',?,'claimed',5,'iota',0,0,?)`,
      )
      .bind(now, now)
      .run()
    await IDENTITY_DB()
      .prepare(
        `INSERT INTO accounts (id,credential_hash,display_name,created_at,status,token_epoch,merged_into,origin_game,must_change_pw,login_fail_count,last_seen_at) VALUES ('dead','chd','D',?,'merged',9,'live','iota',0,0,?)`,
      )
      .bind(now, now)
      .run()
    await IDENTITY_DB()
      .prepare(
        `INSERT INTO accounts (id,credential_hash,display_name,created_at,status,token_epoch,origin_game,must_change_pw,login_fail_count,last_seen_at) VALUES ('legacy1','chleg','Leg',?,'ghost',0,'iota',0,0,?)`,
      )
      .bind(now, now)
      .run()
  })

  it('accepts a current-epoch token and returns canonical id', async () => {
    const t = await signVGamesToken({ accountId: 'live', status: 'claimed', epoch: 5 }, SECRET)
    const r = await requireCanonicalAccount(req(t), ENV())
    expect((r as any).accountId).toBe('live')
  })

  it('rejects a stale-epoch token', async () => {
    const t = await signVGamesToken({ accountId: 'live', status: 'claimed', epoch: 4 }, SECRET)
    const r = await requireCanonicalAccount(req(t), ENV())
    expect((r as Response).status).toBe(401)
  })

  it('rejects a token for a merged account (epoch was bumped on merge)', async () => {
    const t = await signVGamesToken({ accountId: 'dead', status: 'claimed', epoch: 8 }, SECRET) // stale (real is 9)
    const r = await requireCanonicalAccount(req(t), ENV())
    expect((r as Response).status).toBe(401)
  })

  it('accepts a legacy viota token (no epoch claim) and resolves it', async () => {
    const t = await signToken('legacy1', SECRET)
    const r = await requireCanonicalAccount(req(t), ENV())
    expect((r as any).accountId).toBe('legacy1')
  })
})
