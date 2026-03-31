import { describe, it, expect } from 'vitest'
import { validateWildRecycle } from '../src/wildRecycle'
import type { Grid, Card } from '../src/types'

const R = (color: string, shape: string, n: number): Card =>
  ({ kind: 'regular', color: color as any, shape: shape as any, number: n as any })
const W = (): Card => ({ kind: 'wild' })

function makeGrid(entries: [number, number, Card][]): Grid {
  const g: Grid = new Map()
  for (const [x, y, c] of entries) g.set(`${x},${y}`, c)
  return g
}

describe('validateWildRecycle', () => {
  it('returns false if position has no wild', () => {
    const grid = makeGrid([[0, 0, R('red','circle',1)]])
    expect(validateWildRecycle(grid, { x: 0, y: 0 }, R('blue','triangle',2))).toBe(false)
  })

  it('returns false if position not on grid', () => {
    const grid = makeGrid([[0, 0, R('red','circle',1)]])
    expect(validateWildRecycle(grid, { x: 5, y: 5 }, R('blue','triangle',2))).toBe(false)
  })

  it('allows valid swap when replacement fits all lines', () => {
    // wild at (1,0), neighbors: (0,0)=red circle 1, (2,0)=blue circle 3
    // replacing with yellow circle 2: colors all-diff, shapes all-same, numbers all-diff → valid
    const grid = makeGrid([
      [0, 0, R('red','circle',1)],
      [1, 0, W()],
      [2, 0, R('blue','circle',3)],
    ])
    expect(validateWildRecycle(grid, { x: 1, y: 0 }, R('yellow','circle',2))).toBe(true)
  })

  it('rejects swap when replacement breaks a line', () => {
    // wild at (1,0), neighbors: (0,0)=red circle 1, (2,0)=red circle 2
    // colors all-same → replacement must be red
    // replacing with blue circle 3 → colors: red/blue/red → invalid
    const grid = makeGrid([
      [0, 0, R('red','circle',1)],
      [1, 0, W()],
      [2, 0, R('red','circle',2)],
    ])
    expect(validateWildRecycle(grid, { x: 1, y: 0 }, R('blue','circle',3))).toBe(false)
  })

  it('allows swap when wild has no line partners (isolated)', () => {
    // wild alone at (0,0), no neighbors — no lines to violate
    const grid = makeGrid([[0, 0, W()]])
    expect(validateWildRecycle(grid, { x: 0, y: 0 }, R('red','circle',1))).toBe(true)
  })
})
