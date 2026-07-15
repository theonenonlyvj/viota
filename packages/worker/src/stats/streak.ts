/**
 * Longest run of consecutive `'win'` results in a caller-ordered sequence
 * (the leaderboard/me-stats callers order by `games.ended_at` ASC before
 * calling this — it's deliberately order-agnostic itself, just a max-run
 * scan, so it's trivial to unit test independent of any SQL/date concerns).
 * A `'loss'` OR a `'draw'` both break the streak — only `'win'` continues it.
 */
export function longestWinStreak(results: ReadonlyArray<'win' | 'loss' | 'draw'>): number {
  let longest = 0
  let current = 0
  for (const r of results) {
    current = r === 'win' ? current + 1 : 0
    if (current > longest) longest = current
  }
  return longest
}
