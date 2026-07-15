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
-- VGames identity additions (migration 0003, folded here for a fresh one-shot
-- apply): status/password/epoch/merge/device-origin bookkeeping. All additive —
-- credential_hash stays the NOT NULL UNIQUE device-credential lookup key above.
CREATE TABLE IF NOT EXISTS accounts (
  id                 TEXT PRIMARY KEY,
  credential_hash    TEXT UNIQUE NOT NULL,
  username           TEXT UNIQUE,
  display_name       TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  country            TEXT,
  region             TEXT,
  timezone           TEXT,
  status             TEXT NOT NULL DEFAULT 'ghost',
  password_hash      TEXT,
  must_change_pw     INTEGER NOT NULL DEFAULT 0,
  token_epoch        INTEGER NOT NULL DEFAULT 0,
  claimed_at         INTEGER,
  last_seen_at       INTEGER,
  merged_into        TEXT,
  origin_game        TEXT NOT NULL DEFAULT 'iota',
  login_fail_count   INTEGER NOT NULL DEFAULT 0,
  login_locked_until INTEGER
);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_merged ON accounts(merged_into);

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
  code             TEXT,
  game_type        TEXT NOT NULL DEFAULT 'iota',
  seed             TEXT
);
-- The lobby registry indexes: (status,last_activity_at) for the cron sweep,
-- code for code -> game_uuid join resolution, (game_type,status) for the
-- multi-game (VGames) lobby split.
CREATE INDEX IF NOT EXISTS idx_games_status_activity ON games (status, last_activity_at);
CREATE INDEX IF NOT EXISTS idx_games_code ON games (code);
CREATE INDEX IF NOT EXISTS idx_games_type_status ON games (game_type, status);

-- Per-seat ownership at game time. The index on account_id is THE cross-session
-- analytics join (a player's history spans games/sessions/devices once ghost
-- games are claimed). result/stats/ai_move_count/total_moves back the
-- leaderboard views below. opponent_kind (migration 0004, folded here):
-- 'human' iff >=1 OTHER seat in the game was human-owned, else 'ai' — lets the
-- vs-Friends / vs-AI boards filter cheaply without re-deriving per query.
CREATE TABLE IF NOT EXISTS game_players (
  game_uuid     TEXT,
  seat_index    INTEGER,
  account_id    TEXT,
  ghost_id      TEXT,
  owner_type    TEXT,
  display_name  TEXT,
  final_score   INTEGER,
  result        TEXT,
  stats         TEXT,
  ai_move_count INTEGER NOT NULL DEFAULT 0,
  total_moves   INTEGER NOT NULL DEFAULT 0,
  opponent_kind TEXT,
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

-- VGames identity (migration 0003): one device credential can be revoked and
-- re-issued without touching the account row; account_id -> accounts(id).
CREATE TABLE IF NOT EXISTS device_credentials (
  credential_hash TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  created_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  revoked_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_devcred_account ON device_credentials(account_id);

-- Merge history/audit trail. `uidx_merge_active` (below) enforces AT MOST ONE
-- live (superseded_by IS NULL) merge edge per from_account_id, so the
-- merge-chain walk in identity/canonical.ts never sees a branching graph.
CREATE TABLE IF NOT EXISTS account_merges (
  id              TEXT PRIMARY KEY,
  from_account_id TEXT NOT NULL,
  into_account_id TEXT NOT NULL,
  merged_by       TEXT NOT NULL,
  reason          TEXT,
  superseded_by   TEXT,
  merged_at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_merge_active
  ON account_merges(from_account_id) WHERE superseded_by IS NULL;

-- Cross-game external id bindings (e.g. a migrated vjaipur player row).
CREATE TABLE IF NOT EXISTS external_identities (
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  game        TEXT NOT NULL,
  id_kind     TEXT NOT NULL,
  external_id TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (game, id_kind, external_id)
);
CREATE INDEX IF NOT EXISTS idx_extid_account ON external_identities(account_id);

-- Cosmetic leaderboard views (P1). Only human-majority-move games count (an
-- AI-takeover-heavy game is excluded via the ai_move_count/total_moves guard).
-- UNUSED at runtime: live leaderboards are computed in src/stats/leaderboard.ts (TS handlers); views kept as schema-documented reference only
CREATE VIEW IF NOT EXISTS v_leaderboard AS
SELECT a.id AS account_id, a.display_name, g.game_type,
       COUNT(*) AS games,
       SUM(gp.result='win')  AS wins,
       SUM(gp.result='loss') AS losses,
       SUM(COALESCE(gp.final_score,0)) AS total_score
FROM game_players gp
JOIN games g    ON g.game_uuid = gp.game_uuid
JOIN accounts a ON a.id        = gp.account_id
WHERE gp.owner_type='human' AND g.status='completed'
  AND (gp.total_moves = 0 OR gp.ai_move_count * 2 <= gp.total_moves)
GROUP BY a.id, g.game_type;

CREATE VIEW IF NOT EXISTS v_leaderboard_all AS
SELECT a.id AS account_id, a.display_name,
       COUNT(*) AS games, SUM(gp.result='win') AS wins,
       ROUND(1.0*SUM(gp.result='win')/COUNT(*), 4) AS win_rate
FROM game_players gp
JOIN games g    ON g.game_uuid = gp.game_uuid
JOIN accounts a ON a.id        = gp.account_id
WHERE gp.owner_type='human' AND g.status='completed'
  AND (gp.total_moves = 0 OR gp.ai_move_count * 2 <= gp.total_moves)
GROUP BY a.id;
