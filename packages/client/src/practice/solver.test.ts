import { describe, it, expect } from 'vitest'
import { posKey, validatePlay } from '@viota/engine'
import type { Card, Grid, RegularCard } from '@viota/engine'
import { enumerateLegalPlays, bestPlays, cardIdentity, playKey, CONCEPT_CHECKS, gradeUserMove } from './solver'
import type { Puzzle, UserMove } from './types'
import { bruteForceBest } from './oracle'

const R = (color: any, shape: any, number: any): RegularCard => ({ kind: 'regular', color, shape, number })
const WILD: Card = { kind: 'wild' }
function gridOf(entries: [number, number, Card][]): Grid {
  const g: Grid = new Map()
  for (const [x, y, c] of entries) g.set(posKey({ x, y }), c)
  return g
}

describe('cardIdentity / playKey', () => {
  it('regulars encode color-shape-number; wild is "wild"', () => {
    expect(cardIdentity(R('red', 'circle', 1))).toBe('red-circle-1')
    expect(cardIdentity(WILD)).toBe('wild')
  })
  it('playKey is order-insensitive', () => {
    const a = [{ card: R('red', 'circle', 1), position: { x: 1, y: 0 } }, { card: R('red', 'circle', 2), position: { x: 2, y: 0 } }]
    const b = [a[1], a[0]]
    expect(playKey(a)).toBe(playKey(b))
  })
})

describe('enumerateLegalPlays', () => {
  it('finds a single-card extension of a 1-card board', () => {
    const grid = gridOf([[0, 0, R('red', 'circle', 1)]])
    const plays = enumerateLegalPlays(grid, [R('red', 'circle', 2)])
    // one card, adjacent to (0,0), forming a valid 2-line
    expect(plays.length).toBeGreaterThan(0)
    expect(Math.max(...plays.map(p => p.total))).toBe(3) // 1 + 2
  })

  it('finds a multi-card FAR extension that completes a lot (frontier-only would miss it)', () => {
    // Row y=0 has [R,c,1] at x=0. Hand can complete a 4-card lot along the row.
    const grid = gridOf([[0, 0, R('red', 'circle', 1)]])
    const hand: Card[] = [R('red', 'circle', 2), R('red', 'circle', 3), R('red', 'circle', 4)]
    const best = bestPlays(grid, hand)
    // lot [1,2,3,4] same color+shape, all-different number => base 10, one lot => x2 = 20
    expect(best[0].total).toBe(20)
    // Several tied-max placements exist (e.g. extending left to x=-1,1,2, or further to x=-2,-1,1),
    // so assert membership rather than best[0] specifically. The far extension (x=1,2,3 — 3 cells
    // from the anchor) must be among them, proving the enumerator is not frontier-limited.
    const hasFarExtension = best.some(p => {
      const xs = p.placements.map(pl => pl.position.x).sort((a, b) => a - b)
      return xs.length === 3 && xs[0] === 1 && xs[1] === 2 && xs[2] === 3
    })
    expect(hasFarExtension).toBe(true)
  })

  it('every enumerated play is legal', () => {
    // A completed 4-card lot fills row y=0. A blue-triangle-1 can still start perpendicular
    // 2-lines off the ends, so this board has legal plays — assert the real invariant instead
    // of a vacuous Array.isArray check: the list is non-empty AND every returned play is legal
    // per the engine. (A genuinely no-legal-play board is covered by the forced-pass puzzle.)
    const grid = gridOf([
      [0, 0, R('red', 'circle', 1)], [1, 0, R('red', 'circle', 2)],
      [2, 0, R('red', 'circle', 3)], [3, 0, R('red', 'circle', 4)],
    ])
    const plays = enumerateLegalPlays(grid, [R('blue', 'triangle', 1)])
    expect(plays.length).toBeGreaterThan(0)
    for (const p of plays) {
      expect(validatePlay(grid, p.placements).valid).toBe(true)
    }
  })
})

