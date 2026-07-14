-- viota D1 — migration 0004: stats (Phase 2).
--
-- WHY: `game_players.opponent_kind` classifies each seat's opponents as
-- 'human' (>=1 OTHER seat in the game was human-owned) or 'ai' (AI-only), so
-- the vs-Friends / vs-AI leaderboard boards can filter cheaply without
-- re-deriving it per query. This is the incremental delta applied ONCE to the
-- existing prod D1 — `schema/d1.sql` and `src/d1/schema.ts` already declare
-- the FULL resulting shape (folded into game_players's CREATE) for a fresh
-- one-shot apply / test-harness re-apply.
--
-- ALL ADDITIVE: a single nullable ADD COLUMN. No DROP, no rebuild.

ALTER TABLE game_players ADD COLUMN opponent_kind TEXT;
