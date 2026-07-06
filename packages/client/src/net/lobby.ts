import { quickAuth } from './identity'

/**
 * Lobby / game-creation flows over the Worker's HTTP protocol.
 *
 * WHAT THE WORKER SUPPORTS TODAY (Phases 1-5): `POST /games { playerCount,
 * seatOwners }` creates a DO game with FIXED seat owners and returns
 * `{ gameId, code }` (the server mints its own room code). There is NO
 * client-facing code→gameId resolver and NO seat-join endpoint, so a functional
 * online game is created with seat 0 = me + AI opponents (online solo-vs-AI over
 * the authoritative protocol). Human-vs-human JOIN is gated on two deferred
 * Worker endpoints (see `joinOnlineGame`).
 */

export type SeatOwnerSpec = {
  ownerType: 'human' | 'ai' | 'open'
  accountId?: string | null
  ghostId?: string | null
  displayName?: string | null
  aiDifficulty?: string | null
}

export type CreatedGame = {
  gameId: string
  code: string
  mySeat: number
  players: string[]
}

/**
 * Quick-account then create a solo-vs-AI online game (seat 0 = me, the rest AI).
 * Returns the gameId + room code + my seat + display names for the seats.
 */
export async function createOnlineGame(
  serverUrl: string,
  opts: { displayName: string; opponents: number; aiDifficulty?: string },
): Promise<CreatedGame> {
  const { accountId } = await quickAuth(serverUrl, opts.displayName)

  const playerCount = 1 + Math.max(1, opts.opponents)
  const seatOwners: SeatOwnerSpec[] = [
    { ownerType: 'human', accountId, displayName: opts.displayName },
  ]
  for (let i = 1; i < playerCount; i++) {
    seatOwners.push({ ownerType: 'ai', aiDifficulty: opts.aiDifficulty ?? 'medium', displayName: `AI ${i + 1}` })
  }

  const res = await fetch(`${serverUrl}/games`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerCount, seatOwners }),
  })
  if (!res.ok) throw new Error(`create game failed: ${res.status}`)
  const { gameId, code } = (await res.json()) as { gameId: string; code: string }

  return { gameId, code, mySeat: 0, players: seatOwners.map((s) => s.displayName ?? 'Player') }
}

/**
 * Join an existing room by code. DEFERRED: the current Worker exposes neither a
 * code→gameId resolver nor a seat-join endpoint (games are created with fixed
 * seats), so this cannot complete against Phases 1-5. It is stubbed to fail
 * clearly; wiring it up is a Phase-7 Worker task (`GET /games/resolve?code=` +
 * a `POST /games/:id/join` that assigns an open seat to the caller's account).
 */
export async function joinOnlineGame(
  _serverUrl: string,
  _opts: { code: string; displayName: string },
): Promise<CreatedGame> {
  throw new Error('join-by-code is not available yet (needs the Worker lobby-resolve + seat-join endpoints — Phase 7)')
}
