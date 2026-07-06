-- viota D1 analytics archive — migration 0001 (initial schema).
--
-- This is the wrangler-migrations form of `schema/d1.sql` (kept byte-equivalent
-- to `src/d1/schema.ts`, which Miniflare/tests apply directly). Apply it to the
-- production D1 database with EITHER:
--
--   wrangler d1 migrations apply viota --remote
--
-- or, equivalently, the one-shot execute:
--
--   wrangler d1 execute viota --remote --file=schema/d1.sql
--
-- Every statement is `IF NOT EXISTS`, so re-applying is a safe no-op.

-- Cross-game identity. The lookup + uniqueness key is credential_hash (the
-- SHA-256 of the client-minted 256-bit device credential) — NEVER display_name.
-- The raw credential is NEVER stored, only its hash.
CREATE TABLE IF NOT EXISTS accounts (
  id              TEXT PRIMARY KEY,
  credential_hash TEXT UNIQUE NOT NULL,
  username        TEXT UNIQUE,
  display_name    TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);

-- Per-game archive row + the lobby registry. `code` is the human room code
-- (code -> game_uuid resolution); `last_activity_at` + `status` drive the cron
-- stale-game sweep. `source` is forced server-side ('online_authoritative' for
-- DO games; 'client_reported' solo logs are excluded from cross-player metrics).
CREATE TABLE IF NOT EXISTS games (
  game_uuid        TEXT PRIMARY KEY,
  mode             TEXT CHECK (mode IN ('online','local')),
  status           TEXT CHECK (status IN ('waiting','active','completed','stalemate','abandoned')),
  player_count     INTEGER,
  source           TEXT CHECK (source IN ('online_authoritative','client_reported')),
  engine_version   TEXT,
  winner_seat      INTEGER,
  outcome          TEXT,
  created_at       INTEGER,
  ended_at         INTEGER,
  last_activity_at INTEGER,
  code             TEXT
);
-- The lobby registry indexes: (status,last_activity_at) for the cron sweep,
-- code for code -> game_uuid join resolution.
CREATE INDEX IF NOT EXISTS idx_games_status_activity ON games (status, last_activity_at);
CREATE INDEX IF NOT EXISTS idx_games_code ON games (code);

-- Per-seat ownership at game time. The index on account_id is THE cross-session
-- analytics join (a player's history spans games/sessions/devices once ghost
-- games are claimed).
CREATE TABLE IF NOT EXISTS game_players (
  game_uuid    TEXT,
  seat_index   INTEGER,
  account_id   TEXT,
  ghost_id     TEXT,
  owner_type   TEXT,
  display_name TEXT,
  final_score  INTEGER,
  PRIMARY KEY (game_uuid, seat_index)
);
CREATE INDEX IF NOT EXISTS idx_game_players_account ON game_players (account_id);

-- The append-only move log IS the warehouse: complete, replayable, and
-- human-vs-AI-separable by construction (by_ai move-granular + controlling
-- account). `reverted` is re-flushed on veto so D1 replay skips reverted rows.
CREATE TABLE IF NOT EXISTS moves (
  game_uuid              TEXT,
  move_index             INTEGER,
  turn_number            INTEGER,
  seat_index             INTEGER,
  type                   TEXT,
  payload                TEXT,
  score_delta            INTEGER,
  score_after            INTEGER,
  by_ai                  INTEGER,
  ai_difficulty          TEXT,
  controlling_account_id TEXT,
  reverted               INTEGER,
  created_at             INTEGER,
  PRIMARY KEY (game_uuid, move_index)
);
