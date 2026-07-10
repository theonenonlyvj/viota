import { beforeEach, expect, test, vi } from 'vitest'
import { useGameStore } from './gameStore'
import type { OnlineClient } from '../net/online'
import type { ClientView, ClientMove } from '../net/protocol'

function store() { return useGameStore.getState() }

const card = { kind: 'regular' as const, color: 'red' as const, shape: 'circle' as const, number: 2 as const }

function view(over: Partial<ClientView> = {}): ClientView {
  return {
    grid: [['0,0', card]],
    mySeat: 0,
    myHand: [card, card],
    handCounts: [2, 4],
    drawPileCount: 40,
    scores: [5, 3],
    turnIndex: 0,
    playedCards: [],
    consecutivePasses: 0,
    finished: false,
    ...over,
  }
}

beforeEach(() => {
  store().startOnline('game-1', 0)
})

test('startOnline sets online mode, gameId and my seat', () => {
  const s = store()
  expect(s.mode).toBe('online')
  expect(s.gameId).toBe('game-1')
  expect(s.mySeat).toBe(0)
  expect(s.humanIndex).toBe(0)
  expect(s.moveIndex).toBe(0)
})

test('applyOnlineView replaces state wholesale from a ClientView', () => {
  store().applyOnlineView(view(), 5)
  const s = store()
  expect(s.moveIndex).toBe(5)
  expect(s.grid.get('0,0')).toEqual(card)
  expect(s.hands[0]).toEqual([card, card])
  expect(s.handCounts).toEqual([2, 4])
  expect(s.drawPileCount).toBe(40)
  expect(s.scores).toEqual([5, 3])
  expect(s.phase).toBe('idle') // my turn
})

test('applyOnlineView ignores a stale (lower) moveIndex', () => {
  store().applyOnlineView(view({ scores: [9, 9] }), 5)
  store().applyOnlineView(view({ scores: [0, 0] }), 3) // stale
  expect(store().scores).toEqual([9, 9])
  expect(store().moveIndex).toBe(5)
})

test('applyOnlineView derives player display names from the server roster (seat order)', () => {
  store().applyOnlineView(view({
    players: [
      { seat: 0, displayName: 'Vijay', ownerType: 'human' },
      { seat: 1, displayName: 'AI 2', ownerType: 'ai' },
    ],
  }), 5)
  expect(store().players).toEqual(['Vijay', 'AI 2'])
})

test('applyOnlineView leaves players empty when the view carries no roster (caller falls back)', () => {
  store().applyOnlineView(view(), 5) // the view() fixture omits `players`
  expect(store().players).toEqual([])
})

test('applyOnlineView sets phase ai-thinking when it is not my turn', () => {
  store().applyOnlineView(view({ turnIndex: 1 }), 2)
  expect(store().phase).toBe('ai-thinking')
})

test('a pending move clears when the authoritative echo arrives', () => {
  useGameStore.setState({ pending: true })
  store().applyOnlineView(view(), 4)
  expect(store().pending).toBe(false)
})

test('onlinePlay sets pending, posts the move, and commits on the ok echo', async () => {
  useGameStore.setState({ staged: [{ card, position: { x: 1, y: 0 } }] })
  const postMove = vi.fn().mockResolvedValue({ status: 'ok', moveIndex: 1, view: view({ turnIndex: 1 }) })
  const net = { postMove, sync: vi.fn() } as unknown as OnlineClient
  store().setOnlineClient(net)

  store().onlinePlay()
  expect(store().pending).toBe(true) // no optimistic board mutation, just the affordance
  expect(postMove).toHaveBeenCalledOnce()
  const [move, clientMoveId] = postMove.mock.calls[0]!
  expect(move).toEqual({ type: 'play', placements: [{ card, position: { x: 1, y: 0 } }] })
  expect(typeof clientMoveId).toBe('string')

  await new Promise((r) => setTimeout(r)) // flush the postMove .then chain
  expect(store().pending).toBe(false)
  expect(store().moveIndex).toBe(1)
})

test('a queued (offline) postMove leaves the move pending', async () => {
  useGameStore.setState({ staged: [{ card, position: { x: 1, y: 0 } }] })
  const net = { postMove: vi.fn().mockResolvedValue({ status: 'queued' }), sync: vi.fn() } as unknown as OnlineClient
  store().setOnlineClient(net)
  store().onlinePlay()
  await new Promise((r) => setTimeout(r))
  expect(store().pending).toBe(true)
})

test('vetoOffer is set when it is my turn and the last move was an AI move on my seat', () => {
  const moves: ClientMove[] = [
    { moveIndex: 7, turnNumber: 4, seatIndex: 0, type: 'pass', payload: {}, scoreDelta: 0, scoreAfter: 5, byAi: true },
  ]
  store().applyOnlineView(view({ turnIndex: 0 }), 7, moves)
  expect(store().vetoOffer).toBe(true)
})

test('handleAiCover on my seat offers a reclaim; dismiss clears the toast', () => {
  store().handleAiCover(0)
  expect(store().aiCoverSeat).toBe(0)
  expect(store().reclaimable).toBe(true)
  store().dismissAiCover()
  expect(store().aiCoverSeat).toBeNull()
})
