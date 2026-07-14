import type { MoveRow, SeatRow } from './storage'
import { computeSeatStats } from '../stats/computeSeatStats'
import { opponentKindFor } from '../stats/opponentKind'

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

/**
 * Upsert per-seat `game_players` rows, UPDATING owner/name on conflict (unlike
 * the create-time `flushGameCreate` which DOes NOTHING). Used by /join (a seat
 * changed open->human) and /start (open->ai fills) so the analytics index tracks
 * the live roster. The DO SQLite copy stays authoritative regardless.
 */
export async function upsertGamePlayers(db: D1Database, gameUuid: string, seats: SeatRow[]): Promise<void> {
  const stmts = seats.map((s) =>
    db
      .prepare(
        `INSERT INTO game_players
           (game_uuid, seat_index, account_id, ghost_id, owner_type, display_name, final_score)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_uuid, seat_index) DO UPDATE SET
           account_id = excluded.account_id,
           ghost_id = excluded.ghost_id,
           owner_type = excluded.owner_type,
           display_name = excluded.display_name`,
      )
      .bind(gameUuid, s.seat_index, s.owner_account_id, s.ghost_id, s.owner_type, s.display_name, s.final_score),
  )
  if (stmts.length) await db.batch(stmts)
}

/** Flip the games registry row status (e.g. 'waiting' -> 'active' at /start). */
export async function setGameStatus(db: D1Database, gameUuid: string, status: string, ts: number): Promise<void> {
  await db.prepare(`UPDATE games SET status = ?, last_activity_at = ? WHERE game_uuid = ?`).bind(status, ts, gameUuid).run()
}

export type GameEnd = {
  status: string
  outcome: string
  winnerSeat: number | null
  endedAt: number
  lastActivityAt: number
  finalScores: number[]
  /** DO-local seat rows (owner_type), for `opponent_kind` classification +
   *  deciding which seats get a stats blob. Optional so a caller with no
   *  per-seat data (e.g. an older direct `flushGameEnd` call) still works —
   *  it just means no seat is written as 'human', so only `final_score` is
   *  updated (today's behavior, unchanged). */
  seats?: SeatRow[]
  /** The game's non-reverted move log (any seat), for `computeSeatStats`.
   *  Optional for the same backward-compat reason as `seats`. */
  moves?: MoveRow[]
}

/**
 * Finalize the archive game row (status/outcome/winner/ended) + per-seat
 * scores. For each HUMAN seat (per `end.seats`) also derives + writes
 * `result` (win/draw/loss from `winnerSeat`), `opponent_kind`, and a
 * `computeSeatStats` JSON blob from `end.moves` — the v1 stats/leaderboards
 * data (spec §3/§4). Non-human seats (or callers that omit `seats`/`moves`)
 * keep the original final_score-only update.
 */
export async function flushGameEnd(db: D1Database, gameUuid: string, end: GameEnd): Promise<void> {
  await db
    .prepare(
      `UPDATE games
         SET status = ?, outcome = ?, winner_seat = ?, ended_at = ?, last_activity_at = ?
       WHERE game_uuid = ?`,
    )
    .bind(end.status, end.outcome, end.winnerSeat, end.endedAt, end.lastActivityAt, gameUuid)
    .run()

  const seats = end.seats ?? []
  const moves = end.moves ?? []
  // gameStart proxies off the earliest archived move (no extra D1 round-trip
  // to read the games.created_at row) — a min() over `created_at` rather than
  // moves[0] to stay correct even if the log isn't already sorted.
  const gameStart = moves.length ? Math.min(...moves.map((m) => m.created_at)) : end.endedAt

  const stmts = end.finalScores.map((score, seat) => {
    const seatRow = seats.find((s) => s.seat_index === seat)
    if (seatRow && seatRow.owner_type === 'human') {
      const result = seat === end.winnerSeat ? 'win' : end.winnerSeat === null ? 'draw' : 'loss'
      const opponentKind = opponentKindFor(seats, seat)
      const stats = JSON.stringify(computeSeatStats(moves, seat, score, gameStart, end.endedAt))
      // P1 columns (must-fix #3): total_moves/ai_move_count feed v_leaderboard's
      // AI-takeover guard (`total_moves = 0 OR ai_move_count*2 <= total_moves`),
      // which is a permanent no-op unless these are actually written here.
      const mine = moves.filter((m) => m.seat_index === seat)
      const totalMoves = mine.length
      const aiMoveCount = mine.filter((m) => m.by_ai).length
      return db
        .prepare(
          `UPDATE game_players
             SET final_score = ?, result = ?, opponent_kind = ?, stats = ?, total_moves = ?, ai_move_count = ?
           WHERE game_uuid = ? AND seat_index = ?`,
        )
        .bind(score, result, opponentKind, stats, totalMoves, aiMoveCount, gameUuid, seat)
    }
    return db.prepare(`UPDATE game_players SET final_score = ? WHERE game_uuid = ? AND seat_index = ?`).bind(score, gameUuid, seat)
  })
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

export type ResumableGame = {
  game_uuid: string
  code: string | null
  status: string
  player_count: number
  last_activity_at: number
  seat_index: number
}

/**
 * The caller's RESUMABLE games (waiting or active) with the seat they own in
 * each, most-recently-active first — the `GET /my-games` "come back to it" list.
 * Joins the per-seat `game_players` index to the `games` registry on account_id.
 */
export async function listResumableGames(db: D1Database, accountId: string): Promise<ResumableGame[]> {
  const { results } = await db
    .prepare(
      `SELECT g.game_uuid, g.code, g.status, g.player_count, g.last_activity_at, gp.seat_index
       FROM game_players gp
       JOIN games g ON g.game_uuid = gp.game_uuid
       WHERE gp.account_id = ? AND g.status IN ('waiting','active')
       ORDER BY g.last_activity_at DESC`,
    )
    .bind(accountId)
    .all<ResumableGame>()
  return results
}

/** argmax of a score vector, or null when empty OR when >1 seat shares the max
 *  (a tie — CRITICAL: must archive as a draw, never pick the lowest seat index
 *  as an arbitrary winner). */
export function winnerSeatOf(scores: number[]): number | null {
  if (scores.length === 0) return null
  let best = 0
  for (let i = 1; i < scores.length; i++) if ((scores[i] ?? 0) > (scores[best] ?? 0)) best = i
  const max = scores[best] ?? 0
  return scores.filter((s) => (s ?? 0) === max).length > 1 ? null : best
}
