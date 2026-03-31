import { describe, it, expect } from 'vitest'
import { easyMove } from '../../src/ai/easy'
import { validatePlay } from '../../src/playValidator'
import type { GameState } from '../../src/types'

const R = (color: string, shape: string, n: number) =>
  ({ kind: 'regular' as const, color: color as any, shape: shape as any, number: n as any })

function baseState(): GameState {
  return {
    grid: new Map([['0,0', R('red','circle',1)]]),
    hands: [[R('blue','circle',2), R('green','circle',3), R('yellow','circle',4), R('blue','triangle',1)]],
    drawPile: [],
    scores: [0],
    turnIndex: 0,
    playedCards: [],
  }
}

describe('easyMove', () => {
  it('returns a move', () => {
    const move = easyMove(baseState(), 0)
    expect(move.type === 'play' || move.type === 'pass').toBe(true)
  })

  it('returned play move is valid', () => {
    const state = baseState()
    const move = easyMove(state, 0)
    if (move.type === 'play') {
      expect(validatePlay(state.grid, move.placements).valid).toBe(true)
    }
  })
})
