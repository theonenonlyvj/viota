/**
 * Merge reconciler (identity code/data split, A1) — pull-based, run from
 * viota-worker's existing 1-minute cron (`scheduled` in `src/index.ts`).
 *
 * Identity (`identity/merge.ts`) records a merge in `account_merges`
 * (IDENTITY_DB) and NEVER touches game tables (A9). Each game reconciles that
 * merge into its OWN store by PULLING: every sweep reads every currently
 * ACTIVE merge edge (`account_merges WHERE superseded_by IS NULL`) and
 * idempotently re-tags viota's own `game_players` rows from the merged-away
 * account onto its canonical target.
 *
 * Deliberately NO watermark (A1): re-scanning every active merge on every
 * sweep, forever, is cheap at this scale and self-heals a LATE-minted row
 * (e.g. a stale 24h token, a DO seat write racing the merge, or the
 * archive's `ON CONFLICT ... account_id` revert) within one sweep of it
 * landing — a watermark would have to be reasoned about for every one of
 * those late-write paths instead of "the next sweep just fixes it."
 *
 * Self-play detection (evidence the merged accounts were actually two
 * different humans) runs INLINE, immediately before each merge's retag: it
 * looks for a game where the from/into accounts occupy DIFFERENT seats of
 * the SAME game, which is only detectable while `from`'s game_players rows
 * still carry its own account_id — i.e. exactly the moment before the retag
 * overwrites them. A flag found is recorded in `merge_selfplay_flags`
 * (idempotent via its PRIMARY KEY) for admin review via `GET
 * /admin/merge-audit` (A6) — detection never blocks the retag.
 */

export type ActiveMerge = { fromAccountId: string; intoAccountId: string }

/** All currently-active merge edges (`superseded_by IS NULL`) from IDENTITY_DB. */
export async function readActiveMerges(identityDb: D1Database): Promise<ActiveMerge[]> {
  const { results } = await identityDb
    .prepare(`SELECT from_account_id, into_account_id FROM account_merges WHERE superseded_by IS NULL`)
    .all<{ from_account_id: string; into_account_id: string }>()
  return results.map((r) => ({ fromAccountId: r.from_account_id, intoAccountId: r.into_account_id }))
}

/** Games where `fromId` and `intoId` occupy DIFFERENT seats of the SAME game
 *  — evidence of two distinct humans, not one person's ghost + account. MUST
 *  run before the retag below (it looks for rows still tagged `fromId`). */
async function findSelfPlay(db: D1Database, fromId: string, intoId: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT a.game_uuid AS g FROM game_players a JOIN game_players b
         ON a.game_uuid=b.game_uuid AND a.seat_index<>b.seat_index
       WHERE a.account_id=? AND b.account_id=?`,
    )
    .bind(fromId, intoId)
    .all<{ g: string }>()
  return results.map((r) => r.g)
}

/** Idempotently apply ONE merge to viota's own `game_players`: flag any
 *  self-play evidence, then re-tag every row still owned by `fromAccountId`
 *  onto `intoAccountId`. Safe to re-run — a merge already fully applied
 *  finds zero self-play (no `from`-tagged rows left to compare) and the
 *  retag UPDATE affects 0 rows. */
export async function reconcileOneMerge(db: D1Database, merge: ActiveMerge, now: number): Promise<{ retagged: number; selfPlayFlags: string[] }> {
  const { fromAccountId, intoAccountId } = merge
  if (fromAccountId === intoAccountId) return { retagged: 0, selfPlayFlags: [] } // defensive; should never happen

  const selfPlayFlags = await findSelfPlay(db, fromAccountId, intoAccountId)
  if (selfPlayFlags.length) {
    await db.batch(
      selfPlayFlags.map((gameUuid) =>
        db
          .prepare(
            `INSERT INTO merge_selfplay_flags (game_uuid, from_id, into_id, detected_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(game_uuid, from_id, into_id) DO NOTHING`,
          )
          .bind(gameUuid, fromAccountId, intoAccountId, now),
      ),
    )
  }

  const res = await db.prepare(`UPDATE game_players SET account_id=? WHERE account_id=?`).bind(intoAccountId, fromAccountId).run()
  return { retagged: res.meta?.changes ?? 0, selfPlayFlags }
}

export type ReconcileSummary = { mergesSwept: number; rowsRetagged: number; selfPlayFlagsRecorded: number }

/** The full sweep — every active merge, applied idempotently. One merge's
 *  failure does not abort the rest (best-effort; the next sweep retries it). */
export async function reconcileMerges(db: D1Database, identityDb: D1Database, now: number = Date.now()): Promise<ReconcileSummary> {
  const merges = await readActiveMerges(identityDb)
  let rowsRetagged = 0
  let selfPlayFlagsRecorded = 0
  for (const merge of merges) {
    const { retagged, selfPlayFlags } = await reconcileOneMerge(db, merge, now)
    rowsRetagged += retagged
    selfPlayFlagsRecorded += selfPlayFlags.length
  }
  return { mergesSwept: merges.length, rowsRetagged, selfPlayFlagsRecorded }
}
