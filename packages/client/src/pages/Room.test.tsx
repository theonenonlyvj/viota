import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi } from 'vitest'

const loadSession = vi.fn()
// A real saveSession would make the next loadSession() see it; mirror that so
// the "re-enters the waiting room" test can observe the post-save re-render.
const saveSession = vi.fn((s: unknown) => { loadSession.mockReturnValue(s) })
vi.mock('../net/session', () => ({ loadSession: () => loadSession(), saveSession: (s: unknown) => saveSession(s) }))
vi.mock('./WaitingRoom', () => ({ default: () => <div>waiting-room</div> }))
vi.mock('../components/JoinRoom', () => ({ default: ({ code }: { code: string }) => <div>join {code}</div> }))

const myGames = vi.fn()
vi.mock('../net/lobby', () => ({
  myGames: (...a: unknown[]) => myGames(...a),
  placeholderPlayers: (playerCount: number, mySeat: number, myName: string) =>
    Array.from({ length: playerCount }, (_, i) => (i === mySeat ? myName : `Player ${i + 1}`)),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import Room from './Room'

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/lobby/:code" element={<Room />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  loadSession.mockReset()
  saveSession.mockClear() // NOT mockReset — that would drop its loadSession-linking implementation
  myGames.mockReset().mockResolvedValue([])
  mockNavigate.mockClear()
})

test('shows the waiting room when the session is for this room', () => {
  loadSession.mockReturnValue({ gameId: 'g1', code: 'ABC123', mySeat: 0, players: ['me'] })
  at('/lobby/ABC123')
  expect(screen.getByText('waiting-room')).toBeInTheDocument()
})

test('shows the join card (with the code) when there is no session', () => {
  loadSession.mockReturnValue(null)
  at('/lobby/ABC123')
  expect(screen.getByText(/join ABC123/i)).toBeInTheDocument()
})

test('shows the waiting room when the stored session code differs only in case from the URL', () => {
  loadSession.mockReturnValue({ gameId: 'g1', code: 'abc123', mySeat: 0, players: ['me'] })
  at('/lobby/ABC123')
  expect(screen.getByText('waiting-room')).toBeInTheDocument()
})

test('shows the join card when the session is for a different room', () => {
  loadSession.mockReturnValue({ gameId: 'g2', code: 'ZZZ999', mySeat: 0, players: ['me'] })
  at('/lobby/ABC123')
  expect(screen.getByText(/join ABC123/i)).toBeInTheDocument()
})

test('a stranger with no games at all keeps seeing the join card (no /my-games match)', async () => {
  loadSession.mockReturnValue(null)
  myGames.mockResolvedValue([])
  at('/lobby/ABC123')
  await waitFor(() => expect(myGames).toHaveBeenCalled())
  expect(screen.getByText(/join ABC123/i)).toBeInTheDocument()
  expect(saveSession).not.toHaveBeenCalled()
  expect(mockNavigate).not.toHaveBeenCalled()
})

test('resuming the link for an ALREADY-STARTED game you own routes straight into the game, even with sessionStorage cleared', async () => {
  loadSession.mockReturnValue(null) // tab was closed -> no session
  myGames.mockResolvedValue([
    { gameId: 'g9', code: 'ABC123', status: 'active', playerCount: 2, seatIndex: 1, lastActivityAt: Date.now() },
  ])
  at('/lobby/ABC123')
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/game/online'))
  expect(saveSession).toHaveBeenCalledWith(expect.objectContaining({ gameId: 'g9', code: 'ABC123', mySeat: 1 }))
})

test('resuming the link for a game you own that is still WAITING re-enters the waiting room, not the join card', async () => {
  loadSession.mockReturnValue(null)
  myGames.mockResolvedValue([
    { gameId: 'g7', code: 'ABC123', status: 'waiting', playerCount: 3, seatIndex: 0, lastActivityAt: Date.now() },
  ])
  at('/lobby/ABC123')
  await waitFor(() => expect(screen.getByText('waiting-room')).toBeInTheDocument())
  expect(mockNavigate).not.toHaveBeenCalled()
})
