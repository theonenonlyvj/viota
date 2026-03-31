import type { Grid, Position, ScoreResult } from './types'
import { posKey, getMaximalSegments } from './grid'

export function score(
  grid: Grid,
  newPositions: Position[],
  opts: { gameEnding?: boolean; cardsPlayedThisTurn?: number } = {}
): ScoreResult {
  const newKeys = new Set(newPositions.map(posKey))
  const cardsPlayed = opts.cardsPlayedThisTurn ?? newPositions.length

  // Collect all affected segments (deduplicated by sorted position key set)
  const seen = new Set<string>()
  const affectedSegments: Position[][] = []

  for (const pos of newPositions) {
    for (const seg of getMaximalSegments(grid, pos)) {
      if (!seg.some(p => newKeys.has(posKey(p)))) continue
      const segKey = seg.map(posKey).sort().join('|')
      if (!seen.has(segKey)) {
        seen.add(segKey)
        affectedSegments.push(seg)
      }
    }
  }

  let base = 0
  let lots = 0

  for (const seg of affectedSegments) {
    for (const pos of seg) {
      const card = grid.get(posKey(pos))
      if (!card) continue
      base += card.kind === 'regular' ? card.number : 0
    }
    if (seg.length === 4) lots++
  }

  let multiplier = 1
  multiplier *= Math.pow(2, lots)
  if (cardsPlayed === 4) multiplier *= 2
  if (opts.gameEnding) multiplier *= 2

  return {
    base,
    multiplier,
    total: base * multiplier,
    affectedLines: affectedSegments.map(seg => ({
      positions: seg,
      cards: seg.map(p => grid.get(posKey(p))!),
    })),
  }
}
