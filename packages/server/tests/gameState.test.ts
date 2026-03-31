import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { serializeGrid, deserializeGrid, saveState, loadState, buildClientView } from '../src/gameState'
import { createDb } from '../src/db'
import type { Db } from '../src/db'
import type { GameState, Card } from '@viota/engine'

let db: Db

beforeEach(() => {
  db = createDb(':memory:')
  db.prepare("INSERT INTO rooms (code, status, created_at) VALUES ('TEST01', 'playing', ?)").run(Date.now())
})

afterEach(() => { db.close() })

const R = (n: number): Card => ({ kind: 'regular', color: 'red', shape: 'circle', number: n as 1|2|3|4 })
const W = (): Card => ({ kind: 'wild' })

function makeState(): GameState {
  const grid = new Map<string, Card>([
    ['0,0', R(1)],
    ['1,0', W()],
    ['-1,0', R(3)],
  ])
  return {
    grid,
    hands: [[R(2), R(4)], [W(), R(1)]],
    drawPile: [R(2), R(3)],
    scores: [10, 0],
    turnIndex: 1,
    playedCards: [{ kind: 'regular', color: 'red', shape: 'circle', number: 1 }],
  }
}

describe('serializeGrid / deserializeGrid', () => {
  it('round-trips a grid with regular and wild cards', () => {
    const grid = new Map<string, Card>([
      ['0,0', R(1)],
      ['1,0', W()],
      ['-3,5', R(4)],
    ])
    const json = serializeGrid(grid)
    const restored = deserializeGrid(json)
    expect(restored.size).toBe(3)
    expect(restored.get('0,0')).toEqual(R(1))
    expect(restored.get('1,0')).toEqual(W())
    expect(restored.get('-3,5')).toEqual(R(4))
  })

  it('handles an empty grid', () => {
    const json = serializeGrid(new Map())
    expect(deserializeGrid(json).size).toBe(0)
  })
})

describe('saveState / loadState', () => {
  it('round-trips a full GameState', () => {
    const state = makeState()
    saveState(db, 'TEST01', state)
    const loaded = loadState(db, 'TEST01')
    expect(loaded).not.toBeNull()
    expect(loaded!.scores).toEqual([10, 0])
    expect(loaded!.turnIndex).toBe(1)
    expect(loaded!.grid.size).toBe(3)
    expect(loaded!.grid.get('0,0')).toEqual(R(1))
    expect(loaded!.grid.get('1,0')).toEqual(W())
    expect(loaded!.hands[0]).toEqual([R(2), R(4)])
    expect(loaded!.drawPile).toEqual([R(2), R(3)])
    expect(loaded!.playedCards).toHaveLength(1)
  })

  it('returns null for non-existent room', () => {
    expect(loadState(db, 'NOPE99')).toBeNull()
  })

  it('overwrites existing state on second save', () => {
    const state = makeState()
    saveState(db, 'TEST01', state)
    state.scores = [99, 5]
    saveState(db, 'TEST01', state)
    expect(loadState(db, 'TEST01')!.scores).toEqual([99, 5])
  })
})

describe('buildClientView', () => {
  it('returns full hand for the requesting player', () => {
    const state = makeState()
    const view = buildClientView(state, 0)
    expect(view.myHand).toEqual([R(2), R(4)])
  })

  it('redacts other players hands — returns only counts', () => {
    const state = makeState()
    const view = buildClientView(state, 0)
    expect(view.handSizes).toEqual([2, 2])
  })

  it('returns draw pile count not contents', () => {
    const state = makeState()
    const view = buildClientView(state, 1)
    expect(view.drawPileCount).toBe(2)
    expect((view as any).drawPile).toBeUndefined()
  })

  it('serializes grid as array of entries', () => {
    const state = makeState()
    const view = buildClientView(state, 0)
    expect(Array.isArray(view.grid)).toBe(true)
    expect(view.grid).toHaveLength(3)
  })
})
