import type { MoveRow, SeatRow } from './storage'

/**
 * D1 archive write-through (must-fix #8 — the Cloudflare Queue is NOT used).
 *
 * These are the ONLY functions that touch the D1 archive. The DO calls them from
 * `ctx.waitUntil` AFTER a move commits, so a D1 outage only ever leaves outbox
 * rows unflushed (retried by the cron/`/tick`) — it can never stall the live
 * game, whose authoritative truth is the DO's own SQLite. Every function takes
 * `db` explicitly so it is unit-testable with a fake/broken D1.
 */

/**
 * Upsert one move into the archive. `ON CONFLICT(game_uuid, move_index) DO
 * UPDATE SET reverted = excluded.reverted` re-propagates a veto's `reverted`
 * flip on re-flush — NEVER `DO NOTHING` for that column, or D1 replay would
 * re-apply the reverted AI moves.
 */
export async function flushMove(db: D1Database, gameUuid: string, m: MoveRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO moves
         (game_uuid, move_index, turn_number, seat_index, type, payload,
          score_delta, score_after, by_ai, ai_difficulty, controlling_account_id,
          reverted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_uuid, move_index) DO UPDATE SET reverted = excluded.reverted`,
    )
    .bind(
      gameUuid,
      m.move_index,
      m.turn_number,
      m.seat_index,
      m.type,
      m.payload,
      m.score_delta,
      m.score_after,
      m.by_ai ? 1 : 0,
      m.ai_difficulty,
      m.controlling_account_id,
      m.reverted ? 1 : 0,
      m.created_at,
    )
    .run()
}

export type GameArchiveRow = {
  gameUuid: string
  mode: 'online' | 'local'
  status: string
  playerCount: number
  source: 'online_authoritative' | 'client_reported'
  engineVersion: string
  createdAt: number
  lastActivityAt: number
  code: string | null
}

/**
 * Write the per-game archive row + the per-seat `game_players` index rows at
 * creation (the lobby registry: `code` + `last_activity_at`). `ON CONFLICT DO
 * UPDATE SET last_activity_at` keeps a re-init idempotent without clobbering an
 * in-progress game's status/outcome.
 */
export async function flushGameCreate(db: D1Database, game: GameArchiveRow, seats: SeatRow[]): Promise<void> {
  await db
    .prepare(
      `INSERT INTO games
         (game_uuid, mode, status, player_count, source, engine_version,
          created_at, last_activity_at, code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_uuid) DO UPDATE SET last_activity_at = excluded.last_activity_at`,
    )
    .bind(
      game.gameUuid,
      game.mode,
      game.status,
      game.playerCount,
      game.source,
      game.engineVersion,
      game.createdAt,
      game.lastActivityAt,
      game.code,
    )
    .run()

  const stmts = seats.map((s) =>
    db
      .prepare(
        `INSERT INTO game_players
           (game_uuid, seat_index, account_id, ghost_id, owner_type, display_name, final_score)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_uuid, seat_index) DO NOTHING`,
      )
      .bind(game.gameUuid, s.seat_index, s.owner_account_id, s.ghost_id, s.owner_type, s.display_name, s.final_score),
  )
  if (stmts.length) await db.batch(stmts)
}

export type GameEnd = {
  status: string
  outcome: string
  winnerSeat: number | null
  endedAt: number
  lastActivityAt: number
  finalScores: number[]
}

/** Finalize the archive game row (status/outcome/winner/ended) + per-seat scores. */
export async function flushGameEnd(db: D1Database, gameUuid: string, end: GameEnd): Promise<void> {
  await db
    .prepare(
      `UPDATE games
         SET status = ?, outcome = ?, winner_seat = ?, ended_at = ?, last_activity_at = ?
       WHERE game_uuid = ?`,
    )
    .bind(end.status, end.outcome, end.winnerSeat, end.endedAt, end.lastActivityAt, gameUuid)
    .run()

  const stmts = end.finalScores.map((score, seat) =>
    db.prepare(`UPDATE game_players SET final_score = ? WHERE game_uuid = ? AND seat_index = ?`).bind(score, gameUuid, seat),
  )
  if (stmts.length) await db.batch(stmts)
}

/** Touch the lobby-registry activity timestamp (keeps the cron sweep honest). */
export async function touchActivity(db: D1Database, gameUuid: string, ts: number): Promise<void> {
  await db.prepare(`UPDATE games SET last_activity_at = ? WHERE game_uuid = ?`).bind(ts, gameUuid).run()
}

/**
 * Resolve a room code to its live game_uuid via the lobby registry (there is no
 * API to enumerate DOs, and a room code != gameId). Only non-terminal games are
 * joinable.
 */
export async function resolveActiveGameByCode(db: D1Database, code: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT game_uuid FROM games
       WHERE code = ? AND status IN ('waiting','active')
       ORDER BY last_activity_at DESC LIMIT 1`,
    )
    .bind(code)
    .first<{ game_uuid: string }>()
  return row?.game_uuid ?? null
}

/** argmax of a score vector (first max on ties), or null when empty. */
export function winnerSeatOf(scores: number[]): number | null {
  if (scores.length === 0) return null
  let best = 0
  for (let i = 1; i < scores.length; i++) if ((scores[i] ?? 0) > (scores[best] ?? 0)) best = i
  return best
}
