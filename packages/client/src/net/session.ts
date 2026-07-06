/**
 * The current online game session (survives navigation between the lobby, the
 * waiting room, and the game page via sessionStorage). Not the durable identity
 * — that is the localStorage device credential + token in `identity.ts`.
 */
export type OnlineSession = {
  gameId: string
  code: string
  mySeat: number
  players: string[]
}

const KEY = 'viota_online_session'

export function saveSession(s: OnlineSession): void {
  sessionStorage.setItem(KEY, JSON.stringify(s))
}

export function loadSession(): OnlineSession | null {
  const raw = sessionStorage.getItem(KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as OnlineSession
  } catch {
    return null
  }
}

export function clearSession(): void {
  sessionStorage.removeItem(KEY)
}
