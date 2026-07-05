import type { Grid, Placement, PlayResult } from './types'
import { posKey, getSegment } from './grid'
import { wildLinesConsistent } from './lineValidator'

export function validatePlay(grid: Grid, placements: Placement[]): PlayResult {
  if (placements.length === 0) return { valid: false, error: 'Must place at least 1 card' }
  if (placements.length > 4) return { valid: false, error: 'Cannot place more than 4 cards' }

  // Special case: first card on empty board
  if (grid.size === 0 && placements.length === 1) return { valid: true }

  // Check for occupied cells
  for (const { position } of placements) {
    if (grid.has(posKey(position))) return { valid: false, error: `Cell ${posKey(position)} is already occupied` }
  }

  // Check for duplicate positions in placements
  const keys = placements.map(p => posKey(p.position))
  if (new Set(keys).size !== keys.length) return { valid: false, error: 'Duplicate positions in placement' }

  // All cards must share the same row or column
  const xs = placements.map(p => p.position.x)
  const ys = placements.map(p => p.position.y)
  const sameRow = new Set(ys).size === 1
  const sameCol = new Set(xs).size === 1
  if (!sameRow && !sameCol) return { valid: false, error: 'All cards must be in the same row or column' }

  // Build tentative grid
  const tentative: Grid = new Map(grid)
  for (const { card, position } of placements) tentative.set(posKey(position), card)

  // Check contiguity in the play axis
  const axis: 'row' | 'col' = sameRow ? 'row' : 'col'
  const anyPos = placements[0]!.position
  const segment = getSegment(tentative, anyPos, axis)
  // Every played position must be within this segment
  for (const { position } of placements) {
    if (!segment.some(p => p.x === position.x && p.y === position.y))
      return { valid: false, error: 'Placement creates a gap' }
  }

  // At least one played card must be adjacent to an existing (pre-play) card
  const isAdjacentToExisting = placements.some(({ position: { x, y } }) =>
    [{ x: x+1, y }, { x: x-1, y }, { x, y: y+1 }, { x, y: y-1 }].some(p => grid.has(posKey(p)))
  )
  if (!isAdjacentToExisting) return { valid: false, error: 'Must connect to existing cards' }

  // Validate every line touched by this play. wildLinesConsistent walks the
  // transitive closure of wilds connected to the played positions, so a wild
  // (or a chain of wilds) that must stay consistent across several lines is
  // solved jointly. It also enforces the max line length of 4.
  const playedPositions = placements.map(p => p.position)
  if (!wildLinesConsistent(tentative, playedPositions)) {
    return { valid: false, error: 'Invalid line or no valid Wild assignment for this placement' }
  }

  return { valid: true }
}
