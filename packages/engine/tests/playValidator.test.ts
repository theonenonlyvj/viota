import { describe, it, expect } from 'vitest'
import { validatePlay } from '../src/playValidator'
import type { Grid, Card, Placement } from '../src/types'

const R = (color: string, shape: string, n: number): Card =>
  ({ kind: 'regular', color: color as any, shape: shape as any, number: n as any })

function makeGrid(entries: [number, number, Card][]): Grid {
  const g: Grid = new Map()
  for (const [x, y, c] of entries) g.set(`${x},${y}`, c)
  return g
}

describe('validatePlay', () => {
  it('rejects empty placement', () => {
    const grid = makeGrid([[0, 0, R('red','circle',1)]])
    expect(validatePlay(grid, []).valid).toBe(false)
  })

  it('rejects placement with more than 4 cards', () => {
    const grid = makeGrid([[0, 0, R('red','circle',1)]])
    const pl: Placement[] = [1,2,3,4,5].map(x => ({ card: R('blue','triangle',2), position: { x, y: 0 } }))
    expect(validatePlay(grid, pl).valid).toBe(false)
  })

  it('rejects cards not in a single row or column', () => {
    const grid = makeGrid([[0, 0, R('red','circle',1)]])
    const pl: Placement[] = [
      { card: R('blue','triangle',2), position: { x: 1, y: 0 } },
      { card: R('green','square',3), position: { x: 0, y: 1 } },
    ]
    expect(validatePlay(grid, pl).valid).toBe(false)
  })

  it('rejects placement with gap', () => {
    const grid = makeGrid([[0, 0, R('red','circle',1)]])
    const pl: Placement[] = [
      { card: R('blue','triangle',2), position: { x: 1, y: 0 } },
      { card: R('green','square',3), position: { x: 3, y: 0 } }, // gap at x=2
    ]
    expect(validatePlay(grid, pl).valid).toBe(false)
  })

  it('rejects placement not adjacent to grid', () => {
    const grid = makeGrid([[0, 0, R('red','circle',1)]])
    const pl: Placement[] = [
      { card: R('blue','triangle',2), position: { x: 5, y: 5 } },
    ]
    expect(validatePlay(grid, pl).valid).toBe(false)
  })

  it('accepts valid single card adjacent to grid', () => {
    const grid = makeGrid([[0, 0, R('red','circle',1)]])
    const pl: Placement[] = [
      { card: R('blue','circle',2), position: { x: 1, y: 0 } },
    ]
    expect(validatePlay(grid, pl).valid).toBe(true)
  })

  it('accepts extending a line at both ends', () => {
    // existing: [red circle 2] at (1,0), [blue circle 3] at (2,0)
    // play: [yellow circle 1] at (0,0) and [green circle 4] at (3,0)
    // Result: all-diff colors, all-same shape, all-diff numbers → valid lot
    const grid = makeGrid([
      [1, 0, R('red','circle',2)],
      [2, 0, R('blue','circle',3)],
    ])
    const pl: Placement[] = [
      { card: R('yellow','circle',1), position: { x: 0, y: 0 } },
      { card: R('green','circle',4), position: { x: 3, y: 0 } },
    ]
    expect(validatePlay(grid, pl).valid).toBe(true)
  })

  it('rejects invalid line formed by placement', () => {
    // existing: [red circle 1] at (0,0), [red circle 2] at (1,0)
    // play: [blue circle 2] at (2,0) — colors: red/red/blue → not all-same, not all-diff
    const grid = makeGrid([
      [0, 0, R('red','circle',1)],
      [1, 0, R('red','circle',2)],
    ])
    const pl: Placement[] = [
      { card: R('blue','circle',2), position: { x: 2, y: 0 } },
    ]
    expect(validatePlay(grid, pl).valid).toBe(false)
  })

  it('validates cross lines created by placement', () => {
    // board: (0,0)=red circle 1, (1,0)=blue circle 2
    // play: (1,1) = blue triangle 3
    // row at y=1: just 1 card → no line to validate
    // col at x=1: (1,0) blue circle 2 + (1,1) blue triangle 3 → valid 2-card line
    const grid = makeGrid([
      [0, 0, R('red','circle',1)],
      [1, 0, R('blue','circle',2)],
    ])
    const pl: Placement[] = [
      { card: R('blue','triangle',3), position: { x: 1, y: 1 } },
    ]
    expect(validatePlay(grid, pl).valid).toBe(true)
  })

  it('rejects placement on occupied cell', () => {
    const grid = makeGrid([[0, 0, R('red','circle',1)]])
    const pl: Placement[] = [
      { card: R('blue','triangle',2), position: { x: 0, y: 0 } },
    ]
    expect(validatePlay(grid, pl).valid).toBe(false)
  })

  it('first move: accepts single card on empty grid (starter card placement)', () => {
    const grid: Grid = new Map()
    const pl: Placement[] = [
      { card: R('red','circle',1), position: { x: 0, y: 0 } },
    ]
    expect(validatePlay(grid, pl).valid).toBe(true)
  })

  it('rejects Wild at row/col intersection when no jointly-consistent assignment exists', () => {
    // Row: (0,0)=red-circle-2, (1,0)=red-circle-3, (2,0)=red-circle-4 → Wild at (3,0) must be red-circle-1
    // Col: (3,1)=blue-circle-2, (3,2)=blue-circle-3, (3,3)=blue-circle-4 → Wild at (3,0) must be blue-circle-1
    // Wild can't be both red-circle-1 AND blue-circle-1 (different colors) → invalid
    const gridWithout = makeGrid([
      [0, 0, R('red','circle',2)],
      [1, 0, R('red','circle',3)],
      [2, 0, R('red','circle',4)],
      [3, 1, R('blue','circle',2)],
      [3, 2, R('blue','circle',3)],
      [3, 3, R('blue','circle',4)],
    ])
    const pl: Placement[] = [
      { card: { kind: 'wild' }, position: { x: 3, y: 0 } },
    ]
    // Row forced: red-circle-1; Col forced: blue-circle-1; contradiction → invalid
    expect(validatePlay(gridWithout, pl).valid).toBe(false)
  })

  it('accepts Wild at row/col intersection when a jointly-consistent assignment exists', () => {
    // Row: (0,0)=red-circle-2, (1,0)=blue-circle-3, (2,0)=green-circle-4
    // Wild at (3,0) → row needs yellow-circle-1
    // Col: (3,1)=red-plus-2 → just a 2-card col segment, any 2 cards valid
    // yellow-circle-1 also satisfies the col → valid
    const gridSetup = makeGrid([
      [0, 0, R('red','circle',2)],
      [1, 0, R('blue','circle',3)],
      [2, 0, R('green','circle',4)],
      [3, 1, R('red','plus',2)],
    ])
    const pl: Placement[] = [
      { card: { kind: 'wild' }, position: { x: 3, y: 0 } },
    ]
    expect(validatePlay(gridSetup, pl).valid).toBe(true)
  })
})