describe('CONCEPT_CHECKS', () => {
  it('line-all-same: true when the touched line holds a property constant', () => {
    const grid = gridOf([[0, 0, R('red', 'circle', 1)]])
    const placements = [{ card: R('red', 'circle', 2), position: { x: 1, y: 0 } }]
    // row: red-circle-1, red-circle-2 => same color, same shape, different number => "all-same" on color/shape
    expect(CONCEPT_CHECKS['line-all-same'](grid, placements)).toBe(true)
  })
  it('mixed-properties: true when the line is same on one property and different on another', () => {
    const grid = gridOf([[0, 0, R('red', 'circle', 1)]])
    const placements = [{ card: R('red', 'triangle', 2), position: { x: 1, y: 0 } }]
    // same color, different shape, different number => mixed
    expect(CONCEPT_CHECKS['mixed-properties'](grid, placements)).toBe(true)
  })
  it('spans-both-ends: true when placements sit on both ends of an existing segment', () => {
    const grid = gridOf([[1, 0, R('red', 'circle', 2)], [2, 0, R('red', 'circle', 3)]])
    const placements = [
      { card: R('red', 'circle', 1), position: { x: 0, y: 0 } },
      { card: R('red', 'circle', 4), position: { x: 3, y: 0 } },
    ]
    expect(CONCEPT_CHECKS['spans-both-ends'](grid, placements)).toBe(true)
  })

  // --- positive coverage for the 4 previously-untested predicates ---

  it('any-line: true for a legal 2-card line', () => {
    const grid = gridOf([[0, 0, R('red', 'circle', 1)]])
    const placements = [{ card: R('blue', 'triangle', 2), position: { x: 1, y: 0 } }]
    expect(CONCEPT_CHECKS['any-line'](grid, placements)).toBe(true)
  })

  it('line-all-different: true when the line is all-different on every property', () => {
    const grid = gridOf([[0, 0, R('red', 'circle', 1)]])
    // red-circle-1, blue-triangle-2 => color/shape/number all differ
    const placements = [{ card: R('blue', 'triangle', 2), position: { x: 1, y: 0 } }]
    expect(CONCEPT_CHECKS['line-all-different'](grid, placements)).toBe(true)
  })

  it('creates-second-line: true when one placement forms both a row line and a column line', () => {
    // Existing row fragment (y=0, x=1..2) and column fragment (x=0, y=1..2); dropping
    // yellow-circle-1 at the corner (0,0) creates two 3-card lines through it at once.
    const grid = gridOf([
      [1, 0, R('red', 'triangle', 2)], [2, 0, R('green', 'plus', 3)],
      [0, 1, R('blue', 'circle', 2)], [0, 2, R('green', 'circle', 3)],
    ])
    const placements = [{ card: R('yellow', 'circle', 1), position: { x: 0, y: 0 } }]
    expect(validatePlay(grid, placements).valid).toBe(true)
    expect(CONCEPT_CHECKS['creates-second-line'](grid, placements)).toBe(true)
  })

  it('wild-in-two-lines: true when a wild at a crossing joins a row line and a column line', () => {
    // A horizontal neighbor and a vertical neighbor; the wild at (0,0) belongs to both segments.
    const grid = gridOf([[1, 0, R('red', 'circle', 2)], [0, 1, R('blue', 'triangle', 2)]])
    const placements = [{ card: WILD, position: { x: 0, y: 0 } }]
    expect(validatePlay(grid, placements).valid).toBe(true)
    expect(CONCEPT_CHECKS['wild-in-two-lines'](grid, placements)).toBe(true)
  })

  // --- negative coverage ---

  it('line-all-same: false for an all-different-on-every-property line', () => {
    const grid = gridOf([[0, 0, R('red', 'circle', 1)]])
    const placements = [{ card: R('blue', 'triangle', 2), position: { x: 1, y: 0 } }]
    expect(CONCEPT_CHECKS['line-all-same'](grid, placements)).toBe(false)
  })

  it('mixed-properties: false for a line that is not mixed', () => {
    // "Mixed" means same on >=1 property AND different on >=1. A line that is all-same on
    // every property is impossible with distinct cards, so the only constructible non-mixed
    // line is the all-different-on-every-property one (same-count 0) — which must return false.
    const grid = gridOf([[0, 0, R('red', 'circle', 1)]])
    const placements = [{ card: R('blue', 'triangle', 2), position: { x: 1, y: 0 } }]
    expect(CONCEPT_CHECKS['mixed-properties'](grid, placements)).toBe(false)
  })

  it('spans-both-ends: false when both placements only extend one end', () => {
    // Existing pair at x=2..3; both placements sit to the left (x=0,1), extending a single end.
    const grid = gridOf([[2, 0, R('red', 'circle', 3)], [3, 0, R('red', 'circle', 4)]])
    const placements = [
      { card: R('red', 'circle', 1), position: { x: 0, y: 0 } },
      { card: R('red', 'circle', 2), position: { x: 1, y: 0 } },
    ]
    expect(validatePlay(grid, placements).valid).toBe(true)
    expect(CONCEPT_CHECKS['spans-both-ends'](grid, placements)).toBe(false)
  })
})

