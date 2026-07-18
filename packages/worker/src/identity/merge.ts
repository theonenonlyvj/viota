/**
 * `mergeAccounts` — the single primitive behind both the login session-bound
 * ghost-fold (see `routes.ts`'s `handleLogin`) and the admin `/admin/merge`
 * endpoint. Re-tags every IDENTITY row that references `fromId` onto the
 * canonical head of `intoId`, marks `fromId` `status='merged'`, and
 * PATH-COMPRESSES any account that already pointed at `fromId` so
 * `canonical()` never has to walk more than one hop for them going forward.
 *
 * Properties (see spec §6):
 *  - transactional: the write phase is a single `db.batch` (D1 batches run
 *    atomically) — either every retag + the merge-history row + the account
 *    flip lands, or none of it does.
 *  - idempotent: an ACTIVE `account_merges` row for `fromId` (i.e.
 *    `superseded_by IS NULL`) short-circuits to a no-op — replaying the same
 *    merge (e.g. a retried login-fold) never double-applies or errors.
 *  - path-compressed: any account whose `merged_into` pointed at `fromId` is
 *    repointed straight at `into` in the same batch, so `canonical()` stays a
 *    short walk even after a long chain of folds.
 *  - cycle-safe: resolves both ids to their CURRENT canonical head via
 *    `canonical()` first, so a merge can never create or traverse a cycle.
 *  - `dryRun`: computes `retagCounts` with read-only queries and returns
 *    without writing anything.
 *  - `includeAudit=false`: skips that read-only audit query for a
 *    session-bound automatic login fold; the transactional write set is
 *    unchanged. Dry runs always include the audit.
 *
 * Identity code/data split (A9/deliverable 6): identity code contains NO
 * game-table SQL at all — the `game_players` retag (and the self-play scan
 * that used to run alongside it) moved OUT of here entirely. Each game
 * reconciles a merge into its OWN `game_players` by pulling
 * `account_merges` (see viota's cron reconciler, `do/reconcile.ts`) and
 * flags self-play there instead (game-domain data — see A6's
 * `GET /admin/merge-audit` on viota-worker). `retagCounts`/the response
 * reflect identity tables ONLY; `gameData` on the result points callers at
 * the per-game audit endpoint instead of a number this module can no longer
 * compute.
 */
import { canonical } from './canonical'

export type MergeResult = {
  ok: boolean
  /** Identity-table retag counts only (device_credentials/external_identities)
   *  — game_players is no longer identity's to count. */
  retagCounts: Record<string, number>
  /** Game-domain data (self-play flags, per-game retag counts) is computed by
   *  each game's own admin surface, not here — see A6. */
  gameData: string
  dryRun: boolean
  noop?: boolean
}

const GAME_DATA_POINTER = 'per-game — query each game worker GET /admin/merge-audit?from=&into='

export async function mergeAccounts(
  db: D1Database,
  fromId: string,
  intoId: string,
  actor: string,
  reason: string,
  opts: { dryRun?: boolean; includeAudit?: boolean } = {},
): Promise<MergeResult> {
  const dryRun = !!opts.dryRun
  const includeAudit = dryRun || opts.includeAudit !== false

  const canonInto = await canonical(db, intoId)
  if (!canonInto) return { ok: false, retagCounts: {}, gameData: GAME_DATA_POINTER, dryRun }
  const into = canonInto.id

  const canonFrom = await canonical(db, fromId)
  if (!canonFrom || canonFrom.id === into) {
    // Already the same canonical account (includes fromId === intoId, or a
    // prior merge already folded fromId's whole chain into into) -> no-op.
    return { ok: true, retagCounts: {}, gameData: GAME_DATA_POINTER, dryRun, noop: true }
  }

  // Idempotency guard: an already-active merge edge for fromId means a prior
  // call (e.g. a retried login-fold) already did this work.
  const active = await db
    .prepare(`SELECT id FROM account_merges WHERE from_account_id=? AND superseded_by IS NULL`)
    .bind(fromId)
    .first<{ id: string }>()
  if (active) return { ok: true, retagCounts: {}, gameData: GAME_DATA_POINTER, dryRun, noop: true }

  let retagCounts: Record<string, number> = {}
  if (includeAudit) {
    const countOf = async (table: string): Promise<number> => {
      const r = await db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE account_id=?`).bind(fromId).first<{ n: number }>()
      return r?.n ?? 0
    }
    retagCounts = {
      device_credentials: await countOf('device_credentials'),
      external_identities: await countOf('external_identities'),
    }
  }

  if (dryRun) return { ok: true, retagCounts, gameData: GAME_DATA_POINTER, dryRun: true }

  const now = Date.now()
  const mergeId = crypto.randomUUID()
  try {
    await db.batch([
      db.prepare(`UPDATE device_credentials  SET account_id=? WHERE account_id=?`).bind(into, fromId),
      db.prepare(`UPDATE external_identities SET account_id=? WHERE account_id=?`).bind(into, fromId),
      db
        .prepare(`INSERT INTO account_merges (id, from_account_id, into_account_id, merged_by, reason, merged_at) VALUES (?,?,?,?,?,?)`)
        .bind(mergeId, fromId, into, actor, reason, now),
      db.prepare(`UPDATE accounts SET status='merged', merged_into=?, token_epoch=token_epoch+1 WHERE id=?`).bind(into, fromId),
      // Path-compress: anything that pointed at fromId now points straight at into.
      db.prepare(`UPDATE accounts SET merged_into=? WHERE merged_into=?`).bind(into, fromId),
    ])
  } catch (e) {
    // Two near-simultaneous identical merges can both pass the idempotency
    // SELECT above before either's INSERT lands — the loser trips
    // `uidx_merge_active` (UNIQUE on from_account_id WHERE superseded_by IS
    // NULL). That's the SAME situation the pre-check exists to short-circuit,
    // just discovered a beat later, so it gets the same graceful no-op
    // instead of bubbling up as an unhandled 500.
    if (String((e as Error)?.message || '').includes('UNIQUE')) {
      return { ok: true, retagCounts: {}, gameData: GAME_DATA_POINTER, dryRun, noop: true }
    }
    throw e
  }

  return { ok: true, retagCounts, gameData: GAME_DATA_POINTER, dryRun: false }
}
