import type { GameRepository, SqlLike, SeatRow } from './storage'
import { setTimer, clearTimer } from './timers'
import { PRESENCE_MS, GRACE_MS, AWAY_TURN_MS } from './constants'

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

/**
 * Waiting-room host promotion (avoids a dead room if the host leaves before
 * /start). If `departingSeat` IS the current host, hand the host role to the
 * LOWEST-index seat that is still a PRESENT human (`owner_type='human'` AND
 * `last_seen_at` within PRESENCE_MS), excluding the departing seat. Returns the
 * new host seat index when it actually changed (so the caller can broadcast
 * `host_changed`), else null — nothing to promote, or no eligible successor (in
 * which case `host_seat` is left unchanged).
 */
export function promoteHost(repo: GameRepository, departingSeat: number, now: number): number | null {
  const meta = repo.getMeta()
  if (!meta) return null
  const host = meta.host_seat ?? 0
  if (host !== departingSeat) return null // the host is not the one leaving
  const successor = repo
    .getSeats()
    .find((s) => s.seat_index !== departingSeat && s.owner_type === 'human' && isSeatPresent(s, now))
  if (!successor) return null
  repo.putMeta({ ...meta, host_seat: successor.seat_index })
  return successor.seat_index
}

/** Broadcast surface for auto-cover (a dismissible `ai_cover` toast). */
export interface CoverDeps {
  broadcast(payload: unknown): void
}

/**
 * Disconnect detection: mark the seat disconnected and arm the right deadline.
 *  - `meta.ai_takeover_ms === 0` ("wait for me") → arm NO cover timer at all; a
 *    disconnected seat is NEVER auto-covered and the game just waits/pauses;
 *  - ON turn → the `turn` clock at `now + ai_takeover_ms` (the host's chosen
 *    patience; falls back to the fixed `AWAY_TURN_MS` when unset) so present
 *    players are never held hostage by one locked phone;
 *  - OFF turn → the fixed `grace` clock (~120s) before the absent seat is covered.
 */
export function markDisconnected(repo: GameRepository, sql: SqlLike, seat: number, now: number): void {
  const seatRow = repo.getSeats()[seat]
  if (!seatRow) return
  repo.setDisconnectedAt(seat, now)
  const meta = repo.getMeta()
  const takeover = meta?.ai_takeover_ms ?? null
  // "Wait for me": never auto-cover this seat — clear both absence deadlines.
  if (takeover === 0) {
    clearTimer(sql, 'grace', seat)
    clearTimer(sql, 'turn', seat)
    return
  }
  if (meta && meta.current_seat === seat) {
    clearTimer(sql, 'grace', seat)
    setTimer(sql, 'turn', seat, now + (takeover ?? AWAY_TURN_MS))
  } else {
    clearTimer(sql, 'turn', seat)
    setTimer(sql, 'grace', seat, now + GRACE_MS)
  }
}

/**
 * Auto-cover a seat with a fixed MEDIUM AI (never a blocking vote): flip
 * `controlled_by_ai`, cancel the seat's absence deadlines, kick the drive loop
 * with an immediate `ai_step`, and broadcast a dismissible `ai_cover` toast.
 * The caller re-arms the platform alarm after this returns.
 */
export function autoCover(deps: CoverDeps, repo: GameRepository, sql: SqlLike, seat: number, now: number): void {
  const seatRow = repo.getSeats()[seat]
  if (!seatRow) return
  repo.setControlledByAi(seat, true)
  clearTimer(sql, 'grace', seat)
  clearTimer(sql, 'turn', seat)
  clearTimer(sql, 'soft', seat)
  setTimer(sql, 'ai_step', seat, now) // fire the drive loop on the next alarm
  deps.broadcast({ type: 'ai_cover', seat })
}
