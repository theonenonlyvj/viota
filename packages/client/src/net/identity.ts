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
 *
 * Identity code/data split (A2/2a): `quickAuth`/`reAuth` resolve their OWN
 * origin via `authUrl()` (`net/config.ts`) rather than accepting one from the
 * caller — this is what makes `http.ts`'s silent 401-reAuth path repoint to
 * the identity service atomically for every caller (lobby.ts, reportGame.ts,
 * AccountModal) the moment `authUrl()`'s default changes, with no per-call-site
 * plumbing. Every OTHER net/ call (game routes, `/claim`) is unaffected —
 * they keep passing `serverUrl()` explicitly, as before.
 */
import { authUrl } from './config'

const CRED_KEY = 'viota_device_credential'
const TOKEN_KEY = 'viota_token'
const ACCOUNT_KEY = 'viota_account_id'
const NAME_KEY = 'viota_display_name'
const USERNAME_KEY = 'viota_username'

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
 * The claimed VGames username, if this device has ever successfully claimed
 * or logged into one (`net/account.ts`'s `claimAccount`/`loginAccount`).
 * `null` for an unclaimed ghost — callers fall back to `getDisplayName()`.
 * There's no server "whoami" read for this (`/auth/introspect` returns no
 * username), so it's the client's own record of the identity it just set.
 */
export function getUsername(): string | null {
  return localStorage.getItem(USERNAME_KEY)
}

export function setUsername(username: string): void {
  localStorage.setItem(USERNAME_KEY, username)
}

/**
 * Persist a freshly-obtained token + accountId — the same storage `quickAuth`
 * uses, shared with the VGames claim/login flows (`net/account.ts`'s
 * `loginAccount`) so every path that mints/rotates a session writes through
 * one place.
 */
export function setSession(token: string, accountId: string): void {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(ACCOUNT_KEY, accountId)
}

/**
 * POST /auth/quick { deviceCredential, displayName } → { token, accountId }.
 * Stores the token + accountId (+ displayName for silent re-auth). Presenting
 * the same credential always re-authenticates the SAME account. Always talks
 * to `authUrl()` — never a caller-supplied origin (see module docstring).
 */
export async function quickAuth(
  displayName: string,
): Promise<{ token: string; accountId: string }> {
  const deviceCredential = getDeviceCredential()
  const res = await fetch(`${authUrl()}/auth/quick`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceCredential, displayName }),
  })
  if (!res.ok) {
    throw new Error(`quickAuth failed: ${res.status}`)
  }
  const data = (await res.json()) as { token: string; accountId: string }
  setSession(data.token, data.accountId)
  localStorage.setItem(NAME_KEY, displayName)
  return data
}

/**
 * Silent re-auth on a 401: re-mint a token from the stored credential + last
 * display name. Returns the fresh token. Never prompts the user.
 */
export async function reAuth(): Promise<string> {
  const { token } = await quickAuth(getDisplayName())
  return token
}
