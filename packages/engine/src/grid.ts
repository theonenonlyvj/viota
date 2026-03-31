import type { Grid, Position } from './types'

export function posKey(p: Position): string {
  return `${p.x},${p.y}`
}

export function fromKey(key: string): Position {
  const [x, y] = key.split(',').map(Number)
  return { x: x!, y: y! }
}

// Get the maximal contiguous run through `pos` along `axis`, including pos itself.
export function getSegment(grid: Grid, pos: Position, axis: 'row' | 'col'): Position[] {
  const fixed = axis === 'row' ? pos.y : pos.x
  const varying = axis === 'row' ? pos.x : pos.y
  const make = (v: number): Position => axis === 'row' ? { x: v, y: fixed } : { x: fixed, y: v }

  const positions: Position[] = [pos]

  // expand negative direction
  for (let v = varying - 1; grid.has(posKey(make(v))); v--) positions.unshift(make(v))
  // expand positive direction
  for (let v = varying + 1; grid.has(posKey(make(v))); v++) positions.push(make(v))

  return positions
}

// Returns row and column segments through `pos` that are length >= 2.
export function getMaximalSegments(grid: Grid, pos: Position): Position[][] {
  const row = getSegment(grid, pos, 'row')
  const col = getSegment(grid, pos, 'col')
  return [row, col].filter(s => s.length >= 2)
}
