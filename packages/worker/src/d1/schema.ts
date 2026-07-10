/**
 * D1 analytics-archive schema application.
 *
 * `vitest-pool-workers` does NOT auto-migrate D1 (unlike the DO's per-boot
 * `runMigrations`), so tests apply this in a `beforeAll`. Production applies the
 * mirrored `schema/d1.sql` once via `wrangler d1 execute viota --file=...`.
 *
 * Statements MUST stay byte-equivalent to `schema/d1.sql`. Each is idempotent
 * (`CREATE TABLE/INDEX IF NOT EXISTS`), so re-applying on every boot/test is
 * safe. We collapse internal whitespace and run each statement through
 * `db.exec` individually — `exec` splits its input on newlines and runs each
 * line as a statement, so a multi-line CREATE would be shredded; collapsing to a
 * single line makes each statement exactly one `exec` unit.
 */

/** The archive schema as individual (readable, multi-line) statements. */
export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS accounts (
     id                  TEXT PRIMARY KEY,
     credential_hash     TEXT UNIQUE NOT NULL,
     username            TEXT UNIQUE,
     display_name        TEXT NOT NULL,
     created_at          INTEGER NOT NULL,
     country             TEXT,
     region              TEXT,
     timezone            TEXT,
     status              TEXT NOT NULL DEFAULT 'ghost',
     password_hash       TEXT,
     must_change_pw      INTEGER NOT NULL DEFAULT 0,
     token_epoch         INTEGER NOT NULL DEFAULT 0,
     claimed_at          INTEGER,
     last_seen_at        INTEGER,
     merged_into         TEXT,
     origin_game         TEXT NOT NULL DEFAULT 'iota',
     login_fail_count    INTEGER NOT NULL DEFAULT 0,
     login_locked_until  INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status)`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_merged ON accounts(merged_into)`,
  `CREATE TABLE IF NOT EXISTS games (
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
   )`,
  `CREATE INDEX IF NOT EXISTS idx_games_status_activity ON games (status, last_activity_at)`,
  `CREATE INDEX IF NOT EXISTS idx_games_code ON games (code)`,
  `CREATE INDEX IF NOT EXISTS idx_games_type_status ON games (game_type, status)`,
  `CREATE TABLE IF NOT EXISTS game_players (
     game_uuid      TEXT,
     seat_index     INTEGER,
     account_id     TEXT,
     ghost_id       TEXT,
     owner_type     TEXT,
     display_name   TEXT,
     final_score    INTEGER,
     result         TEXT,
     stats          TEXT,
     ai_move_count  INTEGER NOT NULL DEFAULT 0,
     total_moves    INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (game_uuid, seat_index)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_game_players_account ON game_players (account_id)`,
  `CREATE TABLE IF NOT EXISTS moves (
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
   )`,
  `CREATE TABLE IF NOT EXISTS device_credentials (
     credential_hash TEXT PRIMARY KEY,
     account_id      TEXT NOT NULL REFERENCES accounts(id),
     created_at      INTEGER NOT NULL,
     last_seen_at    INTEGER NOT NULL,
     revoked_at      INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_devcred_account ON device_credentials(account_id)`,
  `CREATE TABLE IF NOT EXISTS account_merges (
     id              TEXT PRIMARY KEY,
     from_account_id TEXT NOT NULL,
     into_account_id TEXT NOT NULL,
     merged_by       TEXT NOT NULL,
     reason          TEXT,
     superseded_by   TEXT,
     merged_at       INTEGER NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uidx_merge_active ON account_merges(from_account_id) WHERE superseded_by IS NULL`,
  `CREATE TABLE IF NOT EXISTS external_identities (
     account_id  TEXT NOT NULL REFERENCES accounts(id),
     game        TEXT NOT NULL,
     id_kind     TEXT NOT NULL,
     external_id TEXT NOT NULL,
     created_at  INTEGER NOT NULL,
     PRIMARY KEY (game, id_kind, external_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_extid_account ON external_identities(account_id)`,
  `CREATE VIEW IF NOT EXISTS v_leaderboard AS
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
   GROUP BY a.id, g.game_type`,
  `CREATE VIEW IF NOT EXISTS v_leaderboard_all AS
   SELECT a.id AS account_id, a.display_name,
          COUNT(*) AS games, SUM(gp.result='win') AS wins,
          ROUND(1.0*SUM(gp.result='win')/COUNT(*), 4) AS win_rate
   FROM game_players gp
   JOIN games g    ON g.game_uuid = gp.game_uuid
   JOIN accounts a ON a.id        = gp.account_id
   WHERE gp.owner_type='human' AND g.status='completed'
     AND (gp.total_moves = 0 OR gp.ai_move_count * 2 <= gp.total_moves)
   GROUP BY a.id`,
]

/** Apply the archive schema idempotently. Safe to call repeatedly. */
export async function applyD1Schema(db: D1Database): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.exec(stmt.replace(/\s+/g, ' ').trim())
  }
}
