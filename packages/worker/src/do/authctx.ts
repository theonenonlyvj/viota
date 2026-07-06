import { verifyToken } from '../jwt'

/**
 * Per-request authentication context.
 *
 * Every mutating/reading DO endpoint runs `requireAuth` FIRST: it pulls the
 * Bearer token from the `Authorization` header, verifies it (HS256, pinned
 * iss/aud), and yields the account id. On any failure it returns a 401 the
 * handler returns verbatim. The token carries ONLY the account id — the acting
 * SEAT is resolved live from the seats table per request (never a token claim),
 * so a stale token can never assert ownership of a seat it was reclaimed out of.
 *
 * WebSocket auth does NOT use the header (there is none on a WS frame) — it
 * verifies the first-frame token via `authenticateToken`.
 */

export type AuthOk = { accountId: string }

export type AuthEnv = { JWT_SECRET?: string }

function unauthorized(reason: string): Response {
  return new Response(JSON.stringify({ error: 'unauthorized', reason }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

/** Extract the raw token from an `Authorization: Bearer <token>` header. */
export function extractBearerToken(request: Request): string | null {
  const h = request.headers.get('Authorization')
  if (!h) return null
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  const token = m ? m[1]!.trim() : ''
  return token.length > 0 ? token : null
}

/**
 * @returns `{accountId}` on success, or a 401 `Response` the handler returns as-is.
 * The secret is already validated by `assertSecret` at the top of `fetch()`;
 * the missing-secret branch here is defensive (fail-closed) only.
 */
export async function requireAuth(request: Request, env: AuthEnv): Promise<AuthOk | Response> {
  const secret = env.JWT_SECRET
  if (!secret) return unauthorized('server_misconfigured')
  const token = extractBearerToken(request)
  if (!token) return unauthorized('missing_token')
  const verified = await verifyToken(token, secret)
  if (!verified) return unauthorized('invalid_token')
  return verified
}

/** Verify a raw token string (the WS first-frame handshake), null on failure. */
export async function authenticateToken(
  token: string | null | undefined,
  env: AuthEnv,
): Promise<AuthOk | null> {
  const secret = env.JWT_SECRET
  if (!secret || typeof token !== 'string' || token.length === 0) return null
  return verifyToken(token, secret)
}
