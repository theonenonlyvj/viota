/**
 * The Worker origin the net layer talks to.
 *
 * Dev: Vite (client) and `wrangler dev` (Worker, default :8787) are DIFFERENT
 * origins, so a same-origin default is wrong in dev. Override with VITE_SERVER_URL.
 * Prod: same-origin (Pages + Worker behind one host) unless VITE_SERVER_URL is set.
 */
export function serverUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env ?? {}
  const explicit = env.VITE_SERVER_URL
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  if (env.DEV) return 'http://localhost:8787'
  if (typeof window !== 'undefined' && window.location) return window.location.origin
  return 'http://localhost:8787'
}

/**
 * The identity-service origin — `/auth/*` ONLY (identity code/data split,
 * A2/2a). `net/identity.ts` (`quickAuth`/`reAuth`) and `net/account.ts`
 * (`claimAccount`/`loginAccount`) resolve this internally, so `http.ts`'s
 * silent 401-reAuth path repoints atomically for every caller the instant
 * this function's default changes — no caller passes an auth origin in.
 * `/claim` and every game call (`/games/*`, `/leaderboard`, `/me/stats`)
 * are UNRELATED to this — they always use `serverUrl()`.
 *
 * Prod default: the standalone `vgames-identity` Worker — override with
 * VITE_AUTH_URL (e.g. to point at a specific deploy during the transition).
 * Dev: local `wrangler dev` still serves the identity surface itself during
 * the migration grace period (see src/index.ts's routeIdentity), so this
 * falls back to `serverUrl()` rather than a separate local identity port.
 */
export function authUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env ?? {}
  const explicit = env.VITE_AUTH_URL
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  if (env.DEV) return serverUrl()
  return 'https://vgames-identity.theonenonlyvj.workers.dev'
}
