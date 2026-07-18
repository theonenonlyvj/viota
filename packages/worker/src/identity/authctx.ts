/**
 * Worker-level VGames identity auth context — deliberately separate from
 * `src/do/authctx.ts` (the DO's `requireAuth`). DO auth is untouched in P1;
 * this is a standalone helper the identity routes (`/auth/set-credentials`
 * onward) AND game-side stats routes (leaderboard/me-stats/report/claim) use,
 * resolving a token to its CANONICAL (post-merge) account.
 *
 * `verifyAnyToken` accepts both legacy viota tokens (no `epoch` claim) and new
 * vgames tokens (carry `epoch`). A legacy token skips the epoch-staleness
 * check entirely (there is nothing to compare — an absent epoch is never
 * "stale"); a vgames token's `epoch` must match the account's CURRENT
 * `token_epoch` (bumped on credential change / merge) or the request is
 * rejected as `token_stale` — this is what makes a merged-away or
 * superseded-credential token stop working immediately, without a revocation
 * list.
 *
 * VGames identity code/data split (Step 1 — A11): canonicalization ALWAYS
 * reads via `env.IDENTITY_DB`, never `env.DB` — this is the one place game
 * code touches identity data, and it must go through the binding that will
 * still be correct after Step 4 moves the data. `IdentityEnv` keeps a `DB`
 * field too (identity routes in `identity/routes.ts`/`d1/accounts.ts`/
 * `d1/claim.ts` do their OWN direct accounts-table queries against it) — the
 * two callers of this shared type (identity routes, invoked with an env
 * where DB and IDENTITY_DB are aliased to the SAME identity store — see
 * `identity/router.ts` callers; and game stats routes, invoked with the
 * worker's real, UN-aliased env) both end up correct.
 */
import { verifyAnyToken } from '../jwt'
import { canonical } from './canonical'

export type CanonicalOk = { accountId: string; status: string }
export type IdentityEnv = { DB: D1Database; IDENTITY_DB: D1Database; JWT_SECRET?: string }

function bearer(request: Request): string | null {
  const h = request.headers.get('authorization') || request.headers.get('Authorization') || ''
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  return m ? m[1]!.trim() || null : null
}

function unauthorized(reason: string): Response {
  return new Response(JSON.stringify({ error: 'unauthorized', reason }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * @returns `{accountId, status}` (the CANONICAL account, after following any
 * merge chain) on success, or a 401 `Response` the caller returns as-is.
 */
export async function requireCanonicalAccount(request: Request, env: IdentityEnv): Promise<CanonicalOk | Response> {
  if (!env.JWT_SECRET) return new Response(JSON.stringify({ error: 'server_misconfigured' }), { status: 503 })

  const tok = bearer(request)
  if (!tok) return unauthorized('missing_token')

  const claims = await verifyAnyToken(tok, env.JWT_SECRET)
  if (!claims) return unauthorized('invalid_token')

  const row = await env.IDENTITY_DB.prepare(`SELECT token_epoch, status FROM accounts WHERE id=?`)
    .bind(claims.accountId)
    .first<{ token_epoch: number; status: string }>()
  if (!row) return unauthorized('unknown_account')

  // A legacy (viota-issued) token carries no epoch claim -> nothing to check.
  if (claims.epoch !== undefined && claims.epoch !== row.token_epoch) return unauthorized('token_stale')

  const canon = await canonical(env.IDENTITY_DB, claims.accountId)
  if (!canon) return unauthorized('unknown_account')
  if (canon.status === 'merged') return unauthorized('account_merged') // defensive; canonical() returns the live head

  return { accountId: canon.id, status: canon.status }
}
