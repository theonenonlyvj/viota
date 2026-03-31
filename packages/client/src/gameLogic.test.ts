import { describe, expect, test } from 'vitest'
import {
  initGame, applyPlay, applyPass,
  computeValidPositions, computePreviewScore,
} from './gameLogic'
import type { Card, Placement, RegularCard } from '@viota/engine'
import { posKey } from '@viota/engine'

describe('initGame', () => {
  test('creates 2-player game with correct structure', () => {
    const state = initGame(2)
    expect(state.hands).toHaveLength(2)
    expect(state.hands[0]).toHaveLength(4)
    expect(state.hands[1]).toHaveLength(4)
    expect(state.grid.size).toBe(0)
    expect(state.scores).toEqual([0, 0])
    expect(state.turnIndex).toBe(0)
    expect(state.drawPile).toHaveLength(66 - 8)
  })

  test('throws for invalid player count', () => {
    expect(() => initGame(1)).toThrow()
    expect(() => initGame(5)).toThrow()
  })
})

describe('applyPlay', () => {
  test('returns error when it is not the player turn', () => {
    const state = initGame(2)
    const card = state.hands[1]![0]!
    const result = applyPlay(state, 1, [{ card, position: { x: 0, y: 0 } }])
    expect(result).toHaveProperty('error')
  })

  test('places first card at (0,0) successfully', () => {
    const state = initGame(2)
    const card = state.hands[0]![0]!
    const result = applyPlay(state, 0, [{ card, position: { x: 0, y: 0 } }])
    expect(result).not.toHaveProperty('error')
    if ('error' in result) return
    expect(result.newState.grid.get(posKey({ x: 0, y: 0 }))).toEqual(card)
    expect(result.newState.turnIndex).toBe(1)
    expect(result.newState.scores[0]).toBeGreaterThanOrEqual(0)
    expect(result.gameOver).toBe(false)
  })

  test('redraws to refill hand after play', () => {
    const state = initGame(2)
    const card = state.hands[0]![0]!
    const result = applyPlay(state, 0, [{ card, position: { x: 0, y: 0 } }])
    if ('error' in result) throw new Error('unexpected error')
    expect(result.newState.hands[0]).toHaveLength(4)
  })
})

describe('applyPass', () => {
  test('advances turn and puts traded cards at bottom of pile', () => {
    const state = initGame(2)
    const trades = [state.hands[0]![0]!]
    const result = applyPass(state, 0, trades, trades)
    expect(result).not.toHaveProperty('error')
    if ('error' in result) return
    expect(result.newState.turnIndex).toBe(1)
    const bottom = result.newState.drawPile[result.newState.drawPile.length - 1]
    expect(bottom).toEqual(trades[0])
  })

  test('returns error when not player turn', () => {
    const state = initGame(2)
    const result = applyPass(state, 1, [], [])
    expect(result).toHaveProperty('error')
  })
})

describe('computeValidPositions', () => {
  test('returns (0,0) on empty board', () => {
    const state = initGame(2)
    const card = state.hands[0]![0]!
    const positions = computeValidPositions(state.grid, [], card)
    expect(positions).toContainEqual({ x: 0, y: 0 })
  })

  test('returns adjacent cells after first card placed', () => {
    const state = initGame(2)
    const card1 = state.hands[0]![0]!
    const result = applyPlay(state, 0, [{ card: card1, position: { x: 0, y: 0 } }])
    if ('error' in result) throw new Error('unexpected error')
    const card2 = result.newState.hands[1]![0]!
    const positions = computeValidPositions(result.newState.grid, [], card2)
    expect(positions.length).toBeGreaterThan(0)
    const keys = positions.map(p => posKey(p))
    const adjacent = ['1,0', '-1,0', '0,1', '0,-1']
    expect(keys.some(k => adjacent.includes(k))).toBe(true)
  })
})

describe('computePreviewScore', () => {
  test('returns null when staged is empty', () => {
    const state = initGame(2)
    expect(computePreviewScore(state.grid, [])).toBeNull()
  })

  test('returns score for valid staged placement on empty board', () => {
    const state = initGame(2)
    const card = state.hands[0]![0]!
    const preview = computePreviewScore(state.grid, [{ card, position: { x: 0, y: 0 } }])
    // Single card on empty board: valid but scores 0 (no lines of length >= 2)
    expect(preview).not.toBeNull()
    expect(preview!.total).toBeGreaterThanOrEqual(0)
  })
})
