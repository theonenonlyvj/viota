/**
 * Device identity + quick-account auth (spec §6, must-fix #12).
 *
 * - A 256-bit device credential is minted once via `crypto.getRandomValues` and
 *   stored in localStorage (survives tab death / reboot / bfcache — NOT
 *   sessionStorage). It is the durable identity behind silent reclaim.
 * - `ghostId = SHA-256(credential)` (hex). This MUST equal the server's
 *   `hashCredential` so `POST /claim` (which binds `ghost_id === SHA-256(cred)`)
 *   works. Both sides hash the UTF-8 credential string.
 * - `quickAuth` mints/authenticates a real account and stores the 24h JWT. A 401
 *   anywhere triggers a SILENT re-auth from the stored credential — never a
 *   mid-game login prompt.
 */

const CRED_KEY = 'viota_device_credential'
const TOKEN_KEY = 'viota_token'
const ACCOUNT_KEY = 'viota_account_id'
const NAME_KEY = 'viota_display_name'

function toHex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

/** Mint-once, stable-forever 256-bit device credential (hex) in localStorage. */
export function getDeviceCredential(): string {
  const existing = localStorage.getItem(CRED_KEY)
  if (existing) return existing
  const bytes = crypto.getRandomValues(new Uint8Array(32)) // 256-bit
  const hex = toHex(bytes)
  localStorage.setItem(CRED_KEY, hex)
  return hex
}

/** `ghostId = hex(SHA-256(credential))` — MUST match the server's hashCredential. */
export async function getGhostId(): Promise<string> {
  const cred = getDeviceCredential()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cred))
  return toHex(new Uint8Array(digest))
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getAccountId(): string | null {
  return localStorage.getItem(ACCOUNT_KEY)
}

/** The last display name used (for silent re-auth); falls back to 'Player'. */
export function getDisplayName(): string {
  return localStorage.getItem(NAME_KEY) ?? 'Player'
}

/**
 * POST /auth/quick { deviceCredential, displayName } → { token, accountId }.
 * Stores the token + accountId (+ displayName for silent re-auth). Presenting
 * the same credential always re-authenticates the SAME account.
 */
export async function quickAuth(
  serverUrl: string,
  displayName: string,
): Promise<{ token: string; accountId: string }> {
  const deviceCredential = getDeviceCredential()
  const res = await fetch(`${serverUrl}/auth/quick`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceCredential, displayName }),
  })
  if (!res.ok) {
    throw new Error(`quickAuth failed: ${res.status}`)
  }
  const data = (await res.json()) as { token: string; accountId: string }
  localStorage.setItem(TOKEN_KEY, data.token)
  localStorage.setItem(ACCOUNT_KEY, data.accountId)
  localStorage.setItem(NAME_KEY, displayName)
  return data
}

/**
 * Silent re-auth on a 401: re-mint a token from the stored credential + last
 * display name. Returns the fresh token. Never prompts the user.
 */
export async function reAuth(serverUrl: string): Promise<string> {
  const { token } = await quickAuth(serverUrl, getDisplayName())
  return token
}
