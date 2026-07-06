import { getToken, reAuth } from './identity'

/**
 * `fetch` with the Bearer token attached and a ONE-TIME silent re-auth on 401.
 *
 * The token rides the `Authorization` header (never the URL). On a 401 — an
 * expired/rotated token — we silently re-mint from the device credential and
 * retry once. A second 401 is surfaced. Never prompts the user mid-game.
 */
export async function authedFetch(
  serverUrl: string,
  path: string,
  init: RequestInit = {},
  opts: { retryOn401?: boolean } = {},
): Promise<Response> {
  const retryOn401 = opts.retryOn401 ?? true
  const headers = new Headers(init.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${serverUrl}${path}`, { ...init, headers })
  if (res.status !== 401 || !retryOn401) return res

  // Silent re-auth, then retry once with the fresh token.
  let fresh: string
  try {
    fresh = await reAuth(serverUrl)
  } catch {
    return res // re-auth itself failed — surface the original 401
  }
  const retryHeaders = new Headers(init.headers)
  retryHeaders.set('Authorization', `Bearer ${fresh}`)
  return fetch(`${serverUrl}${path}`, { ...init, headers: retryHeaders })
}
