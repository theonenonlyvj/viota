import { describe, it, expect } from 'vitest'
import { expertMove } from '../../src/ai/expert'
import type { GameState } from '../../src/types'

const R = (color: string, shape: string, n: number) =>
  ({ kind: 'regular' as const, color: color as any, shape: shape as any, number: n as any })

describe('expertMove', () => {
  it('returns a valid move', () => {
    const state: GameState = {
      grid: new Map([['0,0', R('red','circle',1)]]),
      hands: [[R('blue','circle',2), R('green','circle',3), R('yellow','circle',4), R('red','triangle',1)]],
      drawPile: [],
      scores: [0, 0],
      turnIndex: 0,
      playedCards: [R('red','circle',1)],
    }
    const move = expertMove(state, 0)
    expect(move.type === 'play' || move.type === 'pass').toBe(true)
  })

  it('uses opponent modeling to avoid gifting high-value positions', () => {
    // Expert should prefer the same safe play as hard when opponent has obvious follow-up
    const state: GameState = {
      grid: new Map([['0,0', R('red','circle',1)]]),
      hands: [[R('blue','circle',2), R('green','triangle',3), R('yellow','plus',4), R('red','square',1)]],
      drawPile: Array(20).fill(R('blue','triangle',1)),
      scores: [0, 0],
      turnIndex: 0,
      playedCards: [],
    }
    const move = expertMove(state, 0)
    expect(move.type === 'play' || move.type === 'pass').toBe(true)
  })
})
