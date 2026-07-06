import { quickAuth } from './identity'
import { authedFetch } from './http'

/**
 * Lobby / room-lifecycle flows over the Worker's HTTP protocol.
 *
 * Three ways in:
 *  - `createOnlineGame` — solo vs AI (seat 0 = me, the rest AI; immediate deal).
 *  - `createOnlineRoom` — a multiplayer WAITING room others join by code.
 *  - `joinOnlineGame`   — join a friend's room by code.
 * Plus the waiting-room helpers `fetchRoom` / `startRoom` / `leaveGame`.
 */

export type CreatedGame = {
  gameId: string
  code: string
  mySeat: number
  players: string[]
}

export type RoomSeat = { seatIndex: number; ownerType: string; displayName: string | null }

/** The result of polling a room via GET /sync: still filling, or the game started. */
export type RoomState =
  | { status: 'waiting'; playerCount: number; code: string | null; seats: RoomSeat[] }
  | { status: 'started' }

/** Roster seat -> a display label (open seats read as "Open"). */
function seatLabel(s: RoomSeat): string {
  if (s.displayName && s.displayName.length > 0) return s.displayName
  if (s.ownerType === 'open') return 'Open'
  if (s.ownerType === 'ai') return 'AI'
  return 'Player'
}

/**
 * Quick-account then create a solo-vs-AI online game via the authed mode path
 * (`mode:'solo'` — seat 0 = me, the rest medium AI; the server deals immediately).
 * The legacy unauthed `{ seatOwners }` create was removed server-side, so this
 * now sends a Bearer token (from quickAuth). Returns gameId + code + my seat +
 * the seat display names.
 */
export async function createOnlineGame(
  serverUrl: string,
  opts: { displayName: string; opponents: number },
): Promise<CreatedGame> {
  await quickAuth(serverUrl, opts.displayName)

  const playerCount = 1 + Math.max(1, opts.opponents)
  const res = await authedFetch(serverUrl, '/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerCount, mode: 'solo', displayName: opts.displayName }),
  })
  if (!res.ok) throw new Error(`create game failed: ${res.status}`)
  const { gameId, code } = (await res.json()) as { gameId: string; code: string }

  // Server names the AI seats `AI 2`, `AI 3`, … (seat 0 is me).
  const players = [opts.displayName, ...Array.from({ length: playerCount - 1 }, (_, i) => `AI ${i + 2}`)]
  return { gameId, code, mySeat: 0, players }
}

/**
 * Create a MULTIPLAYER waiting room (mode='multiplayer'): seat 0 = me (host),
 * the rest 'open' until friends join by code. `playerCount` is the total number
 * of seats (host + others). Returns the shareable room code + a placeholder
 * roster (open slots) the WaitingRoom then fills by polling.
 */
export async function createOnlineRoom(
  serverUrl: string,
  opts: { displayName: string; playerCount: number },
): Promise<CreatedGame> {
  await quickAuth(serverUrl, opts.displayName)
  const playerCount = Math.min(4, Math.max(2, opts.playerCount))

  const res = await authedFetch(serverUrl, '/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerCount, mode: 'multiplayer', displayName: opts.displayName }),
  })
  if (!res.ok) throw new Error(`create room failed: ${res.status}`)
  const { gameId, code } = (await res.json()) as { gameId: string; code: string }

  const players = [opts.displayName, ...Array.from({ length: playerCount - 1 }, () => 'Open')]
  return { gameId, code, mySeat: 0, players }
}

/**
 * Join an existing room by code: quick-auth -> resolve the code to a gameId ->
 * POST /join to claim an open seat. Returns the resolved gameId + my seat + the
 * live roster. Throws a friendly message on an unknown code / full room.
 */
export async function joinOnlineGame(
  serverUrl: string,
  opts: { code: string; displayName: string },
): Promise<CreatedGame> {
  await quickAuth(serverUrl, opts.displayName)

  const code = opts.code.trim().toUpperCase()
  const rr = await fetch(`${serverUrl}/games/resolve?code=${encodeURIComponent(code)}`)
  if (!rr.ok) {
    throw new Error(rr.status === 404 ? `No open game found for code ${code}` : `Could not look up room (${rr.status})`)
  }
  const { gameId } = (await rr.json()) as { gameId: string }

  const jr = await authedFetch(serverUrl, `/games/${encodeURIComponent(gameId)}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: opts.displayName }),
  })
  if (!jr.ok) {
    throw new Error(jr.status === 409 ? 'That room is full or already started' : `Could not join room (${jr.status})`)
  }
  const { seatIndex, room } = (await jr.json()) as {
    seatIndex: number
    room: { code: string | null; seats: RoomSeat[] }
  }

  return { gameId, code: room.code ?? code, mySeat: seatIndex, players: room.seats.map(seatLabel) }
}

/**
 * Poll a room's state via GET /sync. While 'waiting' it returns the roster + the
 * shared code; once the game has been dealt the sync returns the active board
 * (no `status`), which we surface as `{ status: 'started' }` so the WaitingRoom
 * navigates into the game.
 */
export async function fetchRoom(serverUrl: string, gameId: string): Promise<RoomState> {
  const res = await authedFetch(serverUrl, `/games/${encodeURIComponent(gameId)}/sync`, { method: 'GET' })
  if (!res.ok) throw new Error(`room sync failed: ${res.status}`)
  const body = (await res.json()) as {
    status?: string
    playerCount?: number
    code?: string | null
    seats?: RoomSeat[]
  }
  if (body.status === 'waiting') {
    return { status: 'waiting', playerCount: body.playerCount ?? 0, code: body.code ?? null, seats: body.seats ?? [] }
  }
  return { status: 'started' }
}

/** Start a waiting room (deal + go live). Any seated player may call it. */
export async function startRoom(serverUrl: string, gameId: string): Promise<void> {
  const res = await authedFetch(serverUrl, `/games/${encodeURIComponent(gameId)}/start`, { method: 'POST' })
  if (!res.ok) throw new Error(`start failed: ${res.status}`)
}

/** Intentional leave: the server AI-covers my seat immediately. Best-effort. */
export async function leaveGame(serverUrl: string, gameId: string): Promise<void> {
  try {
    await authedFetch(serverUrl, `/games/${encodeURIComponent(gameId)}/leave`, { method: 'POST' })
  } catch {
    /* leaving anyway — presence will lapse and cover the seat regardless */
  }
}
