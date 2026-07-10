-- viota D1 — migration 0003: VGames identity (P1).
--
-- WHY: shared VGames accounts (ghost + username/password + device binding +
-- merge) sit inside viota's existing worker/D1. This is the incremental delta
-- applied ONCE to the existing prod D1 (which still has the pre-0003 CREATEs
-- from 0001/0002) — `schema/d1.sql` and `src/d1/schema.ts` already declare the
-- FULL resulting shape (folded into the base CREATE TABLE statements) for a
-- fresh one-shot apply / test-harness re-apply.
--
-- ALL ADDITIVE: only ADD COLUMN (nullable or DEFAULTed) and
-- CREATE TABLE/INDEX/VIEW IF NOT EXISTS. No DROP, no NOT NULL tightening on an
-- existing column, no table rebuild. `accounts.credential_hash` stays the
-- NOT NULL UNIQUE device-credential lookup key untouched.

ALTER TABLE accounts ADD COLUMN status             TEXT NOT NULL DEFAULT 'ghost';
ALTER TABLE accounts ADD COLUMN password_hash      TEXT;
ALTER TABLE accounts ADD COLUMN must_change_pw     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN token_epoch        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN claimed_at         INTEGER;
ALTER TABLE accounts ADD COLUMN last_seen_at       INTEGER;
ALTER TABLE accounts ADD COLUMN merged_into        TEXT;
ALTER TABLE accounts ADD COLUMN origin_game        TEXT NOT NULL DEFAULT 'iota';
ALTER TABLE accounts ADD COLUMN login_fail_count   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN login_locked_until INTEGER;
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_merged ON accounts(merged_into);

CREATE TABLE IF NOT EXISTS device_credentials (
  credential_hash TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  created_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  revoked_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_devcred_account ON device_credentials(account_id);

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

CREATE TABLE IF NOT EXISTS external_identities (
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  game        TEXT NOT NULL,
  id_kind     TEXT NOT NULL,
  external_id TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (game, id_kind, external_id)
);
CREATE INDEX IF NOT EXISTS idx_extid_account ON external_identities(account_id);

ALTER TABLE games ADD COLUMN game_type TEXT NOT NULL DEFAULT 'iota';
ALTER TABLE games ADD COLUMN seed      TEXT;
CREATE INDEX IF NOT EXISTS idx_games_type_status ON games(game_type, status);

ALTER TABLE game_players ADD COLUMN result        TEXT;
ALTER TABLE game_players ADD COLUMN stats         TEXT;
ALTER TABLE game_players ADD COLUMN ai_move_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE game_players ADD COLUMN total_moves   INTEGER NOT NULL DEFAULT 0;

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
