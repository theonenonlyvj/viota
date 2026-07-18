import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyGameSchema, applyIdentitySchema } from '../src/d1/schema'
import { reconcileOneMerge } from '../src/do/reconcile'
import { SignJWT } from 'jose'
import worker from '../src/index'

/**
 * Identity code/data split (A6) — GET /admin/merge-audit?from=&into= on
 * viota-worker: the game-domain half of the pre-merge audit (selfPlayFlags
 * the reconciler has recorded in merge_selfplay_flags + live game_players
 * counts), gated by the SAME ADMIN_JWT_SECRET step-up as /admin/merge and
 * /admin/backfill-stats.
 */

const ADMIN_SECRET = 'admin-secret-0123456789-abcdefghijklmnop'
const DB = () => (env as unknown as { DB: D1Database }).DB
const IDENTITY_DB = () => (env as unknown as { IDENTITY_DB: D1Database }).IDENTITY_DB

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

async function mkGame(gameUuid: string): Promise<void> {
  await DB()
    .prepare(`INSERT INTO games (game_uuid, mode, status, player_count, created_at, game_type) VALUES (?,'online','completed',2,?,'iota')`)
    .bind(gameUuid, Date.now())
    .run()
}

async function mkSeat(gameUuid: string, seatIndex: number, accountId: string): Promise<void> {
  await DB()
    .prepare(`INSERT INTO game_players (game_uuid, seat_index, account_id, owner_type) VALUES (?,?,?,'human')`)
    .bind(gameUuid, seatIndex, accountId)
    .run()
}

async function audit(tok: string | null, params: string, envOverrides: Record<string, unknown> = { ADMIN_JWT_SECRET: ADMIN_SECRET }): Promise<Response> {
  const ctx = createExecutionContext()
  const res = await worker.fetch(
    new Request(`https://x/admin/merge-audit${params}`, {
      headers: tok ? { authorization: 'Bearer ' + tok } : {},
    }),
    { ...env, ...envOverrides } as any,
    ctx,
  )
  await waitOnExecutionContext(ctx)
  return res
}

describe('GET /admin/merge-audit', () => {
  beforeAll(async () => {
    await applyGameSchema(DB())
    await applyIdentitySchema(IDENTITY_DB())
  })

  it('401s without an admin token', async () => {
    expect((await audit(null, '?from=a&into=b')).status).toBe(401)
  })

  it('401s when ADMIN_JWT_SECRET is unset (server misconfigured)', async () => {
    const tok = await adminTok()
    expect((await audit(tok, '?from=a&into=b', { ADMIN_JWT_SECRET: undefined })).status).toBe(401)
  })

  it('401s a token signed with the wrong secret', async () => {
    const badTok = await adminTok('wrong-secret-0123456789-abcdefgh')
    expect((await audit(badTok, '?from=a&into=b')).status).toBe(401)
  })

  it('400s when from/into are missing', async () => {
    const tok = await adminTok()
    expect((await audit(tok, '')).status).toBe(400)
    expect((await audit(tok, '?from=a')).status).toBe(400)
  })

  it('returns correct gamePlayersCounts and selfPlayFlags under a valid admin token', async () => {
    const from = `ama-from-${crypto.randomUUID()}`
    const into = `ama-into-${crypto.randomUUID()}`
    const g1 = `ama-g1-${crypto.randomUUID()}`
    const g2 = `ama-g2-${crypto.randomUUID()}`
    await mkGame(g1)
    await mkGame(g2)
    // from has 2 seats (g1, g2); into has 1 (g1, a DIFFERENT seat -> self-play).
    await mkSeat(g1, 0, from)
    await mkSeat(g1, 1, into)
    await mkSeat(g2, 0, from)

    // Run the reconciler's per-merge logic directly (not the merge itself —
    // this test only cares about the audit READ side) so merge_selfplay_flags
    // gets populated exactly like a real cron sweep would.
    await reconcileOneMerge(DB(), { fromAccountId: from, intoAccountId: into }, Date.now())

    const tok = await adminTok()
    const res = await audit(tok, `?from=${from}&into=${into}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { selfPlayFlags: string[]; gamePlayersCounts: { from: number; into: number } }
    expect(body.selfPlayFlags).toEqual([g1])
    // Post-reconcile: every `from`-tagged row (g1 seat0, g2 seat0) is now
    // `into` too, on top of `into`'s own original seat (g1 seat1) -> 0/3.
    expect(body.gamePlayersCounts).toEqual({ from: 0, into: 3 })
  })

  it('returns empty/zero for an account pair with no games or no self-play', async () => {
    const from = `ama-empty-from-${crypto.randomUUID()}`
    const into = `ama-empty-into-${crypto.randomUUID()}`
    const tok = await adminTok()
    const res = await audit(tok, `?from=${from}&into=${into}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ selfPlayFlags: [], gamePlayersCounts: { from: 0, into: 0 } })
  })
})
