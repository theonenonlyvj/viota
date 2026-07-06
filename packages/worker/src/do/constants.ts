/**
 * Never-stall protocol constants (spec §3, §9). One shared module so every
 * deadline uses the same value and there is a single place to tune them.
 *
 * All of these are DURATIONS in milliseconds; every actual deadline is a
 * server-side storage column (a `timers` row), never a client timer.
 */

/** Presence window: a seat is "present" iff last_seen_at is within this. */
export const PRESENCE_MS = 45_000

/** Off-turn disconnect grace before an absent seat is AI-covered. */
export const GRACE_MS = 120_000

/** On-turn fast-track: a disconnected seat that is ON turn is covered faster,
 *  so present players are never held hostage by one locked phone. */
export const AWAY_TURN_MS = 27_000

/** Soft visible per-turn deadline for a connected-but-AFK seat. */
export const SOFT_TURN_MS = 75_000

/** AI pacing between chained drive steps (humans see each play land). */
export const AI_STEP_MS = 800

/** Self-tick cadence for the `heal` alarm (abandon check + re-drive safety). */
export const HEAL_MS = 60_000

/** Zero humans present for this long → the game is marked abandoned. */
export const ABANDON_MS = 600_000

/** Sentinel seat for seat-agnostic timers (e.g. `heal`). The `timers` PK is
 *  (kind, seat); a real seat is >= 0, so -1 never collides. NULL is avoided
 *  because SQLite treats NULLs as distinct in a UNIQUE/PK index, which would
 *  break ON CONFLICT upserts. */
export const GLOBAL_SEAT = -1
