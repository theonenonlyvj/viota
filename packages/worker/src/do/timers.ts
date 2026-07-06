import type { SqlLike } from './storage'

/**
 * Durable timer-wheel.
 *
 * The `timers(kind, seat, fire_at)` table IS the wheel. The single platform
 * Alarm is ALWAYS armed to `min(fire_at)` (or cleared when the wheel is empty),
 * so liveness is structural: an Alarm persists and re-fires across eviction and
 * redeploy, and the Alarm firing IS the rehydration trigger.
 *
 * The table-mutating fns (`setTimer`/`clearTimer`/`creditEvictionGap`) are pure
 * synchronous SQL and are therefore safe to call INSIDE a `transactionSync`
 * span. Arming the PLATFORM alarm (`rearmAlarm`) awaits `storage.setAlarm`, so
 * it is a separate primitive the caller runs AFTER the sync write span — never
 * inside it (zero awaits inside a sync span). The invariant "the platform alarm
 * equals min(fire_at)" is re-established by calling `rearmAlarm` at the end of
 * every handler / alarm entry that touched the wheel.
 */

export type TimerKind = 'grace' | 'turn' | 'ai_step' | 'heal' | 'soft'

export type TimerRow = { kind: TimerKind; seat: number; fire_at: number }

/** The minimal slice of DurableObjectState.storage the platform-alarm needs. */
export interface AlarmStorage {
  setAlarm(scheduledTime: number | Date): void | Promise<void>
  deleteAlarm(): void | Promise<void>
  getAlarm(): Promise<number | null> | number | null
}
export interface AlarmCtx {
  storage: AlarmStorage
}

/** Upsert a timer (keyed by kind+seat). Synchronous SQL — safe in a sync span.
 *  Does NOT arm the platform alarm; the caller re-arms via `rearmAlarm` after
 *  the write span (setAlarm awaits and cannot run inside `transactionSync`). */
export function setTimer(sql: SqlLike, kind: TimerKind, seat: number, fireAt: number): void {
  sql.exec(
    `INSERT INTO timers (kind, seat, fire_at) VALUES (?, ?, ?)
     ON CONFLICT(kind, seat) DO UPDATE SET fire_at = excluded.fire_at`,
    kind,
    seat,
    fireAt,
  )
}

/** Delete a timer (keyed by kind+seat). Synchronous SQL — safe in a sync span. */
export function clearTimer(sql: SqlLike, kind: TimerKind, seat: number): void {
  sql.exec(`DELETE FROM timers WHERE kind = ? AND seat = ?`, kind, seat)
}

/** True iff a timer with this kind+seat exists. */
export function hasTimer(sql: SqlLike, kind: TimerKind, seat: number): boolean {
  return [...sql.exec(`SELECT 1 FROM timers WHERE kind = ? AND seat = ? LIMIT 1`, kind, seat)].length > 0
}

/** Every timer due at `now` (fire_at <= now), earliest first. */
export function dueTimers(sql: SqlLike, now: number): TimerRow[] {
  return [...sql.exec(`SELECT kind, seat, fire_at FROM timers WHERE fire_at <= ? ORDER BY fire_at ASC`, now)].map(
    (r) => ({ kind: r.kind as TimerKind, seat: Number(r.seat), fire_at: Number(r.fire_at) }),
  )
}

/** The earliest fire_at in the wheel, or null when the wheel is empty. */
export function minFireAt(sql: SqlLike): number | null {
  const r = [...sql.exec(`SELECT MIN(fire_at) AS m FROM timers`)][0] as { m: number | null } | undefined
  return r && r.m != null ? Number(r.m) : null
}

/**
 * Boot grace-quarantine credit (spec §3.7): a DO is never told how long it was
 * evicted, so a compute gap must never be miscounted as player absence. Extend
 * every ABSENCE deadline (grace/turn/soft) by the eviction gap so a deadline
 * that merely "passed" while the DO was asleep is not treated as expiry. The
 * ai_step/heal drive ticks are NOT credited — they should just fire and drive.
 */
export function creditEvictionGap(sql: SqlLike, gap: number): void {
  if (gap <= 0) return
  sql.exec(`UPDATE timers SET fire_at = fire_at + ? WHERE kind IN ('grace','turn','soft')`, gap)
}

/**
 * Re-arm the SINGLE platform alarm to `min(fire_at)` — or clear it when the
 * wheel is empty. Awaits `setAlarm`/`deleteAlarm`, so it MUST run outside any
 * `transactionSync` span. Idempotent: calling it repeatedly just re-asserts the
 * invariant.
 */
export async function rearmAlarm(ctx: AlarmCtx, sql: SqlLike): Promise<void> {
  const min = minFireAt(sql)
  if (min == null) {
    await ctx.storage.deleteAlarm()
  } else {
    await ctx.storage.setAlarm(min)
  }
}
