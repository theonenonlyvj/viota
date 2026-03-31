import { describe, it, expect } from 'vitest'
import { score } from '../src/scorer'
import type { Grid, Card, Position } from '../src/types'

const R = (n: number): Card => ({ kind: 'regular', color: 'red', shape: 'circle', number: n as any })
const W = (): Card => ({ kind: 'wild' })

function makeGrid(entries: [number, number, Card][]): Grid {
  const g: Grid = new Map()
  for (const [x, y, c] of entries) g.set(`${x},${y}`, c)
  return g
}

describe('score', () => {
  it('single new card extending a 2-card line scores sum', () => {
    // existing: (0,0)=R(1). play (1,0)=R(2). Line: [1,2] = 3 pts, no multipliers
    const grid = makeGrid([[0, 0, R(1)], [1, 0, R(2)]])
    const result = score(grid, [{ x: 1, y: 0 }])
    expect(result.total).toBe(3)
    expect(result.multiplier).toBe(1)
  })

  it('card in two lines is counted twice', () => {
    // board: (0,0)=R(1), (2,0)=R(2), (1,1)=R(4), (1,0)=R(3)
    // play: (1,0) — row-line [R(1),R(3),R(2)] = 6, col-line [R(3),R(4)] = 7; total = 13
    const grid = makeGrid([[0,0,R(1)],[2,0,R(2)],[1,1,R(4)],[1,0,R(3)]])
    const result = score(grid, [{ x:1, y:0 }])
    expect(result.total).toBe(13)
    expect(result.base).toBe(13)
    expect(result.multiplier).toBe(1)
  })

  it('lot doubles score', () => {
    // 4-card line: values 1,2,3,4 = sum 10, lot ×2, 4 cards played ×2 → total 40
    const grid = makeGrid([
      [0,0,R(1)],[1,0,R(2)],[2,0,R(3)],[3,0,R(4)]
    ])
    const result = score(grid, [{ x:0,y:0 },{ x:1,y:0 },{ x:2,y:0 },{ x:3,y:0 }])
    expect(result.base).toBe(10)
    expect(result.multiplier).toBe(4)
    expect(result.total).toBe(40)
  })

  it('wilds contribute 0 to score', () => {
    const grid = makeGrid([[0,0,W()],[1,0,R(3)]])
    const result = score(grid, [{ x:1, y:0 }])
    // line: [wild(0), R(3)] = 0+3 = 3
    expect(result.total).toBe(3)
  })

  it('playing all 4 cards doubles', () => {
    const grid = makeGrid([
      [0,0,R(1)],[1,0,R(2)],[2,0,R(3)],[3,0,R(4)]
    ])
    const result = score(grid, [{ x:0,y:0 },{ x:1,y:0 },{ x:2,y:0 },{ x:3,y:0 }])
    // Playing 4 cards → ×2 (on top of lot ×2) → multiplier = 4
    expect(result.multiplier).toBe(4)
  })

  it('game-ending bonus doubles', () => {
    const grid = makeGrid([[0,0,R(1)],[1,0,R(2)]])
    const result = score(grid, [{ x:1, y:0 }], { gameEnding: true })
    expect(result.multiplier).toBe(2)
    expect(result.total).toBe(6)
  })
})
