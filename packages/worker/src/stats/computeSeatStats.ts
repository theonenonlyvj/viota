/**
 * Pure per-seat stats derivation from a game's move log — NO engine replay.
 * v1 fields only (directly derivable from the log); `lots`/`longestLine` are
 * v2 (replay-dependent) and deliberately NOT computed here. See
 * docs/superpowers/specs/2026-07-14-viota-stats-leaderboards-design.md §4.
 *
 * Worker-side module (Phase 2). Kept dependency-free/portable (no imports
 * beyond the JSON global) so it stays a plain, copyable function — NOT placed
 * in `packages/engine` (never modify the certified engine).
 */

export type SeatStats = {
  points: number
  bestPlay: number
  plays: number
  passes: number
  wildsRecycled: number
  cardsPlayed: number
  moves: number
  durationMs: number
}

/** The minimal move-log shape this function needs — a structural subset of
 *  the DO's `MoveRow` / the D1 `moves` row (either satisfies this as-is). */
export type StatMove = {
  seat_index: number
  type: 'play' | 'pass' | 'wild_recycle'
  payload: string
  score_delta: number
  created_at: number
}

/** `placements.length` from one play move's JSON payload, or 0 if the payload
 *  doesn't parse / has no placements array — an archived row must never crash
 *  stats derivation, so a malformed payload is skipped, not thrown. */
function cardsInPlay(payload: string): number {
  try {
    const parsed = JSON.parse(payload) as { placements?: unknown[] }
    return Array.isArray(parsed.placements) ? parsed.placements.length : 0
  } catch {
    return 0
  }
}

/**
 * Derive one seat's v1 stats blob directly from the move log. `finalScore`
 * comes from `games`/`game_players` (not summed from `score_delta` here, so
 * it always matches the authoritative engine score); `gameStart`/`gameEnd`
 * are wall-clock ms bounding the game.
 */
export function computeSeatStats(moves: StatMove[], seat: number, finalScore: number, gameStart: number, gameEnd: number): SeatStats {
  const mine = moves.filter((m) => m.seat_index === seat)
  const plays = mine.filter((m) => m.type === 'play')
  const passes = mine.filter((m) => m.type === 'pass')
  const wildsRecycled = mine.filter((m) => m.type === 'wild_recycle')

  const bestPlay = plays.reduce((best, m) => Math.max(best, m.score_delta), 0)
  const cardsPlayed = plays.reduce((sum, m) => sum + cardsInPlay(m.payload), 0)

  return {
    points: finalScore,
    bestPlay,
    plays: plays.length,
    passes: passes.length,
    wildsRecycled: wildsRecycled.length,
    cardsPlayed,
    moves: mine.length,
    durationMs: gameEnd - gameStart,
  }
}
