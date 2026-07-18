/**
 * Standalone VGames Identity worker entrypoint (the `vgames-identity` service —
 * see wrangler.identity.toml). Serves ONLY the identity surface via the shared
 * `routeIdentity` router, plus a `/health` probe. It deliberately imports NO
 * GameDO / gameplay / stats module, and its Env has NO Durable Object binding —
 * so this bundle deploys as a second, gameplay-free service bound to the SAME
 * D1. viota-worker keeps serving identity too during the transition; both route
 * through the one `routeIdentity`, so the two can never drift.
 */
import { assertSecret } from './auth'
import { handlePreflight, withCors } from './cors'
import { routeIdentity, type IdentityRouterEnv } from './identity/router'

/** The minimal Env for the identity-only service: D1 + the player `JWT_SECRET`,
 *  the SEPARATE `ADMIN_JWT_SECRET` step-up secret (optional; `/admin/merge`
 *  fail-closes without it), and the `CLIENT_ORIGIN` CORS allowlist (optional).
 *  NO DO binding, NO cron, and — deliberately — NO `IDENTITY_DB` binding: this
 *  service's `DB` binding already IS the identity data (wrangler.identity.toml
 *  keeps a single binding). JWT_SECRET MUST equal viota-worker's so tokens are
 *  interchangeable across both services — see wrangler.identity.toml. */
export interface IdentityServiceEnv {
  DB: D1Database
  JWT_SECRET?: string
  ADMIN_JWT_SECRET?: string
  CLIENT_ORIGIN?: string
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

export default {
  async fetch(request: Request, env: IdentityServiceEnv): Promise<Response> {
    // CORS preflight first — answer OPTIONS for every route before the secret
    // guard, exactly like the main worker (src/index.ts).
    const preflight = handlePreflight(request, env)
    if (preflight) return preflight

    // Liveness probe — answered BEFORE the secret guard so it reports up even on
    // a misconfigured (missing/short JWT_SECRET) deploy.
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return withCors(json({ service: 'vgames-identity' }), request, env)
    }

    // Request-time fail-closed secret guard — before any identity routing, same
    // as the main worker (with CORS so the browser can read the 503).
    const guard = assertSecret(env)
    if (guard) return withCors(guard, request, env)

    // Identity code/data split (Step 1 — A11): `routeIdentity`'s handlers
    // resolve canonical accounts via `env.IDENTITY_DB` (see
    // `identity/authctx.ts`). This service's own wrangler config has only a
    // `DB` binding (it IS the identity data — no split needed on this side),
    // so alias IDENTITY_DB to the SAME D1Database instance here rather than
    // adding a second real binding. Byte-equivalent behavior.
    const routerEnv: IdentityRouterEnv = { ...env, IDENTITY_DB: env.DB }
    const identity = await routeIdentity(request, routerEnv)
    if (identity) return withCors(identity, request, env)

    return withCors(json({ error: 'not_found' }, 404), request, env)
  },
} satisfies ExportedHandler<IdentityServiceEnv>
