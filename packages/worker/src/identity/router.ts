/**
 * The shared VGames Identity HTTP router — the ONE place the identity surface is
 * wired. BOTH deployables route through it so they can never drift:
 *  - the viota Worker (`src/index.ts`), which keeps serving identity during the
 *    transition period alongside gameplay, and
 *  - the standalone `vgames-identity` service (`src/identity-entry.ts`), which
 *    serves ONLY identity, bound to the SAME D1.
 *
 * `routeIdentity` returns the identity route's `Response`, or `null` when the
 * path is not an identity route (the caller then continues its own routing).
 */
import { handleAuthQuick } from '../d1/accounts'
import { handleClaim } from '../d1/claim'
import { handleSetCredentials, handleLogin, handleIntrospect, handleAdminMerge } from './routes'
import type { IdentityEnv } from './authctx'
import type { AdminEnv } from './admin'

/** The env every identity route needs: D1 + the player `JWT_SECRET`, plus the
 *  SEPARATE `ADMIN_JWT_SECRET` step-up secret used ONLY by `/admin/merge`. A
 *  strict subset of the main Worker `Env` (no Durable Object binding), so the
 *  gameplay-free `vgames-identity` service can satisfy it. */
export type IdentityRouterEnv = IdentityEnv & AdminEnv

export async function routeIdentity(request: Request, env: IdentityRouterEnv): Promise<Response | null> {
  const { pathname: path } = new URL(request.url)

  // POST /auth/quick -> mint-or-authenticate a quick account (D1 accounts).
  if (request.method === 'POST' && path === '/auth/quick') return handleAuthQuick(request, env)

  // POST /auth/set-credentials -> VGames identity: claim username+password onto
  // the caller's current ghost account, in place (Bearer-authed).
  if (request.method === 'POST' && path === '/auth/set-credentials') return handleSetCredentials(request, env)

  // POST /auth/login -> VGames identity: username+password login, binds the
  // presenting device, mints a fresh vgames token.
  if (request.method === 'POST' && path === '/auth/login') return handleLogin(request, env)

  // POST /auth/introspect -> VGames identity: server-to-server token validation
  // (always 200; validity is in the body). Used by other games' servers (e.g.
  // vjaipur) to verify a client-presented vgames token.
  if (request.method === 'POST' && path === '/auth/introspect') return handleIntrospect(request, env)

  // POST /admin/merge -> VGames identity: operator-driven account merge. Gated
  // by a SEPARATE admin step-up token (ADMIN_JWT_SECRET), never the
  // player-facing JWT_SECRET.
  if (request.method === 'POST' && path === '/admin/merge') return handleAdminMerge(request, env)

  // POST /claim -> claim device ghost games into the authed account.
  if (request.method === 'POST' && path === '/claim') return handleClaim(request, env)

  return null
}
