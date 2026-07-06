-- viota D1 analytics archive (Phase 5).
--
-- The DO SQLite copy of each game is the authoritative LIVE truth; this D1
-- database is the durable, queryable, REBUILDABLE archive (initial_state +
-- ordered non-reverted move payloads deterministically reconstruct any board).
-- It is written through from each DO via ctx.waitUntil AFTER the move commits;
-- a D1 hiccup can never stall a live game.
--
-- Apply in production once:  wrangler d1 execute viota --file=schema/d1.sql
-- (Miniflare/tests apply the mirrored statements in src/d1/schema.ts.)
--
-- TEXT + CHECK, never native ENUM (adding a status later is an insert, not a
-- painful ALTER TYPE). Every can't-backfill analytics dimension lands here.

-- Cross-game identity. The lookup + uniqueness key is credential_hash (the
-- SHA-256 of the client-minted 256-bit device credential) — NEVER display_name,
-- so two users with the same display name never collide and a different
-- credential can never attach to an existing account. The raw credential is
-- NEVER stored, only its hash.
-- country/region/timezone are COARSE, IP-derived geo captured from request.cf at
-- account creation (no GPS, no permission prompt). Persisted only at INSERT.
CREATE TABLE IF NOT EXISTS accounts (
  id              TEXT PRIMARY KEY,
  credential_hash TEXT UNIQUE NOT NULL,
  username        TEXT UNIQUE,
  display_name    TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  country         TEXT,
  region          TEXT,
  timezone        TEXT
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
