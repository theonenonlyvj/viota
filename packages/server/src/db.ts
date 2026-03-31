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
      updated_at INTEGER NOT NULL
    );
  `)

  return db
}
