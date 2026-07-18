import { requireCanonicalAccount, type IdentityEnv } from '../identity/authctx'
import { hashCredential, isValidDeviceCredential } from './accounts'

/**
 * `POST /claim { ghostId, deviceCredential }` (must-fix #10).
 *
 * A logged-in account pulls its device's solo/ghost games into itself. The
 * caller MUST PROVE ownership of the ghost id — `ghostId` from the body is NEVER
 * trusted as authorization. Client-side ghost games are keyed by the device
 * credential: `ghost_id === SHA-256(deviceCredential)`. So the server recomputes
 * the hash and only reassigns rows when it matches the presented ghost id;
 * account B (with its own credential) can never claim account A's ghost games.
 *
 * Reassignment is idempotent: only unclaimed rows (or rows already the caller's)
 * are moved, so a repeated claim is a benign 0-change no-op.
 *
 * Identity code/data split (A1): auth goes through `requireCanonicalAccount`
 * (not the plain `do/authctx.requireAuth`) so a claim (a) accepts BOTH legacy
 * viota tokens and new vgames tokens (`verifyAnyToken`), and (b) lands on the
 * caller's CURRENT canonical head (resolved via `env.IDENTITY_DB`) even if
 * the presenting account has since been merged into another — a claim must
 * never tag rows onto an account that is no longer live.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

export async function handleClaim(request: Request, env: IdentityEnv): Promise<Response> {
  const auth = await requireCanonicalAccount(request, env)
  if (auth instanceof Response) return auth // 401 — a Bearer JWT is required

  let body: { ghostId?: unknown; deviceCredential?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const ghostId = body.ghostId
  if (typeof ghostId !== 'string' || ghostId.length === 0 || ghostId.length > 128) {
    return json({ error: 'invalid_ghost_id' }, 400)
  }
  if (!isValidDeviceCredential(body.deviceCredential)) {
    return json({ error: 'invalid_credential' }, 400)
  }

  // Ownership proof: the presented credential must hash to the claimed ghost id.
  const h = await hashCredential(body.deviceCredential)
  if (h !== ghostId) return json({ error: 'forbidden' }, 403)

  // Reassign only still-unclaimed ghost rows (idempotent: a repeat claim, or one
  // for rows already the caller's, changes 0 rows — the "ON CONFLICT DO NOTHING"
  // semantics; already-owned rows of OTHER accounts are never touched).
  const res = await env.DB.prepare(`UPDATE game_players SET account_id = ? WHERE ghost_id = ? AND account_id IS NULL`)
    .bind(auth.accountId, ghostId)
    .run()

  return json({ ok: true, claimed: res.meta?.changes ?? 0 })
}
