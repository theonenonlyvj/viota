/**
 * SQL fragment guarding stats reads against a human seat that the AI covered
 * and won FOR while the owner was away (`ai_move_count*2 > total_moves` — the
 * AI played the majority of that seat's moves). Mirrors the P1 cosmetic
 * views' guard exactly (`v_leaderboard`/`v_leaderboard_all`, schema/d1.sql)
 * so leaderboard.ts / me-stats.ts and those views can never drift apart.
 * `total_moves = 0` (no move-count data recorded) passes through — nothing
 * to guard against.
 *
 * Assumes the query aliases `game_players` as `gp`; adjust the alias inline
 * at the call site if a query ever needs a different one.
 */
export const AI_TAKEOVER_GUARD = `(gp.total_moves = 0 OR gp.ai_move_count * 2 <= gp.total_moves)`
