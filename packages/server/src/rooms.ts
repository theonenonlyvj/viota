import type { Db } from './db'
import { generateRoomCode, generateSecret } from './auth'

export type RoomRow = { code: string; status: string; disconnect_timeout: number; created_at: number }

export type PlayerRow = {
  id: number
  room_code: string
  player_index: number
  name: string
  account_id: number | null
  guest_secret: string | null
  is_connected: number
  disconnected_at: number | null
}

export function createRoom(db: Db, opts?: { disconnectTimeout?: number }): string {
  let code: string
  do {
    code = generateRoomCode()
  } while (db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(code))
  const timeout = opts?.disconnectTimeout ?? 120
  db.prepare('INSERT INTO rooms (code, status, disconnect_timeout, created_at) VALUES (?, ?, ?, ?)').run(code, 'waiting', timeout, Date.now())
  return code
}

export function getRoomByCode(db: Db, code: string): RoomRow | null {
  return (db.prepare('SELECT * FROM rooms WHERE code = ?').get(code) as RoomRow | undefined) ?? null
}

export function getPlayerCount(db: Db, roomCode: string): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM players WHERE room_code = ?').get(roomCode) as { count: number }
  return row.count
}

export function addPlayer(
  db: Db,
  roomCode: string,
  name: string,
  accountId?: number
): { playerIndex: number; guestSecret: string } | null {
  const count = getPlayerCount(db, roomCode)
  if (count >= 4) return null
  const playerIndex = count
  const guestSecret = generateSecret()
  try {
    db.prepare(
      'INSERT INTO players (room_code, player_index, name, account_id, guest_secret) VALUES (?, ?, ?, ?, ?)'
    ).run(roomCode, playerIndex, name, accountId ?? null, guestSecret)
    return { playerIndex, guestSecret }
  } catch {
    return null // unique constraint violation (duplicate name)
  }
}

export function setPlayerConnected(db: Db, roomCode: string, playerIndex: number, connected: boolean): void {
  db.prepare(
    'UPDATE players SET is_connected = ?, disconnected_at = ? WHERE room_code = ? AND player_index = ?'
  ).run(connected ? 1 : 0, connected ? null : Date.now(), roomCode, playerIndex)
}

export function getPlayers(db: Db, roomCode: string): PlayerRow[] {
  return db.prepare('SELECT * FROM players WHERE room_code = ? ORDER BY player_index').all(roomCode) as PlayerRow[]
}

export function setRoomStatus(db: Db, roomCode: string, status: 'waiting' | 'playing' | 'finished'): void {
  db.prepare('UPDATE rooms SET status = ? WHERE code = ?').run(status, roomCode)
}
