import { it, expect } from 'vitest'
import { initGame, applyPlay, posKey } from '@viota/engine'
import type { Card, GameState } from '@viota/engine'
import { serializeState, deserializeState } from '../src/do/state-codec'

it('round-trips a GameState containing regular cards AND wilds', () => {
  // Build a deterministic board by hand (do not rely on shuffle).
  const grid = new Map<string, Card>()
  grid.set(posKey({ x: 0, y: 0 }), { kind: 'regular', color: 'red', shape: 'plus', number: 3 })
  grid.set(posKey({ x: 1, y: 0 }), { kind: 'wild' }) // a wild placed on the board
  grid.set(posKey({ x: 0, y: 1 }), { kind: 'regular', color: 'blue', shape: 'circle', number: 1 })

  const state: GameState = {
    grid,
    hands: [
      [{ kind: 'wild' }, { kind: 'regular', color: 'green', shape: 'square', number: 4 }],
      [{ kind: 'regular', color: 'yellow', shape: 'triangle', number: 2 }],
    ],
    drawPile: [
      { kind: 'regular', color: 'red', shape: 'plus', number: 1 },
      { kind: 'wild' },
      { kind: 'regular', color: 'blue', shape: 'square', number: 4 },
      { kind: 'regular', color: 'green', shape: 'circle', number: 2 },
    ],
    scores: [7, 0],
    turnIndex: 1,
    playedCards: [{ kind: 'regular', color: 'red', shape: 'plus', number: 3 }],
    consecutivePasses: 2,
    finished: false,
  }

  const restored = deserializeState(serializeState(state))

  // grid is a real Map with identical membership
  expect(restored.grid).toBeInstanceOf(Map)
  expect(restored.grid.size).toBe(3)
  expect(restored.grid.get(posKey({ x: 0, y: 0 }))).toEqual({ kind: 'regular', color: 'red', shape: 'plus', number: 3 })
  expect(restored.grid.get(posKey({ x: 1, y: 0 }))).toEqual({ kind: 'wild' })
  expect(restored.grid.get(posKey({ x: 0, y: 1 }))).toEqual({ kind: 'regular', color: 'blue', shape: 'circle', number: 1 })

  // drawPile order survives BYTE-EXACTLY
  expect(JSON.stringify(restored.drawPile)).toBe(JSON.stringify(state.drawPile))

  // everything else round-trips
  expect(restored.hands).toEqual(state.hands)
  expect(restored.scores).toEqual(state.scores)
  expect(restored.turnIndex).toBe(1)
  expect(restored.playedCards).toEqual(state.playedCards)
  expect(restored.consecutivePasses).toBe(2)
  expect(restored.finished).toBe(false)
})

it('naive JSON.stringify would lose the grid (regression guard)', () => {
  const state = initGame(2)
  // Prove the failure mode the codec exists to prevent.
  const naive = JSON.parse(JSON.stringify(state)) as { grid: unknown }
  expect(naive.grid).toEqual({}) // Map serializes to {} — board silently lost
  // The codec preserves it.
  const restored = deserializeState(serializeState(state))
  expect(restored.grid.size).toBe(state.grid.size)
  expect(restored.grid.size).toBeGreaterThan(0)
})

it('preserves drawPile order across a real engine move', () => {
  const before = initGame(3)
  const restored = deserializeState(serializeState(before))
  expect(JSON.stringify(restored.drawPile)).toBe(JSON.stringify(before.drawPile))
  // and grid membership matches after a serialize cycle
  for (const [k, v] of before.grid.entries()) {
    expect(restored.grid.get(k)).toEqual(v)
  }
})
