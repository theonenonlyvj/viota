/**
 * Request-time secret guard.
 *
 * Workers has no boot phase and secret bindings only exist inside `fetch()` /
 * the DO constructor — so this is a per-request FAIL-CLOSED check returning a
 * 503, NOT a module-scope throw. Call it at the very top of the Worker
 * `fetch()` AND `GameDO.fetch()`.
 *
 * It closes the highest-severity live bug (a source-committed fallback secret
 * `'dev-secret-change-in-production'` that let anyone forge any token): the
 * Worker refuses to serve if `JWT_SECRET` is unset, a known dev default
 * (constant-time compared), or shorter than 32 bytes.
 *
 * In production `JWT_SECRET` MUST be set via `wrangler secret put JWT_SECRET`.
 * The wrangler.toml [vars] value is a deliberately-invalid local-dev
 * placeholder that trips this guard.
 */

/** Secrets we refuse to run with (dev defaults / committed placeholders). */
export const KNOWN_DEV_DEFAULTS: readonly string[] = [
  'dev-secret-change-in-production',
  'insecure-dev-placeholder',
  'change-me',
  'secret',
  'dev-secret',
]

const MIN_SECRET_BYTES = 32

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

/** Constant-time string equality (no early-exit on length or content). */
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  const len = Math.max(ea.length, eb.length)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < len; i++) {
    diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  }
  return diff === 0
}

/** True if `secret` matches any known dev default (checked without early exit). */
function isKnownDevDefault(secret: string): boolean {
  let matched = 0
  for (const d of KNOWN_DEV_DEFAULTS) {
    matched |= timingSafeEqual(secret, d) ? 1 : 0
  }
  return matched === 1
}

function serviceUnavailable(): Response {
  return new Response(
    JSON.stringify({ error: 'service_unavailable', reason: 'server not configured' }),
    { status: 503, headers: { 'content-type': 'application/json' } },
  )
}

/**
 * @returns a 503 `Response` if the secret is missing/default/too-short,
 *          or `null` if the secret is acceptable (request may proceed).
 */
export function assertSecret(env: { JWT_SECRET?: string }): Response | null {
  const secret = env.JWT_SECRET
  if (!secret) return serviceUnavailable()
  if (isKnownDevDefault(secret)) return serviceUnavailable()
  if (utf8ByteLength(secret) < MIN_SECRET_BYTES) return serviceUnavailable()
  return null
}
