import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import OnlineGame from './OnlineGame'
import { useGameStore } from '../store/gameStore'
import { saveSession } from '../net/session'
import type { ClientView } from '../net/protocol'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

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

// Capture the nudge channel's reopen() so a foreground-reopen test can assert it.
const mockReopen = vi.fn()
vi.mock('../net/nudge', () => ({ createNudgeChannel: () => ({ close: vi.fn(), reopen: mockReopen }) }))

// Capture the foreground handler so tests can simulate returning to the tab.
let mockForegroundHandler: ((trigger: string) => void) | null = null
vi.mock('../net/reconcile', () => ({
  runReconcile: vi.fn().mockResolvedValue(undefined),
  attachForegroundReconcile: (h: (t: string) => void) => { mockForegroundHandler = h; return () => {} },
}))

// Room creation for the "Play again" flow.
const mockCreateOnlineRoom = vi.fn()
vi.mock('../net/lobby', () => ({
  createOnlineGame: vi.fn(),
  createOnlineRoom: (...a: unknown[]) => mockCreateOnlineRoom(...a),
  leaveGame: vi.fn(),
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
  mockNavigate.mockClear()
  mockReopen.mockClear()
  mockCreateOnlineRoom.mockReset()
  mockForegroundHandler = null
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

test('shows the server-authoritative roster, overriding a stale "Open/Open" session snapshot', () => {
  // The host's session was seeded with placeholders at room creation and never
  // refreshed (the bug) — the first real server view must win over it.
  saveSession({ gameId: 'g1', code: 'ABCDEF', mySeat: 0, players: ['Open', 'Open'] })
  render(<MemoryRouter><OnlineGame /></MemoryRouter>)
  act(() => useGameStore.getState().applyOnlineView(view({
    players: [
      { seat: 0, displayName: 'Vijay', ownerType: 'human' },
      { seat: 1, displayName: 'Sam', ownerType: 'human' },
    ],
  }), 1))
  expect(screen.getByText('Vijay')).toBeInTheDocument()
  expect(screen.getByText('Sam')).toBeInTheDocument()
  expect(screen.queryByText('Open')).not.toBeInTheDocument()
})

test('a reclaim offer renders a Reclaim button', () => {
  render(<MemoryRouter><OnlineGame /></MemoryRouter>)
  act(() => { useGameStore.getState().applyOnlineView(view({ turnIndex: 1 }), 1); useGameStore.getState().handleAiCover(0) })
  expect(screen.getByText('Reclaim')).toBeInTheDocument()
})

test('returning to the foreground forces the nudge socket to reopen', () => {
  render(<MemoryRouter><OnlineGame /></MemoryRouter>)
  act(() => useGameStore.getState().applyOnlineView(view(), 1))
  expect(mockReopen).not.toHaveBeenCalled()
  // Simulate the foreground/visibility handler firing (return to the tab).
  act(() => mockForegroundHandler?.('visible'))
  expect(mockReopen).toHaveBeenCalled()
})

test('game over shows the winner announcement + Play again', () => {
  render(<MemoryRouter><OnlineGame /></MemoryRouter>)
  act(() => useGameStore.getState().applyOnlineView(view({ finished: true, scores: [30, 12] }), 9))
  expect(screen.getByText('Game Over')).toBeInTheDocument()
  expect(screen.getByText('You win!')).toBeInTheDocument()
  expect(screen.getByText('Play again')).toBeInTheDocument()
})

test('Play again creates a fresh MULTIPLAYER room and navigates to the lobby', async () => {
  mockCreateOnlineRoom.mockResolvedValue({ gameId: 'g2', code: 'ZZZZZZ', mySeat: 0, players: ['You', 'Open'] })
  render(<MemoryRouter><OnlineGame /></MemoryRouter>)
  act(() => useGameStore.getState().applyOnlineView(view({ finished: true, scores: [30, 12] }), 9))

  await userEvent.click(screen.getByText('Play again'))

  // Same seat count as the finished game (handCounts.length === 2), and it goes
  // to the waiting room — NOT a solo-vs-AI game.
  await waitFor(() => expect(mockCreateOnlineRoom).toHaveBeenCalledWith(
    expect.any(String), expect.objectContaining({ playerCount: 2 }),
  ))
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/lobby/ZZZZZZ'))
})
