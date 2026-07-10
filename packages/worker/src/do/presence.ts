import type { GameRepository, SqlLike, SeatRow } from './storage'
import { setTimer, clearTimer, hasTimer } from './timers'
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
 * /start). If `departingSeat` IS the current host, hand the host role to another
 * HUMAN seat (`owner_type='human'`, excluding the departing seat): a PRESENT one
 * (lowest-index) if any, else the lowest-index human regardless of presence.
 *
 * Presence is NOT required, because a waiting room never establishes it — lobby
 * clients only poll GET /sync and don't heartbeat, so `isSeatPresent` is false
 * for every seat there. Requiring it would leave every host-leave un-promoted
 * and strand the joiners (they can never obtain Start). Returns the new host
 * seat index when it changed (so the caller broadcasts `host_changed`), else
 * null — the departing seat isn't the host, or no other human exists.
 */
export function promoteHost(repo: GameRepository, departingSeat: number, now: number): number | null {
  const meta = repo.getMeta()
  if (!meta) return null
  const host = meta.host_seat ?? 0
  if (host !== departingSeat) return null // the host is not the one leaving
  const humans = repo.getSeats().filter((s) => s.seat_index !== departingSeat && s.owner_type === 'human')
  if (humans.length === 0) return null // no one to promote — leave host_seat unchanged
  const successor = humans.find((s) => isSeatPresent(s, now)) ?? humans[0]! // present preferred, else lowest-index
  repo.putMeta({ ...meta, host_seat: successor.seat_index })
  return successor.seat_index
}

/**
 * Auto-cover arming for a SILENTLY disconnected on-turn human — the reliable
 * trigger `webSocketClose` cannot be (a locked phone / dropped network / crashed
 * tab sends no close, so `markDisconnected` is never reached on the paths that
 * matter). Presence is heartbeat-based, so "silently gone" == the current seat
 * is a human whose `last_seen_at` is stale (`isSeatPresent` false). Called from
 * the always-running paths (the heal self-tick, after each move, and the alarm),
 * it is IDEMPOTENT and safe to call every tick:
 *  - arms a `turn` cover deadline ONLY when the current seat is an ABSENT human
 *    that has no cover timer yet, so a PRESENT player (who keeps heartbeating) is
 *    never armed and a long "thinking" turn is never interrupted;
 *  - honors the host's patience (`meta.ai_takeover_ms`, falling back to the fixed
 *    `AWAY_TURN_MS` when unset) and arms NOTHING for "wait for me" (=== 0);
 *  - bases the deadline on `now` — the moment THIS call detects the seat is
 *    current-and-absent — NOT on the seat's stale `last_seen_at`. A backgrounded
 *    tab stops heartbeating entirely (client gates the heartbeat interval on
 *    `document.visibilityState`), so by the time the turn rotates onto that
 *    seat `last_seen_at` can already be older than the patience window; basing
 *    the deadline on it would arm an ALREADY-DUE timer and cover with ~0s of
 *    the intended patience. Using `now` always grants the full window from
 *    detection. The single-arm guard just above (`hasTimer`) still ensures this
 *    only happens ONCE per turn — a later heal tick does not push the deadline
 *    out or grant a fresh window on every call.
 * The alarm's `turn` branch re-checks presence and spares a player who returns
 * before it fires, so arming here can never wrongly cover a reconnecting player.
 */
export function armDisconnectCoverIfAbsent(repo: GameRepository, sql: SqlLike, now: number): void {
  const meta = repo.getMeta()
  if (!meta || meta.status !== 'active') return
  const takeover = meta.ai_takeover_ms ?? null
  if (takeover === 0) return // "wait for me" — never auto-cover
  const seat = repo.getSeats()[meta.current_seat]
  if (!seat || seat.owner_type !== 'human' || seat.controlled_by_ai) return // not a human seat to cover
  if (isSeatPresent(seat, now)) return // connected → never auto-covered
  if (hasTimer(sql, 'turn', meta.current_seat)) return // already armed — don't push it out
  setTimer(sql, 'turn', meta.current_seat, now + (takeover ?? AWAY_TURN_MS))
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
