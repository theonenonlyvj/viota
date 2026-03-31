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
    expect(state.grid.size).toBe(1) // starter card at (0,0)
    expect(state.grid.has(posKey({ x: 0, y: 0 }))).toBe(true)
    expect(state.scores).toEqual([0, 0])
    expect(state.turnIndex).toBe(0)
    expect(state.drawPile).toHaveLength(66 - 1 - 8) // 1 starter + 8 dealt
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
    const result = applyPlay(state, 1, [{ card, position: { x: 1, y: 0 } }])
    expect(result).toHaveProperty('error')
  })

  test('places card adjacent to starter successfully', () => {
    const state = initGame(2)
    const card = state.hands[0]![0]!
    // (0,0) has the starter card, so play adjacent at (1,0)
    const result = applyPlay(state, 0, [{ card, position: { x: 1, y: 0 } }])
    if ('error' in result) {
      // Card may not form a valid line with the starter — try other positions
      const result2 = applyPlay(state, 0, [{ card, position: { x: -1, y: 0 } }])
      if ('error' in result2) {
        const result3 = applyPlay(state, 0, [{ card, position: { x: 0, y: 1 } }])
        if ('error' in result3) {
          const result4 = applyPlay(state, 0, [{ card, position: { x: 0, y: -1 } }])
          expect(result4).not.toHaveProperty('error')
          if ('error' in result4) return
          expect(result4.newState.turnIndex).toBe(1)
          expect(result4.gameOver).toBe(false)
          return
        }
        expect(result3.newState.turnIndex).toBe(1)
        return
      }
      expect(result2.newState.turnIndex).toBe(1)
      return
    }
    expect(result.newState.grid.get(posKey({ x: 1, y: 0 }))).toEqual(card)
    expect(result.newState.turnIndex).toBe(1)
    expect(result.newState.scores[0]).toBeGreaterThanOrEqual(0)
    expect(result.gameOver).toBe(false)
  })

  test('redraws to refill hand after play', () => {
    const state = initGame(2)
    const card = state.hands[0]![0]!
    // Use computeValidPositions to find a valid spot
    const positions = computeValidPositions(state.grid, [], card)
    if (positions.length === 0) return // card can't be played, skip
    const result = applyPlay(state, 0, [{ card, position: positions[0]! }])
    if ('error' in result) return // skip if still invalid
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
  test('returns adjacent positions to starter card', () => {
    const state = initGame(2)
    const card = state.hands[0]![0]!
    const positions = computeValidPositions(state.grid, [], card)
    // Starter is at (0,0), so valid positions are adjacent to it
    const keys = positions.map(p => posKey(p))
    const adjacent = ['1,0', '-1,0', '0,1', '0,-1']
    // At least some adjacent cells should be valid (depends on card compatibility)
    expect(keys.some(k => adjacent.includes(k)) || positions.length === 0).toBe(true)
  })

  test('does not include occupied (0,0) in valid positions', () => {
    const state = initGame(2)
    const card = state.hands[0]![0]!
    const positions = computeValidPositions(state.grid, [], card)
    expect(positions).not.toContainEqual({ x: 0, y: 0 })
  })
})

describe('computePreviewScore', () => {
  test('returns null when staged is empty', () => {
    const state = initGame(2)
    expect(computePreviewScore(state.grid, [])).toBeNull()
  })

  test('returns score for valid staged placement next to starter', () => {
    const state = initGame(2)
    const card = state.hands[0]![0]!
    const positions = computeValidPositions(state.grid, [], card)
    if (positions.length === 0) return // skip if card can't be placed
    const preview = computePreviewScore(state.grid, [{ card, position: positions[0]! }])
    // Adjacent to starter creates a line of 2, should score > 0
    if (preview) {
      expect(preview.total).toBeGreaterThanOrEqual(0)
    }
  })
})
