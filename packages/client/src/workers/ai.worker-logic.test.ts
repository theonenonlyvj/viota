import { describe, expect, test } from 'vitest'
import { computeAIMove } from './ai.worker-logic'
import { createDeck, shuffle, type Card, type GameState } from '@viota/engine'

function makeGame(playerCount: number): GameState {
  const deck = shuffle(createDeck())
  const hands: Card[][] = []
  let pile = [...deck]
  for (let i = 0; i < playerCount; i++) {
    hands.push(pile.splice(0, 4))
  }
  return {
    grid: new Map(),
    hands,
    drawPile: pile,
    scores: Array.from({ length: playerCount }, () => 0),
    turnIndex: 0,
    playedCards: [],
  }
}

describe('computeAIMove', () => {
  test('returns a play or pass move for easy AI', () => {
    const state = makeGame(2)
    const serialized = { ...state, grid: [...state.grid.entries()] as [string, Card][] }
    const move = computeAIMove(serialized, 0, 'easy')
    expect(['play', 'pass']).toContain(move.type)
  })

  test('returns a play or pass move for expert AI', () => {
    const state = makeGame(2)
    const serialized = { ...state, grid: [...state.grid.entries()] as [string, Card][] }
    const move = computeAIMove(serialized, 0, 'expert')
    expect(['play', 'pass']).toContain(move.type)
  })

  test('deserializes grid Map correctly before calling AIAgent', () => {
    const state = makeGame(3)
    const serialized = { ...state, grid: [...state.grid.entries()] as [string, Card][] }
    expect(() => computeAIMove(serialized, 0, 'easy')).not.toThrow()
  })
})
