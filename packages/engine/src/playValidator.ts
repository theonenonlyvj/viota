import type { Grid, Placement, PlayResult, Card, RegularCard } from './types'
import { posKey, fromKey, getSegment, getMaximalSegments } from './grid'
import { isValidLine, solveWilds } from './lineValidator'

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

  // Collect all affected segments and validate them
  const playedPositions = new Set(keys)
  const affectedSegments: Card[][] = []
  const seenSegKeys = new Set<string>()

  for (const { position } of placements) {
    for (const seg of getMaximalSegments(tentative, position)) {
      // Only validate segments that contain at least one newly placed card
      if (!seg.some(p => playedPositions.has(posKey(p)))) continue
      const segKey = seg.map(posKey).sort().join('|')
      if (!seenSegKeys.has(segKey)) {
        seenSegKeys.add(segKey)
        const cards = seg.map(p => tentative.get(posKey(p))!)
        affectedSegments.push(cards)
      }
    }
  }

  // Validate line constraints
  // - No-wild segments: validate directly
  // - Wild-containing segments: collect ALL wilds by reference, solve JOINTLY across all segments
  const noWildSegs: Card[][] = []
  const wildSegs: Card[][] = []
  for (const seg of affectedSegments) {
    if (seg.some(c => c.kind === 'wild')) {
      wildSegs.push(seg)
    } else {
      noWildSegs.push(seg)
    }
  }

  for (const seg of noWildSegs) {
    if (!isValidLine(seg as RegularCard[])) return { valid: false, error: 'Invalid line formed' }
  }

  if (wildSegs.length > 0) {
    // Collect unique wilds by object reference
    const wildSet = new Set<Card>()
    for (const seg of wildSegs) {
      for (const card of seg) {
        if (card.kind === 'wild') wildSet.add(card)
      }
    }
    const allWilds = [...wildSet]

    // CRITICAL: Also gather ALL other segments through each wild's position,
    // even if they don't contain newly placed cards. The wild must satisfy
    // every line it belongs to, not just the ones being extended this turn.
    for (const [key, card] of tentative) {
      if (!wildSet.has(card)) continue
      const pos = fromKey(key)
      for (const seg of getMaximalSegments(tentative, pos)) {
        const segKey = seg.map(posKey).sort().join('|')
        if (!seenSegKeys.has(segKey)) {
          seenSegKeys.add(segKey)
          const cards = seg.map(p => tentative.get(posKey(p))!)
          if (cards.some(c => c.kind === 'wild')) {
            wildSegs.push(cards)
          }
        }
      }
    }

    // Solve ALL wild-containing segments jointly — ensures cross-line consistency
    const assignment = solveWilds(allWilds, wildSegs)
    if (!assignment) return { valid: false, error: 'No valid Wild assignment exists for this placement' }
  }

  return { valid: true }
}
