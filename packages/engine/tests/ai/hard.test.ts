import { describe, it, expect } from 'vitest'
import { hardMove } from '../../src/ai/hard'
import type { GameState } from '../../src/types'

const R = (color: string, shape: string, n: number) =>
  ({ kind: 'regular' as const, color: color as any, shape: shape as any, number: n as any })

describe('hardMove', () => {
  it('returns a valid move', () => {
    const state: GameState = {
      grid: new Map([['0,0', R('red','circle',1)]]),
      hands: [[R('blue','circle',2), R('green','circle',3), R('yellow','circle',4), R('red','triangle',1)]],
      drawPile: [],
      scores: [0, 0],
      turnIndex: 0,
      playedCards: [],
    }
    const move = hardMove(state, 0)
    expect(move.type === 'play' || move.type === 'pass').toBe(true)
  })

  it('avoids completing a lot for the opponent', () => {
    // Grid has 3 cards almost forming a lot. Hard AI should not extend it
    // if a different move exists that doesn't set up opponent.
    // (3,0)=R('red','circle',1),(3,1)=R('red','circle',2),(3,2)=R('red','circle',3)
    // Playing (3,3)=R('red','circle',4) would complete the lot but leave no bonus for AI
    // Hard AI should prefer a different move if one exists and scores >= this
    const state: GameState = {
      grid: new Map([
        ['0,0', R('red','circle',1)],
        ['3,0', R('red','circle',1)],
        ['3,1', R('red','circle',2)],
        ['3,2', R('red','circle',3)],
      ]),
      hands: [[
        R('red','circle',4),   // completes opponent lot
        R('blue','circle',2),  // can play at (1,0) - safe
        R('green','circle',3),
        R('yellow','circle',4),
      ]],
      drawPile: Array(20).fill(R('blue','triangle',1)), // non-empty pile
      scores: [0, 0],
      turnIndex: 0,
      playedCards: [],
    }
    const move = hardMove(state, 0)
    // Hard AI should not play red circle 4 at (3,3) if a better or equal safe move exists
    if (move.type === 'play' && move.placements.length === 1) {
      const card = move.placements[0]!.card
      const pos  = move.placements[0]!.position
      const completesLot = card.kind === 'regular' && card.color === 'red' &&
        card.number === 4 && pos.x === 3 && pos.y === 3
      expect(completesLot).toBe(false)
    }
  })
})
