/**
 * PBKDF2-HMAC-SHA256 password hashing (WebCrypto) for VGames username/password
 * accounts. NEVER store or log a plaintext password — only the PHC string
 * below.
 *
 * PHC format: `pbkdf2-sha256$i=<iterations>$<base64 salt>$<base64 derived key>`.
 * 16-byte random salt, 32-byte derived key, target 600000 iterations (a floor
 * of 210000 is acceptable if the Workers CPU budget forces a lower value at
 * call time — `needsRehash` flags any hash below the current target so a
 * successful login can opportunistically upgrade it).
 */

export const PBKDF2_ITERS = 600000
const KEYLEN = 32
const SALTLEN = 16

function b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

async function derive(password: string, salt: Uint8Array, iters: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  return crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' }, key, KEYLEN * 8)
}

/** Hash `password` into a PHC string with a fresh random salt. */
export async function hashPassword(password: string, iters: number = PBKDF2_ITERS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALTLEN))
  const dk = await derive(password, salt, iters)
  return `pbkdf2-sha256$i=${iters}$${b64(salt.buffer)}$${b64(dk)}`
}

function parsePhc(phc: string): { iters: number; salt: Uint8Array; dk: Uint8Array } | null {
  const m = /^pbkdf2-sha256\$i=(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(phc)
  if (!m) return null
  try {
    return { iters: parseInt(m[1]!, 10), salt: unb64(m[2]!), dk: unb64(m[3]!) }
  } catch {
    return null
  }
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

/** Verify `password` against a stored PHC string. Never throws — malformed
 *  PHC input returns `false`, same as a wrong password. */
export async function verifyPassword(password: string, phc: string): Promise<boolean> {
  const p = parsePhc(phc)
  if (!p) return false
  const dk = new Uint8Array(await derive(password, p.salt, p.iters))
  return timingSafeEqual(dk, p.dk)
}

/** True if `phc`'s iteration count is below `target` (or the PHC is
 *  unparseable) — the caller should re-hash on a successful login. */
export function needsRehash(phc: string, target: number = PBKDF2_ITERS): boolean {
  const p = parsePhc(phc)
  return !p || p.iters < target
}
