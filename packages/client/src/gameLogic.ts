import {
  validatePlay, score, posKey, fromKey,
  type Card, type GameState, type Placement, type Position, type ScoreResult,
} from '@viota/engine'

// The game loop lives in @viota/engine (single source of truth for both the
// local single-player game and the server), so the two can never drift apart.
// Re-exported here so the store's imports stay stable. Only the UI-only helpers
// below (valid-position highlighting + score preview) are client-specific.
export { initGame, applyPlay, applyPass, applyWildRecycle } from '@viota/engine'

export function computeValidPositions(
  grid: GameState['grid'],
  staged: Placement[],
  selectedCard: Card
): Position[] {
  const tentative = new Map(grid)
  for (const { card, position } of staged) tentative.set(posKey(position), card)

  const candidates = new Set<string>()
  if (tentative.size === 0) {
    candidates.add(posKey({ x: 0, y: 0 }))
  } else {
    for (const key of tentative.keys()) {
      const pos = fromKey(key)
      for (const n of [
        { x: pos.x + 1, y: pos.y }, { x: pos.x - 1, y: pos.y },
        { x: pos.x, y: pos.y + 1 }, { x: pos.x, y: pos.y - 1 },
      ]) {
        if (!tentative.has(posKey(n))) candidates.add(posKey(n))
      }
    }
  }

  const valid: Position[] = []
  for (const key of candidates) {
    const pos = fromKey(key)
    const result = validatePlay(grid, [...staged, { card: selectedCard, position: pos }])
    if (result.valid) valid.push(pos)
  }
  return valid
}

export function computePreviewScore(
  grid: GameState['grid'],
  staged: Placement[]
): ScoreResult | null {
  if (staged.length === 0) return null
  const validation = validatePlay(grid, staged)
  if (!validation.valid) return null
  const tentative = new Map(grid)
  for (const { card, position } of staged) tentative.set(posKey(position), card)
  return score(tentative, staged.map(p => p.position), { cardsPlayedThisTurn: staged.length })
}
