import type { GameRepository, SeatRow } from './storage'
import { PRESENCE_MS } from './constants'

/**
 * Presence + auto-cover.
 *
 * HEARTBEAT IS THE SOLE PRESENCE AUTHORITY (must-fix #5). A seat is "present"
 * iff its `last_seen_at` is within PRESENCE_MS of now. The socket count
 * (`getWebSockets()`) is NEVER consulted for the drive/freeze/cover decision —
 * it counts hibernated sockets and disagrees with a mid-reconnect player. The
 * socket only decides who RECEIVES nudges.
 *
 * (markDisconnected + autoCover — the cover mechanics — are added in task 4.)
 */

/** A single seat is present iff it heartbeated within the presence window. */
export function isSeatPresent(seat: SeatRow, now: number): boolean {
  return seat.last_seen_at != null && now - seat.last_seen_at <= PRESENCE_MS
}

/** True iff ANY seat is a present human (a pure-AI seat never heartbeats, so it
 *  never carries a fresh last_seen_at). This gates drive vs. freeze. */
export function isAnyHumanPresent(repo: GameRepository, now: number): boolean {
  return repo.getSeats().some((s) => isSeatPresent(s, now))
}

/** Present-check for a specific seat index. */
export function seatIndexPresent(repo: GameRepository, seatIndex: number, now: number): boolean {
  const s = repo.getSeats()[seatIndex]
  return !!s && isSeatPresent(s, now)
}

/** The most recent last_seen_at across all seats, or null if none ever seen. */
export function maxLastSeen(repo: GameRepository): number | null {
  let max: number | null = null
  for (const s of repo.getSeats()) {
    if (s.last_seen_at != null && (max == null || s.last_seen_at > max)) max = s.last_seen_at
  }
  return max
}
