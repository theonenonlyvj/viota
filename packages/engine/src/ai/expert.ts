import type { GameState, Move, Placement, RegularCard } from '../types'
import { validatePlay } from '../playValidator'
import { score } from '../scorer'
import { posKey, getMaximalSegments } from '../grid'
import { hardMove } from './hard'

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

// Infer what cards opponents could hold given played cards and own hand
function inferOpponentCandidates(state: GameState, playerIndex: number): RegularCard[] {
  const ownHand = new Set(
    state.hands[playerIndex]!
      .filter((c): c is RegularCard => c.kind === 'regular')
      .map(c => `${c.color}-${c.shape}-${c.number}`)
  )
  const played = new Set(
    state.playedCards.map(c => `${c.color}-${c.shape}-${c.number}`)
  )
  // Cards not accounted for: unknown to us, likely in opponents' hands or draw pile
  const allRegulars: RegularCard[] = []
  for (const color of ['blue','red','yellow','green'] as const)
    for (const shape of ['triangle','plus','square','circle'] as const)
      for (const number of [1,2,3,4] as const)
        if (!ownHand.has(`${color}-${shape}-${number}`) && !played.has(`${color}-${shape}-${number}`))
          allRegulars.push({ kind: 'regular', color, shape, number })
  return allRegulars
}

// Estimate best score opponent could get from tentative board given unknown hand
function estimateOpponentBestScore(tentativeGrid: Map<string, any>, opponentCandidates: RegularCard[]): number {
  const adjacent = new Set<string>()
  for (const key of tentativeGrid.keys()) {
    const [x, y] = key.split(',').map(Number)
    for (const pos of [{ x: x!+1, y: y! }, { x: x!-1, y: y! }, { x: x!, y: y!+1 }, { x: x!, y: y!-1 }]) {
      if (!tentativeGrid.has(posKey(pos))) adjacent.add(posKey(pos))
    }
  }

  let best = 0
  // Sample a subset of candidates to keep this fast
  const sample = opponentCandidates.slice(0, 16)
  for (const card of sample) {
    for (const key of adjacent) {
      const [x, y] = key.split(',').map(Number)
      const pos = { x: x!, y: y! }
      const placements: Placement[] = [{ card, position: pos }]
      if (!validatePlay(tentativeGrid as any, placements).valid) continue
      const tentative2 = new Map(tentativeGrid)
      tentative2.set(posKey(pos), card)
      const s = score(tentative2 as any, [pos], { cardsPlayedThisTurn: 1 })
      if (s.total > best) best = s.total
    }
  }
  return best
}

export function expertMove(state: GameState, playerIndex: number): Move {
  const candidates = allSinglePlacements(state, playerIndex)
  const opponentCandidates = inferOpponentCandidates(state, playerIndex)
  let bestMove: Move | null = null
  let bestNet = -Infinity

  for (const placements of candidates) {
    if (!validatePlay(state.grid, placements).valid) continue

    const tentative = new Map(state.grid)
    for (const { card, position } of placements) tentative.set(posKey(position), card)

    const myScore = score(tentative, placements.map(p => p.position), {
      cardsPlayedThisTurn: placements.length,
    }).total

    const opponentBest = state.drawPile.length > 0
      ? estimateOpponentBestScore(tentative, opponentCandidates)
      : 0

    const net = myScore - opponentBest
    if (net > bestNet) {
      bestNet = net
      bestMove = { type: 'play', placements }
    }
  }

  return bestMove ?? hardMove(state, playerIndex)
}
