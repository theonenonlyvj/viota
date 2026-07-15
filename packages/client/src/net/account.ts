import { getDeviceCredential, setSession } from './identity'
import { authedFetch } from './http'

/**
 * VGames login adoption (Phase 1, Task 1) — claim a username+password onto
 * the caller's ghost account, and log in with one on another device. Mirrors
 * the EXACT worker contract — see `packages/worker/src/identity/routes.ts`
 * (`handleSetCredentials` / `handleLogin`). No new worker code; both
 * endpoints are already live.
 */

export type ClaimResult = { ok: true } | { ok: false; error: string }
export type LoginResult = { ok: true; mustChangePassword: boolean } | { ok: false; error: string }

/**
 * `POST /auth/set-credentials { username, password }` (Bearer — the caller's
 * current device token). Claims onto the SAME account (no new token minted;
 * the existing session keeps working — see `routes.ts`'s epoch-bump note).
 * Maps 409 straight through the server's `error` (`'username_taken'` |
 * `'not_ghost'`), 400 (bad username/password shape) to `'invalid'`, and any
 * other non-ok status to a generic `'failed'`.
 */
export async function claimAccount(serverUrl: string, username: string, password: string): Promise<ClaimResult> {
  const res = await authedFetch(serverUrl, '/auth/set-credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (res.ok) return { ok: true }
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return { ok: false, error: body.error === 'not_ghost' ? 'not_ghost' : 'username_taken' }
  }
  if (res.status === 400) return { ok: false, error: 'invalid' }
  return { ok: false, error: 'failed' }
}

/**
 * `POST /auth/login { username, password, deviceCredential }` — a PLAIN fetch
 * (no Bearer: this may resolve to a DIFFERENT account than the caller
 * currently holds a token for, e.g. logging into an existing account on a
 * fresh device). On success, persists the new token + accountId via the same
 * setter `quickAuth` uses (`identity.ts`'s `setSession`) so every other net/
 * call (`authedFetch`) immediately rides the new identity. Maps 401 to
 * `'invalid_credentials'` (the server's anti-enumeration response — same body
 * for an unknown username or a wrong password) and any other non-ok status to
 * a generic `'failed'`.
 */
export async function loginAccount(serverUrl: string, username: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${serverUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, deviceCredential: getDeviceCredential() }),
  })
  if (res.status === 401) return { ok: false, error: 'invalid_credentials' }
  if (!res.ok) return { ok: false, error: 'failed' }
  const data = (await res.json()) as { token: string; accountId: string; mustChangePassword: boolean }
  setSession(data.token, data.accountId)
  return { ok: true, mustChangePassword: !!data.mustChangePassword }
}
