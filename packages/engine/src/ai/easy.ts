import type { GameState, Move, Card, Placement } from '../types'
import { validatePlay } from '../playValidator'
import { posKey } from '../grid'

// Generate all candidate single-card placements adjacent to existing cards
function candidatePlacements(grid: Map<string, Card>, hand: Card[]): Placement[][] {
  const adjacent = new Set<string>()
  for (const key of grid.keys()) {
    const [x, y] = key.split(',').map(Number)
    for (const pos of [{ x: x!+1, y: y! }, { x: x!-1, y: y! }, { x: x!, y: y!+1 }, { x: x!, y: y!-1 }]) {
      if (!grid.has(posKey(pos))) adjacent.add(posKey(pos))
    }
  }

  const results: Placement[][] = []
  for (const card of hand) {
    for (const key of adjacent) {
      const [x, y] = key.split(',').map(Number)
      const placement: Placement = { card, position: { x: x!, y: y! } }
      results.push([placement])
    }
  }
  return results
}

export function easyMove(state: GameState, playerIndex: number): Move {
  const hand = state.hands[playerIndex]!
  const candidates = candidatePlacements(state.grid, hand)

  // Shuffle candidates for randomness
  const shuffled = [...candidates].sort(() => Math.random() - 0.5)

  for (const placements of shuffled) {
    if (validatePlay(state.grid, placements).valid) {
      return { type: 'play', placements }
    }
  }

  // No valid play found — pass with all cards traded
  return { type: 'pass', trades: hand, tradeOrder: [...hand].reverse() }
}
