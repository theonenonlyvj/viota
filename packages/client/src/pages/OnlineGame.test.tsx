import { render, screen, act } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import OnlineGame from './OnlineGame'
import { useGameStore } from '../store/gameStore'
import { saveSession } from '../net/session'
import type { ClientView } from '../net/protocol'

// Keep the mount effect inert — no real sockets / fetches in a render test.
vi.mock('../net/online', () => ({
  createOnlineClient: () => ({
    gameId: 'g1', seatIndex: 0,
    heartbeat: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue({ moveIndex: 0, snapshot: {}, moves: [] }),
    postMove: vi.fn(), drainOutbox: vi.fn().mockResolvedValue(undefined),
    reclaim: vi.fn().mockResolvedValue(null), veto: vi.fn(),
  }),
}))
vi.mock('../net/nudge', () => ({ createNudgeChannel: () => ({ close: vi.fn(), reopen: vi.fn() }) }))
vi.mock('../net/reconcile', () => ({
  runReconcile: vi.fn().mockResolvedValue(undefined),
  attachForegroundReconcile: () => () => {},
}))

const card = { kind: 'regular' as const, color: 'red' as const, shape: 'circle' as const, number: 2 as const }
function view(over: Partial<ClientView> = {}): ClientView {
  return {
    grid: [['0,0', card]], mySeat: 0, myHand: [card, card, card, card], handCounts: [4, 4],
    drawPileCount: 42, scores: [0, 0], turnIndex: 0, playedCards: [], consecutivePasses: 0, finished: false, ...over,
  }
}

beforeEach(() => {
  sessionStorage.clear()
  saveSession({ gameId: 'g1', code: 'ABCDEF', mySeat: 0, players: ['Alice', 'Bob'] })
})

test('renders the board controls without crashing', () => {
  render(<MemoryRouter><OnlineGame /></MemoryRouter>)
  act(() => useGameStore.getState().applyOnlineView(view(), 1))
  expect(screen.getByText('Confirm Play')).toBeInTheDocument()
})

test('shows the real draw-pile count from the server view', () => {
  render(<MemoryRouter><OnlineGame /></MemoryRouter>)
  act(() => useGameStore.getState().applyOnlineView(view({ drawPileCount: 42 }), 1))
  expect(screen.getByText('42')).toBeInTheDocument()
})

test('shows player names from the session', () => {
  render(<MemoryRouter><OnlineGame /></MemoryRouter>)
  act(() => useGameStore.getState().applyOnlineView(view(), 1))
  expect(screen.getByText('Alice')).toBeInTheDocument()
  expect(screen.getByText('Bob')).toBeInTheDocument()
})

test('a reclaim offer renders a Reclaim button', () => {
  render(<MemoryRouter><OnlineGame /></MemoryRouter>)
  act(() => { useGameStore.getState().applyOnlineView(view({ turnIndex: 1 }), 1); useGameStore.getState().handleAiCover(0) })
  expect(screen.getByText('Reclaim')).toBeInTheDocument()
})

test('game over shows the winner announcement + Rematch', () => {
  render(<MemoryRouter><OnlineGame /></MemoryRouter>)
  act(() => useGameStore.getState().applyOnlineView(view({ finished: true, scores: [30, 12] }), 9))
  expect(screen.getByText('Game Over')).toBeInTheDocument()
  expect(screen.getByText('You win!')).toBeInTheDocument()
  expect(screen.getByText('Rematch')).toBeInTheDocument()
})
