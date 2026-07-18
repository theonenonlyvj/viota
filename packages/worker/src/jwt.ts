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
 *
 * `ttlSeconds` (only consulted when `now` is also given) overrides the pinned
 * 24h TTL — used ONLY by the token-fixture generator (A7,
 * `test/fixtures/generate-token-contract.ts`) to mint a checked-in "valid"
 * fixture that stays valid for the fixture's whole shelf life, not just 24h
 * from generation, while still going through the REAL signing code path (so
 * a future claim-shape change is caught by regenerating the fixture, not
 * silently missed by a hand-rolled token). Never used by production code.
 */
export async function signToken(accountId: string, secret: string, now?: number, ttlSeconds: number = TTL_SECONDS): Promise<string> {
  const builder = new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(accountId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
  if (now === undefined) {
    builder.setIssuedAt().setExpirationTime('24h')
  } else {
    const iat = Math.floor(now / 1000)
    builder.setIssuedAt(iat).setExpirationTime(iat + ttlSeconds)
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

/**
 * VGames identity token extension (additive — does NOT change `signToken`/
 * `verifyToken` above, which viota's own live auth stays pinned to).
 *
 * New `vgames`/`vgames-web` iss/aud + an additive `epoch` claim (bumped on
 * credential change/merge so a stolen-but-superseded token stops verifying —
 * see `identity/authctx.ts`) + `status`. `verifyAnyToken` accepts BOTH the
 * legacy `viota`/`viota-web` tokens `/auth/quick` still mints and these new
 * `vgames`/`vgames-web` tokens, so a legacy session never breaks. TTL is 1h
 * (shorter than the legacy 24h) since epoch-checked tokens are cheap to renew.
 */
const VGAMES_ISS = 'vgames'
const VGAMES_AUD = 'vgames-web'
const VG_TTL_SECONDS = 60 * 60 // 1h

export async function signVGamesToken(
  p: { accountId: string; status: string; epoch: number },
  secret: string,
  opts: { iss?: string; aud?: string; now?: number; ttlSeconds?: number } = {},
): Promise<string> {
  const iat = Math.floor((opts.now ?? Date.now()) / 1000)
  return new SignJWT({ status: p.status, epoch: p.epoch })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(p.accountId)
    .setIssuer(opts.iss ?? VGAMES_ISS)
    .setAudience(opts.aud ?? VGAMES_AUD)
    .setIssuedAt(iat)
    .setExpirationTime(iat + (opts.ttlSeconds ?? VG_TTL_SECONDS))
    .sign(keyFor(secret))
}

/**
 * Verify a token that may be EITHER a legacy viota token or a new vgames
 * token, and return its claims — never throws. `epoch`/`status` are
 * `undefined` for a legacy token (it never carried them); callers treat an
 * absent epoch as 0 (no staleness check possible/needed for legacy sessions).
 */
export async function verifyAnyToken(
  token: string,
  secret: string,
): Promise<{ accountId: string; status?: string; epoch?: number } | null> {
  try {
    const { payload } = await jwtVerify(token, keyFor(secret), {
      algorithms: ['HS256'],
      issuer: [VGAMES_ISS, ISSUER],
      audience: [VGAMES_AUD, AUDIENCE],
    })
    const sub = payload.sub
    if (typeof sub !== 'string' || sub.length === 0) return null
    return {
      accountId: sub,
      status: typeof payload.status === 'string' ? payload.status : undefined,
      epoch: typeof payload.epoch === 'number' ? payload.epoch : undefined,
    }
  } catch {
    return null
  }
}
