/**
 * Game-domain helpers over device credentials + display names (must-fix #12).
 *
 * Identity code/data split, Step 3: this file used to ALSO own the
 * `/auth/quick` mint-or-authenticate handler (`quickAccount`/
 * `handleAuthQuick`) — that moved to the hub (`vgames-platform/services/
 * identity/src/d1/accounts.ts`) along with the rest of the identity route
 * surface. What's left here is what viota's OWN game code still needs:
 * `hashCredential` + `isValidDeviceCredential` (used by `d1/claim.ts` to
 * verify ghost-game ownership) and `sanitizeDisplayName` (used by
 * `game-do.ts` for in-game player-provided display names).
 *
 * The device credential is a 256-bit bearer secret MINTED CLIENT-SIDE via
 * `crypto.getRandomValues`. The server NEVER generates it and NEVER stores it
 * raw — only its SHA-256 hash.
 */

/** Non-empty, length-capped device-credential shape guard. The real client
 *  mints 32 bytes; we only bound the shape (the hash is the security surface). */
const CRED_MIN_LEN = 16
const CRED_MAX_LEN = 512
export function isValidDeviceCredential(cred: unknown): cred is string {
  return typeof cred === 'string' && cred.length >= CRED_MIN_LEN && cred.length <= CRED_MAX_LEN
}

/**
 * SHA-256 (hex) of the UTF-8 credential. SHA-256 (not a slow KDF) is correct
 * here: the credential is a HIGH-ENTROPY 256-bit secret, not a low-entropy
 * password, so there is nothing to brute-force. Store ONLY this hash.
 */
export async function hashCredential(cred: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cred))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Server-side display-name sanitization (never trust the client):
 * NFC-normalize, strip control + format chars (incl. zero-width), remove HTML/
 * attribute metachars, collapse whitespace, cap at 24 CODE POINTS (no surrogate
 * split). Returns '' when nothing survives (the caller rejects that).
 */
export function sanitizeDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  let s = raw.normalize('NFC')
  s = s.replace(/[\p{Cc}\p{Cf}]/gu, '') // control + format (zero-width joiners, BOM, ...)
  s = s.replace(/[<>&"'`]/g, '') // HTML/attribute metachars
  s = s.replace(/\s+/g, ' ').trim()
  return [...s].slice(0, 24).join('')
}
