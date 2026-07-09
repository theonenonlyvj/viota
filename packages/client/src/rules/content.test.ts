import { describe, it, expect } from 'vitest'
import { score, posKey } from '@viota/engine'
import type { Card, Grid, RegularCard } from '@viota/engine'
import { RULES_SECTIONS, QUICK_REF } from './content'

const R = (color: any, shape: any, number: any): RegularCard => ({ kind: 'regular', color, shape, number })
function setAll(g: Grid, entries: [number, number, Card][]) { for (const [x, y, c] of entries) g.set(posKey({ x, y }), c) }
function totalFor(cumulative: [number, number, Card][], newPos: [number, number][], cards: number) {
  const g: Grid = new Map(); setAll(g, cumulative)
  return score(g, newPos.map(([x, y]) => ({ x, y })), { cardsPlayedThisTurn: cards }).total
}

describe('rules content', () => {
  it('exposes sections and a non-empty quick-ref subset', () => {
    expect(RULES_SECTIONS.length).toBeGreaterThan(3)
    expect(QUICK_REF.length).toBeGreaterThan(0)
    expect(QUICK_REF.every(s => RULES_SECTIONS.includes(s))).toBe(true)
  })

  // The rulebook "Play Example" (typo-corrected: (3,1)=[B,c,4]) must reproduce 6, 6, 34, 208.
  it('rulebook worked example scores 6 / 6 / 34 / 208 via the engine', () => {
    const t0: [number, number, Card][] = [[1, 3, R('red', 'triangle', 2)]]
    const t1 = [...t0, [2, 3, R('blue', 'plus', 2)], [3, 3, R('green', 'circle', 2)]] as [number, number, Card][]
    expect(totalFor(t1, [[2, 3], [3, 3]], 2)).toBe(6)

    const t2 = [...t1, [3, 4, R('red', 'circle', 3)], [3, 2, R('yellow', 'circle', 1)]] as [number, number, Card][]
    expect(totalFor(t2, [[3, 4], [3, 2]], 2)).toBe(6)

    const t3 = [...t2, [4, 3, R('yellow', 'square', 2)], [4, 2, R('green', 'triangle', 3)]] as [number, number, Card][]
    expect(totalFor(t3, [[4, 3], [4, 2]], 2)).toBe(34)

    const t4 = [...t3,
      [1, 1, R('green', 'triangle', 2)], [2, 1, R('yellow', 'square', 3)],
      [3, 1, R('blue', 'circle', 4)], [4, 1, R('red', 'plus', 1)],
    ] as [number, number, Card][]
    expect(totalFor(t4, [[1, 1], [2, 1], [3, 1], [4, 1]], 4)).toBe(208)
  })
})
