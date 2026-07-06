/**
 * CORS middleware — pinned to the configured client origin (spec §6 anti-cheat:
 * "CORS pinned to the Pages origin (fixes today's `*`)").
 *
 * The deployed topology is CROSS-ORIGIN: the client is served from Cloudflare
 * Pages (`*.pages.dev` / a custom domain) and the API is the Worker on
 * `*.workers.dev` — these are DIFFERENT origins, so every browser call is a CORS
 * request and the Worker MUST opt the Pages origin in or the browser blocks it.
 *
 * Auth model is a bearer token in the `Authorization` header, NOT cookies — so
 * we never send `Access-Control-Allow-Credentials`, and reflecting the single
 * configured origin (never `*` in prod, never an arbitrary origin ever) is the
 * correct, safe policy. Applied to every HTTP route; the WebSocket upgrade is
 * exempt (the WS handshake is not governed by fetch CORS).
 */

/** The env surface CORS reads — a subset of the Worker Env (easy to fake). */
export interface CorsEnv {
  /** The exact allowed browser origin (the Pages URL). Set in prod via a
   *  `[vars]` entry or `wrangler secret put CLIENT_ORIGIN`. Unset only in local
   *  dev, where we fall back to a permissive `*`. */
  CLIENT_ORIGIN?: string
}

const ALLOW_METHODS = 'GET,POST,OPTIONS'
const ALLOW_HEADERS = 'Authorization,Content-Type'
const MAX_AGE = '86400' // 24h — cache the preflight so it isn't re-sent per call

/**
 * Compute the CORS response headers for a request.
 *
 *  - `CLIENT_ORIGIN` set + request `Origin` EXACTLY equals it → reflect it in
 *    `Access-Control-Allow-Origin` (the ONLY origin we ever allow).
 *  - `CLIENT_ORIGIN` set + a foreign/absent `Origin` → emit NO `Allow-Origin`
 *    (the browser then blocks the cross-origin read). We NEVER reflect an
 *    arbitrary origin — exact string equality only, so `pages.dev.evil.com`
 *    never matches `pages.dev`.
 *  - `CLIENT_ORIGIN` unset (local dev) → permissive `*`. Safe ONLY because the
 *    auth is a bearer token, never a cookie. PRODUCTION MUST set `CLIENT_ORIGIN`.
 *
 * `Vary: Origin` is always set so a shared cache can never hand one origin's
 * `Access-Control-Allow-Origin` to a different origin.
 */
export function corsHeaders(request: Request, env: CorsEnv): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Max-Age': MAX_AGE,
    Vary: 'Origin',
  }

  const configured = env.CLIENT_ORIGIN
  const origin = request.headers.get('Origin')

  if (!configured) {
    headers['Access-Control-Allow-Origin'] = '*'
  } else if (origin !== null && origin === configured) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  // configured + foreign origin → deliberately omit Allow-Origin (block).

  return headers
}

/**
 * Answer a CORS preflight. Returns a 204 with the CORS headers for an `OPTIONS`
 * request, or `null` for any other method (the caller continues routing). A
 * foreign-origin preflight still returns 204 but carries no `Allow-Origin`, so
 * the browser blocks the follow-up request — exactly the intended outcome.
 */
export function handlePreflight(request: Request, env: CorsEnv): Response | null {
  if (request.method !== 'OPTIONS') return null
  return new Response(null, { status: 204, headers: corsHeaders(request, env) })
}

/**
 * Return a copy of `response` with the CORS headers merged in. The body is a
 * `ReadableStream` re-passed to a fresh `Response` (not consumed here). Do NOT
 * call this on a 101 WebSocket-upgrade response — its headers are immutable and
 * the WS handshake is not a CORS-governed fetch.
 */
export function withCors(response: Response, request: Request, env: CorsEnv): Response {
  const merged = new Headers(response.headers)
  for (const [k, v] of Object.entries(corsHeaders(request, env))) merged.set(k, v)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  })
}
