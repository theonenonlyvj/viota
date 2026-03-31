import { describe, it, expect } from 'vitest'
import { mediumMove } from '../../src/ai/medium'
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

describe('mediumMove', () => {
  it('returns a move', () => {
    const move = mediumMove(baseState(), 0)
    expect(move.type === 'play' || move.type === 'pass').toBe(true)
  })

  it('prefers a higher-scoring play over a lower-scoring one', () => {
    // Hand has a card that completes a lot vs one that doesn't
    // Grid: (0,0)=R(1), (1,0)=R(2), (2,0)=R(3) — same color/shape, diff numbers
    // Playing R(4) at (3,0) completes the lot (sum 10, doubled) = 20
    // Playing anything else gives less
    const state: GameState = {
      grid: new Map([
        ['0,0', R('red','circle',1)],
        ['1,0', R('red','circle',2)],
        ['2,0', R('red','circle',3)],
      ]),
      hands: [[R('red','circle',4), R('blue','triangle',1), R('green','plus',2), R('yellow','square',3)]],
      drawPile: [],
      scores: [0],
      turnIndex: 0,
      playedCards: [],
    }
    const move = mediumMove(state, 0)
    expect(move.type).toBe('play')
    if (move.type === 'play') {
      const lotCard = move.placements.find(p =>
        p.card.kind === 'regular' && p.card.color === 'red' && p.card.number === 4
      )
      expect(lotCard).toBeDefined()
    }
  })
})
