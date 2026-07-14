import { computeSeatStats, type StatMove } from './computeSeatStats'
import { opponentKindFor } from './opponentKind'

/**
 * The exact per-human-seat derivation `flushGameEnd` (src/do/archive.ts)
 * writes at LIVE game-end — extracted so `backfillStats` (Task 6, Phase 3)
 * computes IDENTICAL result/opponent_kind/stats/total_moves/ai_move_count for
 * HISTORICAL games without a second, drifting copy of this logic. Pure (no D1
 * access); both callers own their own I/O.
 */

export type ArchiveSeatRow = { seat_index: number; owner_type: string }
export type ArchiveMoveRow = StatMove & { by_ai: boolean | number }

export type SeatArchiveFields = {
  result: 'win' | 'loss' | 'draw'
  opponentKind: 'human' | 'ai'
  stats: string
  totalMoves: number
  aiMoveCount: number
}

/** `gameStart` proxies off the earliest move's `created_at` (never an extra
 *  D1 round-trip to read `games.created_at`) — falls back to `gameEnd` when
 *  the game has no moves. A `Math.min` over `created_at` rather than
 *  `moves[0]` so it's correct even when the log isn't already sorted. */
export function gameStartOf(moves: { created_at: number }[], gameEnd: number): number {
  return moves.length ? Math.min(...moves.map((m) => m.created_at)) : gameEnd
}

/**
 * Derive one human seat's `result` (win/draw/loss from `winnerSeat`),
 * `opponentKind`, `stats` JSON blob, and move counts — from the game's full
 * seat list + non-reverted move log. Caller is responsible for only invoking
 * this for HUMAN-owned seats (AI seats never get these fields, live or
 * backfilled).
 */
export function deriveSeatArchiveFields(
  seats: ArchiveSeatRow[],
  moves: ArchiveMoveRow[],
  seat: number,
  finalScore: number,
  winnerSeat: number | null,
  gameStart: number,
  gameEnd: number,
): SeatArchiveFields {
  const result = seat === winnerSeat ? 'win' : winnerSeat === null ? 'draw' : 'loss'
  const opponentKind = opponentKindFor(seats, seat)
  const stats = JSON.stringify(computeSeatStats(moves, seat, finalScore, gameStart, gameEnd))
  const mine = moves.filter((m) => m.seat_index === seat)
  const totalMoves = mine.length
  const aiMoveCount = mine.filter((m) => m.by_ai).length
  return { result, opponentKind, stats, totalMoves, aiMoveCount }
}
