import { env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import identityWorker, { type IdentityServiceEnv } from '../src/identity-entry'
import { routeIdentity } from '../src/identity/router'
import { applyIdentitySchema } from '../src/d1/schema'
import { TEST_JWT_SECRET } from './helpers'

/**
 * Task 1 — the standalone `vgames-identity` service. Both viota-worker and this
 * service route the identity surface through the ONE shared `routeIdentity`, so
 * we test that router directly + the entry's fetch with a hand-built env
 * (the pool-workers `SELF` is bound to wrangler.toml = the main worker, so the
 * identity-only entrypoint is exercised via a direct `.fetch(req, env)` call —
 * the same pattern as worker-guard.test.ts).
 *
 * Identity code/data split (Step 1): give `identEnv()`'s `DB` field the
 * `IDENTITY_DB` binding's value, not `DB`'s — that's the store the identity
 * schema is applied to below, and it's what `identityWorker.fetch`'s real env
 * would resolve to in production (its own `DB` binding IS identity data; see
 * `identity-entry.ts`). A direct `routeIdentity(request, identEnv())` call
 * (bypassing `identityWorker.fetch`'s internal DB->IDENTITY_DB aliasing)
 * additionally needs an explicit `IDENTITY_DB` field, since
 * `requireCanonicalAccount` reads that specifically — `identEnv()` sets both
 * to the SAME store so it satisfies either call shape.
 */

const IDENTITY_DB = () => (env as unknown as { IDENTITY_DB: D1Database }).IDENTITY_DB
const identEnv = (): IdentityServiceEnv & { IDENTITY_DB: D1Database } => ({
  DB: IDENTITY_DB(),
  IDENTITY_DB: IDENTITY_DB(),
  JWT_SECRET: TEST_JWT_SECRET,
})

beforeAll(async () => {
  await applyIdentitySchema(IDENTITY_DB())
})

describe('routeIdentity (shared identity router)', () => {
  it('serves POST /auth/quick (mints a quick account)', async () => {
    const res = await routeIdentity(
      new Request('https://id.example.com/auth/quick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceCredential: `dc-${crypto.randomUUID()}`, displayName: 'Router Quick' }),
      }),
      identEnv(),
    )
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    const body = (await res!.json()) as { token: string; accountId: string }
    expect(body.token).toBeTruthy()
    expect(body.accountId).toBeTruthy()
  })

  it('serves POST /auth/login (unknown creds -> 401, still routed) and POST /auth/introspect (bad token -> {valid:false})', async () => {
    const introspect = await routeIdentity(
      new Request('https://id.example.com/auth/introspect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'not-a-real-token' }),
      }),
      identEnv(),
    )
    expect(introspect).not.toBeNull()
    expect(introspect!.status).toBe(200)
    expect(await introspect!.json()).toEqual({ valid: false })

    const login = await routeIdentity(
      new Request('https://id.example.com/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: `nobody-${crypto.randomUUID().slice(0, 8)}`, password: 'irrelevant-here' }),
      }),
      identEnv(),
    )
    expect(login).not.toBeNull()
    expect(login!.status).toBe(401)
  })

  it('returns null for a non-identity (gameplay) path', async () => {
    expect(await routeIdentity(new Request('https://id.example.com/me/stats'), identEnv())).toBeNull()
    expect(
      await routeIdentity(new Request('https://id.example.com/games', { method: 'POST', body: '{}' }), identEnv()),
    ).toBeNull()
  })
})

describe('identity-entry (vgames-identity service fetch)', () => {
  it('GET /health -> 200 {"service":"vgames-identity"}', async () => {
    const res = await identityWorker.fetch(new Request('https://id.example.com/health'), identEnv())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ service: 'vgames-identity' })
  })

  it('serves an identity route (POST /auth/quick)', async () => {
    const res = await identityWorker.fetch(
      new Request('https://id.example.com/auth/quick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceCredential: `dc-${crypto.randomUUID()}`, displayName: 'Entry Quick' }),
      }),
      identEnv(),
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { accountId: string }).accountId).toBeTruthy()
  })

  it('404s POST /claim — /claim is GAME-domain (re-tags viota game_players) and must NEVER return to the identity surface (split Step 2 regression lock)', async () => {
    const res = await identityWorker.fetch(
      new Request('https://id.example.com/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ghostId: 'g'.repeat(64), deviceCredential: 'dc-claim-regression-0000' }),
      }),
      identEnv(),
    )
    expect(res.status).toBe(404)
  })

  it('404s a gameplay route (POST /games, GET /me/stats)', async () => {
    const games = await identityWorker.fetch(
      new Request('https://id.example.com/games', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      identEnv(),
    )
    expect(games.status).toBe(404)
    const meStats = await identityWorker.fetch(new Request('https://id.example.com/me/stats'), identEnv())
    expect(meStats.status).toBe(404)
  })

  it('fail-closes 503 without JWT_SECRET, but /health stays 200', async () => {
    const badEnv = { DB: IDENTITY_DB() } as IdentityServiceEnv
    const guarded = await identityWorker.fetch(
      new Request('https://id.example.com/auth/introspect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'x' }),
      }),
      badEnv,
    )
    expect(guarded.status).toBe(503)
    const health = await identityWorker.fetch(new Request('https://id.example.com/health'), badEnv)
    expect(health.status).toBe(200)
  })

  it('answers a CORS preflight (OPTIONS) with 204', async () => {
    const res = await identityWorker.fetch(
      new Request('https://id.example.com/auth/quick', { method: 'OPTIONS' }),
      identEnv(),
    )
    expect(res.status).toBe(204)
  })
})
