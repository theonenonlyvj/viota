import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import JoinRoom from './JoinRoom'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const joinOnlineGame = vi.fn()
const saveSession = vi.fn()
vi.mock('../net/lobby', () => ({ joinOnlineGame: (...a: unknown[]) => joinOnlineGame(...a) }))
vi.mock('../net/session', () => ({ saveSession: (...a: unknown[]) => saveSession(...a) }))
vi.mock('../net/identity', () => ({ getDisplayName: () => 'Player' }))
vi.mock('../net/config', () => ({ serverUrl: () => 'http://x' }))

function renderJoin(onJoined = vi.fn()) {
  render(<MemoryRouter><JoinRoom code="ABC123" onJoined={onJoined} /></MemoryRouter>)
  return onJoined
}

beforeEach(() => { joinOnlineGame.mockReset(); saveSession.mockReset(); mockNavigate.mockClear() })

test('shows the room code, a name field, and a Join button', () => {
  renderJoin()
  expect(screen.getByText('ABC123')).toBeInTheDocument()
  expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument()
  expect(screen.getByText('Join room')).toBeInTheDocument()
})

test('requires a name', async () => {
  renderJoin()
  await userEvent.click(screen.getByText('Join room'))
  expect(await screen.findByText(/Name is required/)).toBeInTheDocument()
  expect(joinOnlineGame).not.toHaveBeenCalled()
})

test('joins with the URL code + typed name, saves the session, signals onJoined', async () => {
  joinOnlineGame.mockResolvedValue({ gameId: 'g9', code: 'ABC123', mySeat: 2, players: ['a', 'b', 'c'] })
  const onJoined = renderJoin()
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Bob')
  await userEvent.click(screen.getByText('Join room'))
  await waitFor(() => expect(joinOnlineGame).toHaveBeenCalledWith('http://x', { code: 'ABC123', displayName: 'Bob' }))
  expect(saveSession).toHaveBeenCalledWith({ gameId: 'g9', code: 'ABC123', mySeat: 2, players: ['a', 'b', 'c'] })
  expect(onJoined).toHaveBeenCalled()
})

test('an already-active game (resumed) navigates straight into the game, not onJoined', async () => {
  // Fix #3: rejoining a seat you already own in a STARTED game returns
  // `resumed: true` (no waiting-room roster). This must NOT crash and must
  // go straight to /game/online, mirroring Room.tsx's /my-games auto-resolve.
  joinOnlineGame.mockResolvedValue({ gameId: 'g9', code: 'ABC123', mySeat: 2, players: ['Player 1', 'Player 2', 'Bob'], resumed: true })
  const onJoined = renderJoin()
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Bob')
  await userEvent.click(screen.getByText('Join room'))
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/game/online'))
  expect(saveSession).toHaveBeenCalledWith({ gameId: 'g9', code: 'ABC123', mySeat: 2, players: ['Player 1', 'Player 2', 'Bob'] })
  expect(onJoined).not.toHaveBeenCalled()
})

test('surfaces a join error and does not signal onJoined', async () => {
  joinOnlineGame.mockRejectedValue(new Error('That room is full or already started'))
  const onJoined = renderJoin()
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Bob')
  await userEvent.click(screen.getByText('Join room'))
  expect(await screen.findByText(/full or already started/)).toBeInTheDocument()
  expect(onJoined).not.toHaveBeenCalled()
})
