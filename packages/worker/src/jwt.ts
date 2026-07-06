import { SignJWT, jwtVerify } from 'jose'

/**
 * JWT sign/verify via `jose`, PINNED to HS256.
 *
 * The token carries ONLY the account id (as the subject) plus iss/aud/exp —
 * NEVER a seat or room. Seat/room ownership is resolved LIVE per request from
 * the seats table, never trusted from a token claim (a stale token must never
 * be able to assert it still owns a seat it was reclaimed out of).
 *
 * The `algorithms: ['HS256']` allowlist on verify is MANDATORY: without it,
 * `jose` would accept `alg:none` and RS/HS alg-confusion tokens. Verify also
 * pins `issuer`/`audience`, so a token minted for another service is rejected.
 */

const ISSUER = 'viota'
const AUDIENCE = 'viota-web'
const TTL_SECONDS = 24 * 60 * 60 // 24h

function keyFor(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

/**
 * Sign a 24h HS256 token whose subject is `accountId`.
 *
 * `now` (ms) is injectable for deterministic tests (e.g. mint an already-expired
 * token by passing a `now` in the past). In production it is omitted, and the
 * pinned relative `'24h'` expiry is used off the real clock.
 */
export async function signToken(accountId: string, secret: string, now?: number): Promise<string> {
  const builder = new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(accountId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
  if (now === undefined) {
    builder.setIssuedAt().setExpirationTime('24h')
  } else {
    const iat = Math.floor(now / 1000)
    builder.setIssuedAt(iat).setExpirationTime(iat + TTL_SECONDS)
  }
  return builder.sign(keyFor(secret))
}

/**
 * Verify a token and return its account id, or `null` on ANY failure
 * (bad signature, tampering, `alg:none`, wrong issuer/audience, expiry, or a
 * missing/blank subject). Never throws — callers branch on `null`.
 */
export async function verifyToken(token: string, secret: string): Promise<{ accountId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, keyFor(secret), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    })
    const sub = payload.sub
    if (typeof sub !== 'string' || sub.length === 0) return null
    return { accountId: sub }
  } catch {
    return null
  }
}
