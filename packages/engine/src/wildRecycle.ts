import type { Grid, Position, RegularCard } from './types'
import { posKey } from './grid'
import { wildLinesConsistent } from './lineValidator'

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

  // Every line through the recycled position must stay valid. If another wild
  // shares one of those lines, it must have a consistent assignment — the
  // transitive closure handles that (rules: the replacement must fit any and
  // all line(s) the wild was part of).
  return wildLinesConsistent(tentative, [wildPosition])
}
