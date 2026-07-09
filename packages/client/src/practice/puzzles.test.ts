import { describe, it, expect } from 'vitest'
import { posKey, fromKey, getMaximalSegments, isValidLine } from '@viota/engine'
import type { Card, Grid, RegularCard } from '@viota/engine'
import { PUZZLES } from './puzzles'
import { bestPlays, CONCEPT_CHECKS, enumerateLegalPlays } from './solver'
import { bruteForceBest } from './oracle'

function gridOf(p: { grid: [string, Card][] }): Grid { return new Map(p.grid) }

// Re-derive the full legal-play set (placements only, not just the top-scoring
// subset that bestPlays returns) via the same enumerator used elsewhere, so the
// concept-check gate below can search every legal option, not only the winners.
function allLegalPlaysForConceptCheck(grid: Grid, hand: Card[]) {
  return enumerateLegalPlays(grid, hand).map(sp => sp.placements)
}

describe('PUZZLES data integrity', () => {
  it('has a non-empty set with unique ids', () => {
    expect(PUZZLES.length).toBeGreaterThanOrEqual(8)
    expect(new Set(PUZZLES.map(p => p.id)).size).toBe(PUZZLES.length)
  })

  it.each(PUZZLES.map(p => [p.id, p] as const))('%s: board is a legal Iota position', (_id, p) => {
    const grid = gridOf(p.position)
    // <= 2 wilds
    const wilds = [...grid.values()].filter(c => c.kind === 'wild').length
    expect(wilds).toBeLessThanOrEqual(2)
    // no duplicate regular cards
    const regKeys = [...grid.values()].filter(c => c.kind === 'regular').map(c => `${(c as RegularCard).color}-${(c as RegularCard).shape}-${(c as RegularCard).number}`)
    expect(new Set(regKeys).size).toBe(regKeys.length)
    // every maximal segment (len>=2) is a valid line
    for (const key of grid.keys()) {
      for (const seg of getMaximalSegments(grid, fromKey(key))) {
        if (seg.length >= 2) {
          const cards = seg.map(pos => grid.get(posKey(pos))!).filter(c => c.kind === 'regular') as RegularCard[]
          // wild-containing segments are validated by the engine elsewhere; check pure-regular lines here
          if (cards.length === seg.length) expect(isValidLine(cards)).toBe(true)
        }
      }
    }
  })

  it.each(PUZZLES.filter(p => p.answerKind === 'play').map(p => [p.id, p] as const))(
    '%s (play): has at least one legal play', (_id, p) => {
      expect(bestPlays(gridOf(p.position), p.position.hand).length).toBeGreaterThan(0)
    })

  it.each(PUZZLES.filter(p => p.mode === 'top-score').map(p => [p.id, p] as const))(
    '%s (top-score): solver max equals independent oracle', (_id, p) => {
      const grid = gridOf(p.position)
      const solverMax = bestPlays(grid, p.position.hand).reduce((m, x) => Math.max(m, x.total), 0)
      expect(solverMax).toBe(bruteForceBest(grid, p.position.hand))
    })

  it.each(PUZZLES.filter(p => p.mode === 'concept' && p.answerKind === 'play').map(p => [p.id, p] as const))(
    '%s (concept): at least one legal play satisfies its conceptCheck', (_id, p) => {
      const grid = gridOf(p.position)
      const check = CONCEPT_CHECKS[p.conceptCheck!]
      expect(p.conceptCheck).toBeDefined()
      expect(typeof check).toBe('function')
      // Real gate (not a presence-only check): at least one legal play in this
      // position must actually satisfy the predicate, checked against ALL legal
      // plays — not just the top-scoring ones, since a concept puzzle's answer
      // is frequently not the highest-scoring play.
      const legalPlays = allLegalPlaysForConceptCheck(grid, p.position.hand)
      const some = legalPlays.some(pl => check(grid, pl))
      expect(some).toBe(true)
    })

  it.each(PUZZLES.filter(p => p.answerKind === 'forced-pass').map(p => [p.id, p] as const))(
    '%s (forced-pass): the board has NO legal play', (_id, p) => {
      expect(bestPlays(gridOf(p.position), p.position.hand).length).toBe(0)
    })
})
