import { beforeEach, expect, test, vi } from 'vitest'
import { useGameStore } from './gameStore'
import { posKey } from '@viota/engine'
import type { Card, RegularCard, Move, Position } from '@viota/engine'
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

test('startRecycle sets recycleTarget and computes recycleValidCards', () => {
  const s = store()
  const wildPos: Position = { x: 1, y: 0 }
  const newGrid = new Map(s.grid)
  newGrid.set(posKey(wildPos), { kind: 'wild' } as Card)
  useGameStore.setState({ grid: newGrid })

  store().startRecycle(wildPos)
  expect(store().recycleTarget).toEqual(wildPos)
  expect(Array.isArray(store().recycleValidCards)).toBe(true)
})

test('startRecycle ignores non-wild positions', () => {
  store().startRecycle({ x: 0, y: 0 })
  expect(store().recycleTarget).toBeNull()
})

test('cancelRecycle clears recycleTarget', () => {
  const s = store()
  const wildPos: Position = { x: 1, y: 0 }
  const newGrid = new Map(s.grid)
  newGrid.set(posKey(wildPos), { kind: 'wild' } as Card)
  useGameStore.setState({ grid: newGrid })

  store().startRecycle(wildPos)
  expect(store().recycleTarget).not.toBeNull()
  store().cancelRecycle()
  expect(store().recycleTarget).toBeNull()
  expect(store().recycleValidCards).toEqual([])
})

test('confirmRecycle swaps wild with hand card and clears recycle state', () => {
  const s = store()
  const wildPos: Position = { x: 1, y: 0 }
  const newGrid = new Map(s.grid)
  newGrid.set(posKey(wildPos), { kind: 'wild' } as Card)
  useGameStore.setState({ grid: newGrid })

  store().startRecycle(wildPos)
  const validCards = store().recycleValidCards
  if (validCards.length === 0) return

  const replacement = validCards[0]! as RegularCard
  store().confirmRecycle(replacement)

  expect(store().grid.get(posKey(wildPos))).toEqual(replacement)
  expect(store().hands[0]!.some(c => c.kind === 'wild')).toBe(true)
  expect(store().recycleTarget).toBeNull()
  expect(store().recycleValidCards).toEqual([])
})

test('startRecycle excludes staged cards from recycleValidCards', () => {
  const s = store()
  const wildPos: Position = { x: 1, y: 0 }
  const newGrid = new Map(s.grid)
  newGrid.set(posKey(wildPos), { kind: 'wild' } as Card)
  useGameStore.setState({ grid: newGrid })

  const card = store().hands[0]![0]!
  store().selectCard(card)
  const validPos = store().validPositions
  if (validPos.length > 0) {
    store().placeCard(validPos[0]!)
  }

  store().startRecycle(wildPos)
  const stagedCards = new Set(store().staged.map(p => p.card))
  for (const vc of store().recycleValidCards) {
    expect(stagedCards.has(vc)).toBe(false)
  }
})

describe('online mode', () => {
  test('initOnline sets mode and online state', () => {
    store().initOnline(0, ['Alice', 'Bob'])
    const s = store()
    expect(s.mode).toBe('online')
    expect(s.myIndex).toBe(0)
    expect(s.humanIndex).toBe(0)
    expect(s.playerNames).toEqual(['Alice', 'Bob'])
    expect(s.playerCount).toBe(2)
  })

  test('applyServerState updates grid and hand from ClientView', () => {
    store().initOnline(0, ['Alice', 'Bob'])
    const card: Card = { kind: 'regular', color: 'red', shape: 'circle', number: 2 }
    store().applyServerState({
      grid: [['0,0', card]],
      myHand: [card],
      handSizes: [1, 4],
      drawPileCount: 50,
      scores: [5, 3],
      turnIndex: 0,
      playedCards: [],
    })
    const s = store()
    expect(s.grid.get('0,0')).toEqual(card)
    expect(s.hands[0]).toEqual([card])
    expect(s.handSizes).toEqual([1, 4])
    expect(s.scores).toEqual([5, 3])
    expect(s.turnIndex).toBe(0)
    expect(s.phase).toBe('idle')
  })

  test('applyServerState sets phase to ai-thinking when not my turn', () => {
    store().initOnline(0, ['Alice', 'Bob'])
    const card: Card = { kind: 'regular', color: 'red', shape: 'circle', number: 2 }
    store().applyServerState({
      grid: [['0,0', card]],
      myHand: [card],
      handSizes: [1, 4],
      drawPileCount: 50,
      scores: [0, 0],
      turnIndex: 1,
      playedCards: [],
    })
    expect(store().phase).toBe('ai-thinking')
  })

  test('setConnectionStatus updates connectionStatus', () => {
    store().setConnectionStatus('reconnecting')
    expect(store().connectionStatus).toBe('reconnecting')
  })

  test('handleVoteStart sets disconnectVote', () => {
    store().initOnline(0, ['Alice', 'Bob'])
    store().handleVoteStart(1)
    expect(store().disconnectVote).toEqual({ disconnectedPlayer: 1, votes: new Map(), totalVoters: 0 })
  })

  test('handleVoteCancelled clears disconnectVote', () => {
    store().initOnline(0, ['Alice', 'Bob'])
    store().handleVoteStart(1)
    store().handleVoteCancelled()
    expect(store().disconnectVote).toBeNull()
  })

  test('handleAiTakeover sets aiTakeover info and clears vote', () => {
    store().initOnline(0, ['Alice', 'Bob'])
    store().handleVoteStart(1)
    store().handleAiTakeover(1, 'expert')
    expect(store().disconnectVote).toBeNull()
    expect(store().aiTakeoverInfo).toEqual({ playerIndex: 1, difficulty: 'expert' })
  })
})
