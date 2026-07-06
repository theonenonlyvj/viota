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
     id              TEXT PRIMARY KEY,
     credential_hash TEXT UNIQUE NOT NULL,
     username        TEXT UNIQUE,
     display_name    TEXT NOT NULL,
     created_at      INTEGER NOT NULL
   )`,
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
     code             TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_games_status_activity ON games (status, last_activity_at)`,
  `CREATE INDEX IF NOT EXISTS idx_games_code ON games (code)`,
  `CREATE TABLE IF NOT EXISTS game_players (
     game_uuid    TEXT,
     seat_index   INTEGER,
     account_id   TEXT,
     ghost_id     TEXT,
     owner_type   TEXT,
     display_name TEXT,
     final_score  INTEGER,
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
]

/** Apply the archive schema idempotently. Safe to call repeatedly. */
export async function applyD1Schema(db: D1Database): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.exec(stmt.replace(/\s+/g, ' ').trim())
  }
}
