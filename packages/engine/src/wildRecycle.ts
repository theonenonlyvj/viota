import type { Grid, Position, RegularCard } from './types'
import { posKey, getMaximalSegments } from './grid'
import { isValidLine } from './lineValidator'

export function validateWildRecycle(
  grid: Grid,
  wildPosition: Position,
  replacement: RegularCard
): boolean {
  const existing = grid.get(posKey(wildPosition))
  if (!existing || existing.kind !== 'wild') return false

  // Build tentative grid with wild replaced
  const tentative: Grid = new Map(grid)
  tentative.set(posKey(wildPosition), replacement)

  // Check all lines through the wild position
  for (const seg of getMaximalSegments(tentative, wildPosition)) {
    const cards = seg.map(p => tentative.get(posKey(p))!)
    // After replacement all cards in segment are RegularCards
    if (cards.some(c => c.kind === 'wild')) return false // other wilds — not handled here
    if (!isValidLine(cards as RegularCard[])) return false
  }

  return true
}
