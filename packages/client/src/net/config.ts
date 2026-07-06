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
