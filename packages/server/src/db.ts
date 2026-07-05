import Database from 'better-sqlite3'

export type Db = InstanceType<typeof Database>

export function createDb(filename: string = 'viota.db'): Db {
  const db = new Database(filename)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'waiting',
      disconnect_timeout INTEGER NOT NULL DEFAULT 120,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT NOT NULL REFERENCES rooms(code),
      player_index INTEGER NOT NULL,
      name TEXT NOT NULL,
      account_id INTEGER REFERENCES accounts(id),
      guest_secret TEXT,
      is_connected INTEGER NOT NULL DEFAULT 0,
      disconnected_at INTEGER,
      UNIQUE(room_code, player_index),
      UNIQUE(room_code, name)
    );

    CREATE TABLE IF NOT EXISTS game_states (
      room_code TEXT PRIMARY KEY REFERENCES rooms(code),
      grid_json TEXT NOT NULL,
      draw_pile_json TEXT NOT NULL,
      hands_json TEXT NOT NULL,
      scores_json TEXT NOT NULL,
      turn_index INTEGER NOT NULL,
      played_cards_json TEXT NOT NULL,
      consecutive_passes INTEGER NOT NULL DEFAULT 0,
      finished INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `)

  // Additive migration for databases created before these columns existed.
  const cols = (db.prepare('PRAGMA table_info(game_states)').all() as { name: string }[]).map(c => c.name)
  if (!cols.includes('consecutive_passes')) db.exec('ALTER TABLE game_states ADD COLUMN consecutive_passes INTEGER NOT NULL DEFAULT 0')
  if (!cols.includes('finished')) db.exec('ALTER TABLE game_states ADD COLUMN finished INTEGER NOT NULL DEFAULT 0')

  return db
}
