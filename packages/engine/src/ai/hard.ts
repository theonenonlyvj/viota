import type { GameState, Move, Placement } from '../types'
import { validatePlay } from '../playValidator'
import { score } from '../scorer'
import { posKey, getMaximalSegments } from '../grid'
import { mediumMove } from './medium'

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

// Heuristic penalty: does this play set up a near-complete lot for the opponent?
function opponentLotSetupPenalty(tentativeGrid: Map<string, any>): number {
  let penalty = 0
  for (const key of tentativeGrid.keys()) {
    const pos = { x: +key.split(',')[0]!, y: +key.split(',')[1]! }
    for (const seg of getMaximalSegments(tentativeGrid, pos)) {
      if (seg.length === 3) penalty += 5  // 3-card line = one card away from lot
    }
  }
  return penalty
}

export function hardMove(state: GameState, playerIndex: number): Move {
  const candidates = allSinglePlacements(state, playerIndex)
  let bestMove: Move | null = null
  let bestNet = -Infinity

  for (const placements of candidates) {
    if (!validatePlay(state.grid, placements).valid) continue

    const tentative = new Map(state.grid)
    for (const { card, position } of placements) tentative.set(posKey(position), card)

    const s = score(tentative, placements.map(p => p.position), {
      cardsPlayedThisTurn: placements.length,
    })

    // Only apply penalty if draw pile is non-empty (opponent will actually get a turn)
    const penalty = state.drawPile.length > 0
      ? opponentLotSetupPenalty(tentative)
      : 0

    const net = s.total - penalty
    if (net > bestNet) {
      bestNet = net
      bestMove = { type: 'play', placements }
    }
  }

  return bestMove ?? mediumMove(state, playerIndex)
}
