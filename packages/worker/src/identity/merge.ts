/**
 * `mergeAccounts` — the single primitive behind both the login session-bound
 * ghost-fold (see `routes.ts`'s `handleLogin`) and the admin `/admin/merge`
 * endpoint. Re-tags every row that references `fromId` onto the canonical
 * head of `intoId`, marks `fromId` `status='merged'`, and PATH-COMPRESSES any
 * account that already pointed at `fromId` so `canonical()` never has to walk
 * more than one hop for them going forward.
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
 *  - self-play-flagging: reports (never blocks on) any `game_uuid` where
 *    `fromId` and `into` occupied DIFFERENT seats of the SAME game — that's
 *    evidence the two accounts were controlled by different people and an
 *    admin should look before merging for real.
 *  - `dryRun`: computes `retagCounts`/`selfPlayFlags` with read-only queries
 *    and returns without writing anything.
 *  - `includeAudit=false`: skips those read-only audit queries for a
 *    session-bound automatic login fold; the transactional write set is
 *    unchanged. Dry runs always include the audit.
 */
import { canonical } from './canonical'

export type MergeResult = {
  ok: boolean
  retagCounts: Record<string, number>
  selfPlayFlags: string[]
  dryRun: boolean
  noop?: boolean
}

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
  if (!canonInto) return { ok: false, retagCounts: {}, selfPlayFlags: [], dryRun }
  const into = canonInto.id

  const canonFrom = await canonical(db, fromId)
  if (!canonFrom || canonFrom.id === into) {
    // Already the same canonical account (includes fromId === intoId, or a
    // prior merge already folded fromId's whole chain into into) -> no-op.
    return { ok: true, retagCounts: {}, selfPlayFlags: [], dryRun, noop: true }
  }

  // Idempotency guard: an already-active merge edge for fromId means a prior
  // call (e.g. a retried login-fold) already did this work.
  const active = await db
    .prepare(`SELECT id FROM account_merges WHERE from_account_id=? AND superseded_by IS NULL`)
    .bind(fromId)
    .first<{ id: string }>()
  if (active) return { ok: true, retagCounts: {}, selfPlayFlags: [], dryRun, noop: true }

  let selfPlayFlags: string[] = []
  let retagCounts: Record<string, number> = {}
  if (includeAudit) {
    // Self-play: games where fromId and into occupy DIFFERENT seats of the SAME
    // game (evidence of two distinct humans, not one person's ghost + account).
    const sp = await db
      .prepare(
        `SELECT DISTINCT a.game_uuid AS g FROM game_players a JOIN game_players b
           ON a.game_uuid=b.game_uuid AND a.seat_index<>b.seat_index
         WHERE a.account_id=? AND b.account_id=?`,
      )
      .bind(fromId, into)
      .all<{ g: string }>()
    selfPlayFlags = sp.results.map((r) => r.g)

    const countOf = async (table: string): Promise<number> => {
      const r = await db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE account_id=?`).bind(fromId).first<{ n: number }>()
      return r?.n ?? 0
    }
    retagCounts = {
      device_credentials: await countOf('device_credentials'),
      game_players: await countOf('game_players'),
      external_identities: await countOf('external_identities'),
    }
  }

  if (dryRun) return { ok: true, retagCounts, selfPlayFlags, dryRun: true }

  const now = Date.now()
  const mergeId = crypto.randomUUID()
  try {
    await db.batch([
      db.prepare(`UPDATE device_credentials  SET account_id=? WHERE account_id=?`).bind(into, fromId),
      db.prepare(`UPDATE game_players        SET account_id=? WHERE account_id=?`).bind(into, fromId),
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
      return { ok: true, retagCounts: {}, selfPlayFlags: [], dryRun, noop: true }
    }
    throw e
  }

  return { ok: true, retagCounts, selfPlayFlags, dryRun: false }
}
