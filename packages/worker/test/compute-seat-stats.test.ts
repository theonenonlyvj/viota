import { describe, it, expect } from 'vitest'
import { computeSeatStats, type StatMove } from '../src/stats/computeSeatStats'

/**
 * Pure derivation from the move log (NO engine replay) — see
 * docs/superpowers/specs/2026-07-14-viota-stats-leaderboards-design.md §4.
 */
describe('computeSeatStats', () => {
  it('derives points/bestPlay/plays/passes/cardsPlayed/moves/durationMs for one seat from its move log', () => {
    const moves: StatMove[] = [
      {
        seat_index: 0,
        type: 'play',
        payload: JSON.stringify({ type: 'play', placements: [{ card: { kind: 'wild' }, position: { x: 0, y: 0 } }] }),
        score_delta: 8,
        created_at: 1_000,
      },
      // A different seat's move must never leak into seat 0's stats.
      {
        seat_index: 1,
        type: 'play',
        payload: JSON.stringify({ type: 'play', placements: [{ card: { kind: 'wild' }, position: { x: 5, y: 5 } }] }),
        score_delta: 99,
        created_at: 1_200,
      },
      {
        seat_index: 0,
        type: 'pass',
        payload: JSON.stringify({ type: 'pass', trades: [], tradeOrder: [] }),
        score_delta: 0,
        created_at: 1_500,
      },
      {
        seat_index: 0,
        type: 'play',
        payload: JSON.stringify({
          type: 'play',
          placements: [
            { card: { kind: 'wild' }, position: { x: 1, y: 0 } },
            { card: { kind: 'wild' }, position: { x: 2, y: 0 } },
          ],
        }),
        score_delta: 20,
        created_at: 2_000,
      },
    ]

    const stats = computeSeatStats(moves, 0, 28, 500, 3_000)

    expect(stats).toEqual({
      points: 28,
      bestPlay: 20,
      plays: 2,
      passes: 1,
      wildsRecycled: 0,
      cardsPlayed: 3, // 1 (first play) + 2 (second play)
      moves: 3, // seat 0's own moves only (the seat-1 play is excluded)
      durationMs: 2_500, // gameEnd(3000) - gameStart(500)
    })
  })

  it('bestPlay is 0 when the seat has no play moves', () => {
    const moves: StatMove[] = [
      { seat_index: 0, type: 'pass', payload: JSON.stringify({ type: 'pass', trades: [], tradeOrder: [] }), score_delta: 0, created_at: 1_000 },
    ]

    const stats = computeSeatStats(moves, 0, 0, 0, 500)

    expect(stats.bestPlay).toBe(0)
    expect(stats.cardsPlayed).toBe(0)
    expect(stats.plays).toBe(0)
  })

  it('counts wild_recycle moves separately from plays/passes', () => {
    const moves: StatMove[] = [
      {
        seat_index: 0,
        type: 'wild_recycle',
        payload: JSON.stringify({ type: 'wild_recycle', wildPosition: { x: 0, y: 0 }, replacement: { kind: 'regular', color: 'red', shape: 'triangle', number: 4 } }),
        score_delta: 0,
        created_at: 1_000,
      },
    ]

    const stats = computeSeatStats(moves, 0, 0, 0, 100)

    expect(stats.wildsRecycled).toBe(1)
    expect(stats.moves).toBe(1)
  })

  it('skips a malformed play payload when summing cardsPlayed, without throwing', () => {
    const moves: StatMove[] = [
      { seat_index: 0, type: 'play', payload: 'not json', score_delta: 5, created_at: 1_000 },
      {
        seat_index: 0,
        type: 'play',
        payload: JSON.stringify({ type: 'play', placements: [{ card: { kind: 'wild' }, position: { x: 0, y: 0 } }] }),
        score_delta: 12,
        created_at: 1_500,
      },
    ]

    expect(() => computeSeatStats(moves, 0, 17, 0, 2_000)).not.toThrow()
    const stats = computeSeatStats(moves, 0, 17, 0, 2_000)
    expect(stats.cardsPlayed).toBe(1) // the malformed-payload move contributes 0, not a throw
    expect(stats.bestPlay).toBe(12) // still the max score_delta across BOTH play moves
    expect(stats.plays).toBe(2)
  })
})
