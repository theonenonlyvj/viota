/**
 * VGames identity HTTP handlers. Split from `d1/accounts.ts` (which owns the
 * legacy/device `/auth/quick` mint-or-authenticate path) — this module owns the
 * username/password lifecycle layered on top: set-credentials (ghost ->
 * claimed), login (username+password), and introspection.
 */
import { requireCanonicalAccount, type IdentityEnv } from './authctx'
import { hashPassword, verifyPassword, needsRehash } from './pbkdf2'
import { validateUsername, validatePassword } from './username'
import { hashCredential } from '../d1/accounts'
import { upsertDevice, findAccountByDevice } from '../d1/devices'
import { signVGamesToken, verifyAnyToken } from '../jwt'
import { canonical } from './canonical'
import { mergeAccounts } from './merge'

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

type LoginAccountRow = {
  id: string
  password_hash: string | null
  token_epoch: number
  status: string
  must_change_pw: number
  login_fail_count: number
}

// A well-formed (parses cleanly) but unattainable PHC string, derived against
// on every login attempt for an UNKNOWN username so the PBKDF2 cost — the
// dominant timing signal — is paid on both the "no such user" and "wrong
// password" paths. Never matches a real derived key (a and b differ in
// length after unb64, so `timingSafeEqual` short-circuits `false`).
const DUMMY_PHC = 'pbkdf2-sha256$i=600000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

/**
 * `POST /auth/login { username, password, deviceCredential }` — anti-
 * enumeration username/password login. Unknown user AND known-user-wrong-
 * password return the IDENTICAL `401 invalid_credentials` body; a dummy PHC is
 * verified against on an unknown username so both paths pay the same PBKDF2
 * cost. Never hard-denies (no permanent lockout) — repeated failures instead
 * accrue a bounded latency delay. On success: binds `deviceCredential` as a
 * new device row (this is a NEW device authenticating via password, not the
 * device that originally minted the ghost), lazily rehashes the password hash
 * if it's below the target iteration count, resets the fail counter, and
 * mints a fresh `vgames` token off the account's CURRENT `token_epoch`.
 *
 * SESSION-BOUND GHOST-FOLD (A11): if the `deviceCredential` the client just
 * presented is CURRENTLY mapped to a DIFFERENT account that is still
 * `status='ghost'`, that ghost's games/devices/external-ids are folded into
 * the just-logged-in account via `mergeAccounts` — this is exactly the "I've
 * been playing as a guest on this device/browser, now I'm logging into my
 * real account from it" moment. Only the ONE ghost the presented credential
 * maps to is ever folded (never an arbitrary account, and never a ghost some
 * OTHER device happens to own) — the credential is proof this browser/device
 * WAS that ghost.
 */
export async function handleLogin(request: Request, env: IdentityEnv & { JWT_SECRET?: string }): Promise<Response> {
  if (!env.JWT_SECRET) return json({ error: 'server_misconfigured' }, 503)

  let body: { username?: unknown; password?: unknown; deviceCredential?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'bad_json' }, 400)
  }
  const username = String(body.username ?? '').toLowerCase()
  const password = String(body.password ?? '')
  const deviceCredential = String(body.deviceCredential ?? '')

  const acc = await env.DB.prepare(
    `SELECT id, password_hash, token_epoch, status, must_change_pw, login_fail_count FROM accounts WHERE username=?`,
  )
    .bind(username)
    .first<LoginAccountRow>()

  const phc = acc?.password_hash || DUMMY_PHC
  const ok = await verifyPassword(password, phc) // constant-time; dummy hash on an unknown user

  if (!acc || !ok || acc.status === 'merged' || !acc.password_hash) {
    if (acc) {
      await env.DB.prepare(`UPDATE accounts SET login_fail_count=login_fail_count+1 WHERE id=?`).bind(acc.id).run()
    }
    // Bounded latency throttle (never a hard deny): scales with recent fails,
    // capped, so a fail storm slows brute force without ever locking anyone out.
    const fails = acc?.login_fail_count ?? 0
    await new Promise((resolve) => setTimeout(resolve, Math.min(fails * 100, 1500)))
    return json({ error: 'invalid_credentials' }, 401)
  }

  const now = Date.now()
  if (deviceCredential) {
    const credHash = await hashCredential(deviceCredential)
    // Session-bound ghost-fold: fold ONLY the ghost this exact credential
    // currently maps to (device_credentials, or a legacy accounts.credential_hash
    // hit) — never an arbitrary account. Do this BEFORE re-binding the
    // credential below, while it still points at the ghost (if any).
    const legacyOwner = await env.DB.prepare(`SELECT id FROM accounts WHERE credential_hash=?`).bind(credHash).first<{ id: string }>()
    const priorOwnerId = (await findAccountByDevice(env.DB, credHash)) ?? legacyOwner?.id ?? null
    if (priorOwnerId && priorOwnerId !== acc.id) {
      const priorOwner = await env.DB.prepare(`SELECT status FROM accounts WHERE id=?`).bind(priorOwnerId).first<{ status: string }>()
      if (priorOwner?.status === 'ghost') {
        await mergeAccounts(env.DB, priorOwnerId, acc.id, 'system:login', 'login-fold')
      }
    }
    await upsertDevice(env.DB, credHash, acc.id, now)
  }
  // Lazy rehash: a successful login is the only time we ever see the
  // plaintext password again, so it's the only opportunity to upgrade a
  // below-target PHC (e.g. one hashed at the floor under CPU pressure).
  if (needsRehash(acc.password_hash)) {
    await env.DB.prepare(`UPDATE accounts SET password_hash=? WHERE id=?`).bind(await hashPassword(password), acc.id).run()
  }
  await env.DB.prepare(`UPDATE accounts SET login_fail_count=0, last_seen_at=? WHERE id=?`).bind(now, acc.id).run()

  const token = await signVGamesToken({ accountId: acc.id, status: acc.status, epoch: acc.token_epoch }, env.JWT_SECRET)
  return json({ token, accountId: acc.id, mustChangePassword: !!acc.must_change_pw })
}

/**
 * `POST /auth/introspect { token }` — server-to-server (e.g. vjaipur's Express
 * server, or any future client) token validation. ALWAYS returns HTTP 200 —
 * validity is communicated purely via the `{valid}` body field, never the
 * status code, so a caller never has to special-case a 401/503 from this
 * endpoint the way it would an authed route. Applies the same epoch-staleness
 * + merge-canonicalization rules as `requireCanonicalAccount`.
 */
export async function handleIntrospect(request: Request, env: IdentityEnv): Promise<Response> {
  let body: { token?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ valid: false })
  }
  const token = String(body.token ?? '')
  if (!env.JWT_SECRET) return json({ valid: false })

  const claims = await verifyAnyToken(token, env.JWT_SECRET)
  if (!claims) return json({ valid: false })

  const row = await env.DB.prepare(`SELECT token_epoch FROM accounts WHERE id=?`)
    .bind(claims.accountId)
    .first<{ token_epoch: number }>()
  if (!row) return json({ valid: false })
  if (claims.epoch !== undefined && claims.epoch !== row.token_epoch) return json({ valid: false })

  const canon = await canonical(env.DB, claims.accountId)
  if (!canon || canon.status === 'merged') return json({ valid: false })

  return json({ valid: true, accountId: canon.id, status: canon.status })
}
