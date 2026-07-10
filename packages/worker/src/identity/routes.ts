/**
 * VGames identity HTTP handlers. Split from `d1/accounts.ts` (which owns the
 * legacy/device `/auth/quick` mint-or-authenticate path) — this module owns the
 * username/password lifecycle layered on top: set-credentials (ghost ->
 * claimed), login (username+password), and introspection.
 */
import { requireCanonicalAccount, type IdentityEnv } from './authctx'
import { hashPassword } from './pbkdf2'
import { validateUsername, validatePassword } from './username'

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * `POST /auth/set-credentials { username, password }` (Bearer-authed) —
 * claims a username+password onto the CALLER's current ghost account, in
 * place (same account id; no new row). Only a `status='ghost'` account may be
 * claimed (guarded by the `WHERE id=? AND status='ghost'` UPDATE — 0 rows
 * changed means it was already claimed/merged, reported as 409 `not_ghost`).
 * Bumps `token_epoch` so any OTHER outstanding token for this account (there
 * shouldn't be one yet, but defense in depth) is invalidated by the epoch
 * check in `requireCanonicalAccount`/`/auth/introspect`.
 */
export async function handleSetCredentials(request: Request, env: IdentityEnv): Promise<Response> {
  const auth = await requireCanonicalAccount(request, env)
  if (auth instanceof Response) return auth

  let body: { username?: unknown; password?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const username = String(body.username ?? '').toLowerCase()
  const password = String(body.password ?? '')
  if (!validateUsername(username)) return json({ error: 'invalid_username' }, 400)
  if (!validatePassword(password)) return json({ error: 'invalid_password' }, 400)

  const phc = await hashPassword(password)
  try {
    const res = await env.DB.prepare(
      `UPDATE accounts SET username=?, password_hash=?, status='claimed', claimed_at=?, token_epoch=token_epoch+1
       WHERE id=? AND status='ghost'`,
    )
      .bind(username, phc, Date.now(), auth.accountId)
      .run()
    if (!res.meta.changes) return json({ error: 'not_ghost' }, 409) // already claimed/merged
    return json({ ok: true })
  } catch (e) {
    if (String((e as Error)?.message || '').includes('UNIQUE')) return json({ error: 'username_taken' }, 409)
    throw e
  }
}