const topScorePuzzle: Puzzle = {
  id: 't', title: 'lot', concept: 'complete a lot', mode: 'top-score', answerKind: 'play',
  instruction: 'Score the most.', explanation: 'the lot doubles',
  position: { grid: [[posKey({ x: 0, y: 0 }), R('red', 'circle', 1)]], hand: [R('red', 'circle', 2), R('red', 'circle', 3), R('red', 'circle', 4)] },
}

describe('gradeUserMove', () => {
  it('top-score: the optimal 3-card lot is solved', () => {
    const move: UserMove = { action: 'play', placements: [
      { card: R('red', 'circle', 2), position: { x: 1, y: 0 } },
      { card: R('red', 'circle', 3), position: { x: 2, y: 0 } },
      { card: R('red', 'circle', 4), position: { x: 3, y: 0 } },
    ] }
    const g = gradeUserMove(topScorePuzzle, move)
    expect(g.bestScore).toBe(20)
    expect(g.userScore).toBe(20)
    expect(g.solved).toBe(true)
  })
  it('top-score: a suboptimal single card is not solved', () => {
    const move: UserMove = { action: 'play', placements: [{ card: R('red', 'circle', 2), position: { x: 1, y: 0 } }] }
    const g = gradeUserMove(topScorePuzzle, move)
    expect(g.solved).toBe(false)
    expect(g.userScore).toBeLessThan(g.bestScore)
  })
})

describe('solver vs independent oracle (tiny boards)', () => {
  const boards: { grid: Grid; hand: Card[] }[] = [
    { grid: gridOf([[0, 0, R('red', 'circle', 1)]]), hand: [R('red', 'circle', 2), R('red', 'circle', 3), R('red', 'circle', 4)] },
    { grid: gridOf([[0, 0, R('blue', 'triangle', 2)], [1, 0, R('red', 'plus', 2)]]), hand: [R('green', 'circle', 2), R('yellow', 'square', 2)] },
    { grid: gridOf([[0, 0, R('red', 'circle', 1)], [0, 1, R('red', 'circle', 2)]]), hand: [R('red', 'circle', 3), WILD] },
  ]
  it.each(boards.map((b, i) => [i, b] as const))('board %i: bestPlays max equals oracle', (_i, b) => {
    const solverMax = bestPlays(b.grid, b.hand).reduce((m, p) => Math.max(m, p.total), 0)
    expect(solverMax).toBe(bruteForceBest(b.grid, b.hand))
  })

  it('perpendicular touch-then-extend: oracle covers a brand-new column off a single anchor', () => {
    // {(0,0): red-circle-1}, hand all-blue. The best play builds a fresh column at x=1
    // (which holds no pre-existing occupied cell) touching the board only at (1,0). The
    // oracle must seed that column via the anchor's touch points, not just occupied cells.
    const grid = gridOf([[0, 0, R('red', 'circle', 1)]])
    const hand: Card[] = [R('blue', 'circle', 2), R('blue', 'triangle', 3), R('blue', 'square', 4)]
    const solverMax = bestPlays(grid, hand).reduce((m, p) => Math.max(m, p.total), 0)
    const oracleMax = bruteForceBest(grid, hand)
    expect(solverMax).toBe(14)
    expect(oracleMax).toBe(14)
    expect(solverMax).toBe(oracleMax)
  })

  it('regression: far-extension lot is found (not lost to a static frontier)', () => {
    const grid = gridOf([[0, 0, R('red', 'circle', 1)]])
    const hand: Card[] = [R('red', 'circle', 2), R('red', 'circle', 3), R('red', 'circle', 4)]
    expect(bestPlays(grid, hand)[0].total).toBe(20)
    expect(bestPlays(grid, hand)[0].total).toBe(bruteForceBest(grid, hand))
  })
})
