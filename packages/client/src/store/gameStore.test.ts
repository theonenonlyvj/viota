import { beforeEach, expect, test, vi } from 'vitest'
import { useGameStore } from './gameStore'
import { posKey } from '@viota/engine'
import type { Move } from '@viota/engine'

function store() { return useGameStore.getState() }

beforeEach(() => {
  store().startGame(2, 'easy')
})

test('startGame initialises 2-player state', () => {
  const s = store()
  expect(s.hands).toHaveLength(2)
  expect(s.hands[0]).toHaveLength(4)
  expect(s.scores).toEqual([0, 0])
  expect(s.phase).toBe('idle')
  expect(s.staged).toHaveLength(0)
  expect(s.selectedCard).toBeNull()
})

test('selectCard sets selectedCard and computes validPositions on empty board', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  expect(store().selectedCard).toBe(card)
  expect(store().validPositions).toContainEqual({ x: 0, y: 0 })
})

test('placeCard adds placement to staged and clears selectedCard', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  store().placeCard({ x: 0, y: 0 })
  const s = store()
  expect(s.staged).toHaveLength(1)
  expect(s.staged[0]!.card).toBe(card)
  expect(s.staged[0]!.position).toEqual({ x: 0, y: 0 })
  expect(s.selectedCard).toBeNull()
  expect(s.phase).toBe('placing')
})

test('unstageCard removes placement and returns phase to idle', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  store().placeCard({ x: 0, y: 0 })
  store().unstageCard({ x: 0, y: 0 })
  const s = store()
  expect(s.staged).toHaveLength(0)
  expect(s.phase).toBe('idle')
})

test('confirmPlay applies play, advances turn to AI, sets phase ai-thinking', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  store().placeCard({ x: 0, y: 0 })
  store().confirmPlay()
  const s = store()
  expect(s.grid.get(posKey({ x: 0, y: 0 }))).toEqual(card)
  expect(s.staged).toHaveLength(0)
  expect(s.phase).toBe('ai-thinking')
})

test('confirmPlay triggers worker postMessage when AI turn follows', () => {
  const mockWorker = { postMessage: vi.fn() } as unknown as Worker
  store().setWorker(mockWorker)
  const card = store().hands[0]![0]!
  store().selectCard(card)
  store().placeCard({ x: 0, y: 0 })
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
  store().placeCard({ x: 0, y: 0 })
  store().unstageCard({ x: 0, y: 0 })
  expect(store().previewScore).toBeNull()
})
