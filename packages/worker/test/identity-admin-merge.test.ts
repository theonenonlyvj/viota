import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyD1Schema } from '../src/d1/schema'
import { SignJWT } from 'jose'
import worker from '../src/index'

const ADMIN_SECRET = 'admin-secret-0123456789-abcdefghijklmnop'
const DB = () => (env as unknown as { DB: D1Database }).DB

async function adminTok(secret = ADMIN_SECRET, aud = 'vgames-admin', iss = 'vgames'): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('vijay')
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(secret))
}

async function mkGhost(id: string): Promise<void> {
  const now = Date.now()
  await DB()
    .prepare(
      `INSERT INTO accounts (id,credential_hash,display_name,created_at,status,token_epoch,origin_game,must_change_pw,login_fail_count,last_seen_at) VALUES (?,?,?,?,'ghost',0,'iota',0,0,?)`,
    )
    .bind(id, 'c' + id, id, now, now)
    .run()
}

async function merge(tok: string | null, body: unknown, envOverrides: Record<string, unknown> = { ADMIN_JWT_SECRET: ADMIN_SECRET }): Promise<Response> {
  const ctx = createExecutionContext()
  const res = await worker.fetch(
    new Request('https://x/admin/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) },
      body: JSON.stringify(body),
    }),
    { ...env, ...envOverrides } as any,
    ctx,
  )
  await waitOnExecutionContext(ctx)
  return res
}

describe('/admin/merge', () => {
  beforeAll(async () => {
    await applyD1Schema(DB())
  })

  it('401s without an admin token', async () => {
    expect((await merge(null, { fromAccountId: 'a', intoAccountId: 'b', dryRun: true })).status).toBe(401)
  })

  it('401s when ADMIN_JWT_SECRET is unset (server misconfigured)', async () => {
    const tok = await adminTok()
    const r = await merge(tok, { fromAccountId: 'a', intoAccountId: 'b', dryRun: true }, { ADMIN_JWT_SECRET: undefined })
    expect(r.status).toBe(401)
  })

  it('401s a token signed with the wrong secret', async () => {
    const badTok = await adminTok('wrong-secret-0123456789-abcdefgh')
    expect((await merge(badTok, { fromAccountId: 'a', intoAccountId: 'b', dryRun: true })).status).toBe(401)
  })

  it('401s a token with the wrong audience', async () => {
    const wrongAud = await adminTok(ADMIN_SECRET, 'vgames-web')
    expect((await merge(wrongAud, { fromAccountId: 'a', intoAccountId: 'b', dryRun: true })).status).toBe(401)
  })

  it('401s a token with the wrong issuer', async () => {
    const wrongIss = await adminTok(ADMIN_SECRET, 'vgames-admin', 'vgames-web')
    expect((await merge(wrongIss, { fromAccountId: 'a', intoAccountId: 'b', dryRun: true })).status).toBe(401)
  })

  it('dry-run returns counts under a valid admin token, without writing', async () => {
    await mkGhost('ma')
    await mkGhost('mb')
    const r = await merge(await adminTok(), { fromAccountId: 'ma', intoAccountId: 'mb', dryRun: true, reason: 'irl' })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { dryRun: boolean; ok: boolean }
    expect(body.dryRun).toBe(true)
    expect(body.ok).toBe(true)
    const row = await DB().prepare(`SELECT status FROM accounts WHERE id='ma'`).first<{ status: string }>()
    expect(row!.status).toBe('ghost') // unchanged
  })

  it('400s a real merge (dryRun:false) without a confirmNonce', async () => {
    await mkGhost('mc')
    await mkGhost('md')
    const r = await merge(await adminTok(), { fromAccountId: 'mc', intoAccountId: 'md', dryRun: false })
    expect(r.status).toBe(400)
    const row = await DB().prepare(`SELECT status FROM accounts WHERE id='mc'`).first<{ status: string }>()
    expect(row!.status).toBe('ghost') // never merged
  })

  it('performs a real merge given dryRun:false + a confirmNonce, actor is admin:vijay', async () => {
    await mkGhost('me')
    await mkGhost('mf')
    const r = await merge(await adminTok(), { fromAccountId: 'me', intoAccountId: 'mf', dryRun: false, confirmNonce: 'ack-1', reason: 'dup' })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { dryRun: boolean; ok: boolean }
    expect(body).toMatchObject({ dryRun: false, ok: true })
    const row = await DB().prepare(`SELECT status, merged_into FROM accounts WHERE id='me'`).first<{ status: string; merged_into: string }>()
    expect(row).toMatchObject({ status: 'merged', merged_into: 'mf' })
    const auditRow = await DB().prepare(`SELECT merged_by FROM account_merges WHERE from_account_id='me'`).first<{ merged_by: string }>()
    expect(auditRow!.merged_by).toBe('admin:vijay')
  })
})
