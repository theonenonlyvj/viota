import { verifyAdminToken, type AdminEnv } from '../identity/admin'

/**
 * `GET /admin/merge-audit?from=&into=` (identity code/data split, A6) — the
 * GAME-domain half of the pre-merge audit that used to live entirely inside
 * `identity/merge.ts`'s dry-run (`selfPlayFlags` + a `game_players` retag
 * count). Identity no longer touches game tables at all (A9), so the
 * documented flow is now TWO calls: THIS endpoint against each game worker
 * (viota-worker's own D1), then `POST /admin/merge { dryRun:true }` against
 * `vgames-identity` for the identity-side counts — review both with a human
 * before a real (`dryRun:false`) merge.
 *
 * Same step-up gate as `/admin/merge`/`/admin/backfill-stats`: a SEPARATE
 * admin token (`ADMIN_JWT_SECRET`, `aud:'vgames-admin'`), never the
 * player-facing `JWT_SECRET`.
 *
 * `selfPlayFlags` reads viota's OWN `merge_selfplay_flags` — populated by the
 * merge reconciler (`do/reconcile.ts`) the moment it actually finds evidence
 * (from/into on different seats of the same game), NOT recomputed live here;
 * this endpoint is a read of what the reconciler has already seen, which is
 * only meaningful once a merge has been applied and at least one sweep has
 * run. `gamePlayersCounts` IS live (a plain `COUNT(*)` per account_id), so it
 * is accurate before the merge, before the reconciler has run at all.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

export type MergeAuditResult = {
  selfPlayFlags: string[]
  gamePlayersCounts: { from: number; into: number }
}

export async function mergeAudit(db: D1Database, fromAccountId: string, intoAccountId: string): Promise<MergeAuditResult> {
  const flagsRes = await db
    .prepare(`SELECT DISTINCT game_uuid FROM merge_selfplay_flags WHERE from_id = ? AND into_id = ?`)
    .bind(fromAccountId, intoAccountId)
    .all<{ game_uuid: string }>()

  const countOf = async (accountId: string): Promise<number> => {
    const r = await db.prepare(`SELECT COUNT(*) n FROM game_players WHERE account_id = ?`).bind(accountId).first<{ n: number }>()
    return r?.n ?? 0
  }

  return {
    selfPlayFlags: flagsRes.results.map((r) => r.game_uuid),
    gamePlayersCounts: { from: await countOf(fromAccountId), into: await countOf(intoAccountId) },
  }
}

/** `GET /admin/merge-audit?from=<accountId>&into=<accountId>` */
export async function handleAdminMergeAudit(request: Request, env: { DB: D1Database } & AdminEnv): Promise<Response> {
  const admin = await verifyAdminToken(request, env)
  if (!admin) return json({ error: 'unauthorized' }, 401)

  const url = new URL(request.url)
  const from = url.searchParams.get('from') ?? ''
  const into = url.searchParams.get('into') ?? ''
  if (!from || !into) return json({ error: 'missing_ids' }, 400)

  const result = await mergeAudit(env.DB, from, into)
  return json(result)
}
