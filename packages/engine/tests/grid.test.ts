import { describe, it, expect } from 'vitest'
import { posKey, fromKey, getSegment, getMaximalSegments } from '../src/grid'
import type { Grid } from '../src/types'

const R = (n: number) => ({ kind: 'regular' as const, color: 'red' as const, shape: 'circle' as const, number: n as 1|2|3|4 })

describe('posKey / fromKey', () => {
  it('round-trips', () => {
    expect(fromKey(posKey({ x: 3, y: -2 }))).toEqual({ x: 3, y: -2 })
    expect(fromKey(posKey({ x: 0, y: 0 }))).toEqual({ x: 0, y: 0 })
  })
})

describe('getSegment', () => {
  it('returns contiguous run in a row', () => {
    const grid: Grid = new Map([
      ['0,0', R(1)], ['1,0', R(2)], ['2,0', R(3)],
    ])
    const seg = getSegment(grid, { x: 1, y: 0 }, 'row')
    expect(seg.map(p => p.x).sort()).toEqual([0, 1, 2])
  })

  it('returns only connected cells — no gap', () => {
    const grid: Grid = new Map([
      ['0,0', R(1)], ['2,0', R(2)], // gap at x=1
    ])
    const seg = getSegment(grid, { x: 0, y: 0 }, 'row')
    expect(seg).toHaveLength(1)
  })

  it('returns single card if no neighbors', () => {
    const grid: Grid = new Map([['5,5', R(1)]])
    expect(getSegment(grid, { x: 5, y: 5 }, 'row')).toHaveLength(1)
  })
})

describe('getMaximalSegments', () => {
  it('finds row and column segments through a position', () => {
    const grid: Grid = new Map([
      ['0,0', R(1)], ['1,0', R(2)], ['2,0', R(3)],
      ['1,1', R(4)], ['1,-1', R(1)],
    ])
    const segs = getMaximalSegments(grid, { x: 1, y: 0 })
    expect(segs).toHaveLength(2)
    const lengths = segs.map(s => s.length).sort()
    expect(lengths).toEqual([3, 3])
  })

  it('returns only segments of length >= 2', () => {
    const grid: Grid = new Map([['0,0', R(1)]])
    const segs = getMaximalSegments(grid, { x: 0, y: 0 })
    expect(segs).toHaveLength(0)
  })
})
