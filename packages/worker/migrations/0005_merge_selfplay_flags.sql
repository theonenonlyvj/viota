-- viota D1 — migration 0005: merge reconciler self-play flags.
--
-- WHY: identity code/data split (A9) — `mergeAccounts` (identity/merge.ts)
-- no longer scans `game_players` for self-play (identity code contains NO
-- game-table SQL at all). That detection moved to viota's OWN merge
-- reconciler (src/do/reconcile.ts, run from the existing 1-minute cron in
-- src/index.ts), which needs somewhere durable in viota's D1 to record a flag
-- for admin review (`GET /admin/merge-audit`, A6) rather than just logging it
-- into the void. This is game-domain data (viota's own D1), same table set
-- `schema/d1.sql` and `src/d1/schema.ts` already declare (folded into the
-- base CREATE for a fresh one-shot apply / test-harness re-apply).
--
-- ALL ADDITIVE: a new table only. The PRIMARY KEY makes flagging the same
-- (game, from, into) triple across repeated cron sweeps `ON CONFLICT DO
-- NOTHING` — one row per distinct self-play finding, not one per sweep.

CREATE TABLE IF NOT EXISTS merge_selfplay_flags (
  game_uuid   TEXT NOT NULL,
  from_id     TEXT NOT NULL,
  into_id     TEXT NOT NULL,
  detected_at INTEGER NOT NULL,
  PRIMARY KEY (game_uuid, from_id, into_id)
);
