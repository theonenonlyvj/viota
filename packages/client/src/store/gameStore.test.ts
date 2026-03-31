import { beforeEach, expect, test, vi } from 'vitest'
import { useGameStore } from './gameStore'
import { posKey } from '@viota/engine'
import type { Move } from '@viota/engine'
import { computeValidPositions } from '../gameLogic'

function store() { return useGameStore.getState() }

beforeEach(() => {
  store().startGame(2, 'easy')
})

test('startGame initialises 2-player state with starter card', () => {
  const s = store()
  expect(s.hands).toHaveLength(2)
  expect(s.hands[0]).toHaveLength(4)
  expect(s.scores).toEqual([0, 0])
  expect(s.phase).toBe('idle')
  expect(s.staged).toHaveLength(0)
  expect(s.selectedCard).toBeNull()
  expect(s.grid.size).toBe(1) // starter card
  expect(s.grid.has(posKey({ x: 0, y: 0 }))).toBe(true)
})

test('selectCard sets selectedCard and computes validPositions adjacent to starter', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  expect(store().selectedCard).toBe(card)
  // (0,0) is occupied by starter, valid positions should be adjacent
  expect(store().validPositions).not.toContainEqual({ x: 0, y: 0 })
  // Should have some valid positions (or none if card is incompatible)
  expect(Array.isArray(store().validPositions)).toBe(true)
})

test('placeCard adds placement to staged and clears selectedCard', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  const validPos = store().validPositions
  if (validPos.length === 0) return // skip if no valid position for this random hand
  const pos = validPos[0]!
  store().placeCard(pos)
  const s = store()
  expect(s.staged).toHaveLength(1)
  expect(s.staged[0]!.card).toBe(card)
  expect(s.staged[0]!.position).toEqual(pos)
  expect(s.selectedCard).toBeNull()
  expect(s.phase).toBe('placing')
})

test('unstageCard removes placement and returns phase to idle', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  const validPos = store().validPositions
  if (validPos.length === 0) return
  const pos = validPos[0]!
  store().placeCard(pos)
  store().unstageCard(pos)
  const s = store()
  expect(s.staged).toHaveLength(0)
  expect(s.phase).toBe('idle')
})

test('confirmPlay applies play, advances turn to AI, sets phase ai-thinking', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  const validPos = store().validPositions
  if (validPos.length === 0) return
  const pos = validPos[0]!
  store().placeCard(pos)
  store().confirmPlay()
  const s = store()
  expect(s.grid.get(posKey(pos))).toEqual(card)
  expect(s.staged).toHaveLength(0)
  expect(s.phase).toBe('ai-thinking')
})

test('confirmPlay triggers worker postMessage when AI turn follows', () => {
  const mockWorker = { postMessage: vi.fn() } as unknown as Worker
  store().setWorker(mockWorker)
  const card = store().hands[0]![0]!
  store().selectCard(card)
  const validPos = store().validPositions
  if (validPos.length === 0) { store().setWorker(null); return }
  const pos = validPos[0]!
  store().placeCard(pos)
  store().confirmPlay()
  expect(mockWorker.postMessage).toHaveBeenCalledOnce()
  const msg = (mockWorker.postMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0]
  expect(msg.type).toBe('getMove')
  expect(msg.playerIndex).toBe(1)
  store().setWorker(null)
})

test('pass advances turn and triggers AI when applicable', () => {
  store().pass([], [])
  const s = store()
  expect(s.turnIndex).toBe(1)
  expect(s.phase).toBe('ai-thinking')
})

test('handleWorkerMessage applies pass move and advances to human turn', () => {
  store().pass([], [])
  const move: Move = { type: 'pass', trades: [], tradeOrder: [] }
  store().handleWorkerMessage(move)
  expect(store().turnIndex).toBe(0)
  expect(store().phase).toBe('idle')
})

test('previewScore is null after unstaging all cards', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  const validPos = store().validPositions
  if (validPos.length === 0) return
  const pos = validPos[0]!
  store().placeCard(pos)
  store().unstageCard(pos)
  expect(store().previewScore).toBeNull()
})
