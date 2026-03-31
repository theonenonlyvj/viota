import type { GameState, Move, Placement } from '../types'
import { validatePlay } from '../playValidator'
import { score } from '../scorer'
import { posKey } from '../grid'
import { easyMove } from './easy'

function allSinglePlacements(state: GameState, playerIndex: number): Placement[][] {
  const hand = state.hands[playerIndex]!
  const grid = state.grid
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
      results.push([{ card, position: { x: x!, y: y! } }])
    }
  }
  return results
}

export function mediumMove(state: GameState, playerIndex: number): Move {
  const candidates = allSinglePlacements(state, playerIndex)
  let bestMove: Move | null = null
  let bestScore = -1

  for (const placements of candidates) {
    if (!validatePlay(state.grid, placements).valid) continue

    // Build tentative grid
    const tentative = new Map(state.grid)
    for (const { card, position } of placements) tentative.set(posKey(position), card)

    const s = score(tentative, placements.map(p => p.position), {
      cardsPlayedThisTurn: placements.length,
    })

    if (s.total > bestScore) {
      bestScore = s.total
      bestMove = { type: 'play', placements }
    }
  }

  if (bestMove) return bestMove

  // Fall back to easy if no scored move found
  return easyMove(state, playerIndex)
}
