import { it, expect, describe } from 'vitest'
import type { Card, GameState, RegularCard } from '@viota/engine'
import { posKey } from '@viota/engine'
import { validateMovePayloadShape, applyMovePayload, type MovePayload } from '../src/do/moves'

// --- Card fixtures -----------------------------------------------------------
const RT = (n: 1 | 2 | 3 | 4): RegularCard => ({ kind: 'regular', color: 'red', shape: 'triangle', number: n })
const BS = (n: 1 | 2 | 3 | 4): RegularCard => ({ kind: 'regular', color: 'blue', shape: 'square', number: n })
const WILD: Card = { kind: 'wild' }

describe('validateMovePayloadShape', () => {
  it('accepts a well-formed play (1-4 placements)', () => {
    const r = validateMovePayloadShape({ type: 'play', placements: [{ card: RT(1), position: { x: 1, y: 0 } }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.move.type).toBe('play')
  })

  it('rejects a play with 0 or >4 placements', () => {
    expect(validateMovePayloadShape({ type: 'play', placements: [] }).ok).toBe(false)
    const five = Array.from({ length: 5 }, (_, i) => ({ card: RT(1), position: { x: i, y: 0 } }))
    expect(validateMovePayloadShape({ type: 'play', placements: five }).ok).toBe(false)
  })

  it('rejects a play whose placement is malformed (bad card / bad position)', () => {
    expect(validateMovePayloadShape({ type: 'play', placements: [{ card: { kind: 'regular', color: 'purple' }, position: { x: 0, y: 0 } }] }).ok).toBe(false)
    expect(validateMovePayloadShape({ type: 'play', placements: [{ card: RT(1), position: { x: 0.5, y: 0 } }] }).ok).toBe(false)
    expect(validateMovePayloadShape({ type: 'play', placements: [{ card: RT(1) }] }).ok).toBe(false)
  })

  it('accepts a pass with 0-4 trades and a tradeOrder that permutes trades', () => {
    expect(validateMovePayloadShape({ type: 'pass', trades: [], tradeOrder: [] }).ok).toBe(true)
    const r = validateMovePayloadShape({ type: 'pass', trades: [RT(1), BS(2)], tradeOrder: [BS(2), RT(1)] })
    expect(r.ok).toBe(true)
  })

  it('rejects a pass whose tradeOrder is not a permutation of trades', () => {
    expect(validateMovePayloadShape({ type: 'pass', trades: [RT(1), BS(2)], tradeOrder: [RT(1), RT(1)] }).ok).toBe(false)
    expect(validateMovePayloadShape({ type: 'pass', trades: [RT(1)], tradeOrder: [RT(1), BS(2)] }).ok).toBe(false)
  })

  it('rejects a pass trading more than 4 cards', () => {
    const five = [RT(1), RT(2), RT(3), RT(4), BS(1)]
    expect(validateMovePayloadShape({ type: 'pass', trades: five, tradeOrder: five }).ok).toBe(false)
  })

  it('treats wilds as interchangeable in a pass permutation', () => {
    expect(validateMovePayloadShape({ type: 'pass', trades: [WILD, RT(1)], tradeOrder: [RT(1), WILD] }).ok).toBe(true)
  })

  it('accepts a wild_recycle with a position and a regular replacement', () => {
    const r = validateMovePayloadShape({ type: 'wild_recycle', wildPosition: { x: 0, y: 0 }, replacement: RT(3) })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.move.type).toBe('wild_recycle')
  })

  it('rejects a wild_recycle whose replacement is a wild or missing', () => {
    expect(validateMovePayloadShape({ type: 'wild_recycle', wildPosition: { x: 0, y: 0 }, replacement: WILD }).ok).toBe(false)
    expect(validateMovePayloadShape({ type: 'wild_recycle', wildPosition: { x: 0, y: 0 } }).ok).toBe(false)
  })

  it('rejects an unknown or missing move type', () => {
    expect(validateMovePayloadShape({ type: 'teleport' }).ok).toBe(false)
    expect(validateMovePayloadShape({}).ok).toBe(false)
    expect(validateMovePayloadShape(null).ok).toBe(false)
    expect(validateMovePayloadShape(42).ok).toBe(false)
  })
})

// A minimal deterministic 2-player state: starter wild at (0,0) + a red-triangle-1
// at (1,0). 2-card lines are always valid, so a recycle here is trivially legal.
function baseState(): GameState {
  const grid = new Map<string, Card>()
  grid.set(posKey({ x: 0, y: 0 }), WILD)
  grid.set(posKey({ x: 1, y: 0 }), RT(1))
  return {
    grid,
    hands: [
      [RT(2), BS(1), BS(2), BS(3)], // seat 0
      [RT(4), BS(1), BS(2), BS(3)], // seat 1
    ],
    drawPile: [BS(4), BS(4), BS(4), BS(4)],
    scores: [0, 0],
    turnIndex: 0,
    playedCards: [RT(1)],
    consecutivePasses: 0,
    finished: false,
  }
}

describe('applyMovePayload dispatch', () => {
  it('dispatches a play to the engine and advances the turn', () => {
    const move: MovePayload = { type: 'play', placements: [{ card: RT(2), position: { x: 2, y: 0 } }] }
    const r = applyMovePayload(baseState(), 0, move)
    expect('error' in r).toBe(false)
    if (!('error' in r)) {
      expect(r.newState.turnIndex).toBe(1) // play advances
      expect(r.scoreDelta).toBeGreaterThanOrEqual(0)
      expect(r.gameOver).toBe(false)
    }
  })

  it('dispatches a pass to the engine (0 delta) and advances the turn', () => {
    const move: MovePayload = { type: 'pass', trades: [], tradeOrder: [] }
    const r = applyMovePayload(baseState(), 0, move)
    expect('error' in r).toBe(false)
    if (!('error' in r)) {
      expect(r.newState.turnIndex).toBe(1)
      expect(r.scoreDelta).toBe(0)
    }
  })

  it('dispatches a wild_recycle to the engine and does NOT advance the turn', () => {
    const move: MovePayload = { type: 'wild_recycle', wildPosition: { x: 0, y: 0 }, replacement: RT(4) }
    // seat 1 must be on turn for the engine to accept; build a state at turnIndex 1
    const s = baseState()
    s.turnIndex = 1
    const r = applyMovePayload(s, 1, move)
    expect('error' in r).toBe(false)
    if (!('error' in r)) {
      expect(r.newState.turnIndex).toBe(1) // recycle does NOT advance
      expect(r.scoreDelta).toBe(0)
      expect(r.newState.grid.get(posKey({ x: 0, y: 0 }))).toEqual(RT(4)) // wild replaced
    }
  })

  it('returns the engine error string for an illegal move (engine is the legality gate)', () => {
    // Playing onto an occupied cell is illegal per the engine.
    const move: MovePayload = { type: 'play', placements: [{ card: RT(2), position: { x: 0, y: 0 } }] }
    const r = applyMovePayload(baseState(), 0, move)
    expect('error' in r).toBe(true)
  })
})
