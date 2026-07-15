import { describe, it, expect } from 'vitest'
import { longestWinStreak } from '../src/stats/streak'

/**
 * Pure helper shared by GET /leaderboard's streak-friends board and
 * GET /me/stats's vsFriends.streak (Tasks 9/10) — longest run of consecutive
 * 'win' results in a caller-ordered (by ended_at) result sequence.
 */
describe('longestWinStreak', () => {
  it('is 0 for an empty sequence', () => {
    expect(longestWinStreak([])).toBe(0)
  })

  it('is 0 when there are no wins', () => {
    expect(longestWinStreak(['loss', 'draw', 'loss'])).toBe(0)
  })

  it('is the full length when every game is a win', () => {
    expect(longestWinStreak(['win', 'win', 'win'])).toBe(3)
  })

  it('finds the longest run, not the trailing or first run', () => {
    // runs: [win,win](2), [win,win,win](3) -> longest is 3, not the trailing
    // run and not simply the first run.
    expect(longestWinStreak(['win', 'win', 'loss', 'win', 'win', 'win'])).toBe(3)
  })

  it('a draw breaks a streak just like a loss', () => {
    expect(longestWinStreak(['win', 'win', 'win', 'draw', 'win', 'win'])).toBe(3)
  })

  it('a single win among losses is a streak of 1', () => {
    expect(longestWinStreak(['loss', 'win', 'loss'])).toBe(1)
  })
})
