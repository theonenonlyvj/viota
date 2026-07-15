/**
 * Classifies a seat's opponents as 'human' or 'ai' — stored on
 * `game_players.opponent_kind` at game-end so leaderboard boards can filter
 * vs-Friends vs vs-AI cheaply without re-deriving per query. See
 * docs/superpowers/specs/2026-07-14-viota-stats-leaderboards-design.md §3.
 */

/** 'human' iff any seat OTHER than `seat` is human-owned, else 'ai'. */
export function opponentKindFor(seats: { seat_index: number; owner_type: string }[], seat: number): 'human' | 'ai' {
  return seats.some((s) => s.seat_index !== seat && s.owner_type === 'human') ? 'human' : 'ai'
}
