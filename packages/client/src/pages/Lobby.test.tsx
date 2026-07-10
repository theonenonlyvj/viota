import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Lobby from './Lobby'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const createOnlineRoom = vi.fn()
const joinOnlineGame = vi.fn()
const myGames = vi.fn().mockResolvedValue([])
vi.mock('../net/lobby', () => ({
  createOnlineRoom: (...a: unknown[]) => createOnlineRoom(...a),
  joinOnlineGame: (...a: unknown[]) => joinOnlineGame(...a),
  myGames: (...a: unknown[]) => myGames(...a),
}))
vi.mock('../net/ghost', () => ({ claimGhostGames: vi.fn().mockResolvedValue({ claimed: 0 }) }))

beforeEach(() => {
  mockNavigate.mockClear()
  createOnlineRoom.mockReset()
  joinOnlineGame.mockReset()
  sessionStorage.clear()
})

test('renders name input, Players selector, Create/Join — and NO solo Play-vs-AI', () => {
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument()
  expect(screen.getByText('Players')).toBeInTheDocument()
  expect(screen.getByText('Create Room')).toBeInTheDocument()
  expect(screen.getByText('Join Room')).toBeInTheDocument()
  expect(screen.queryByText('Play vs AI')).not.toBeInTheDocument()
})

test('Create Room creates a multiplayer room and navigates to the waiting room', async () => {
  createOnlineRoom.mockResolvedValue({ gameId: 'g2', code: 'ROOMED', mySeat: 0, players: ['Alice', 'Open'] })
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Alice')
  await userEvent.click(screen.getByText('Create Room'))
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/lobby/ROOMED'))
  expect(sessionStorage.getItem('viota_online_session')).toContain('g2')
})

test('Create Room defaults to 2 players and the 1-min AI takeover', async () => {
  createOnlineRoom.mockResolvedValue({ gameId: 'g2', code: 'ROOMED', mySeat: 0, players: ['Alice', 'Open'] })
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Alice')
  await userEvent.click(screen.getByText('Create Room'))
  await waitFor(() => expect(createOnlineRoom).toHaveBeenCalled())
  expect(createOnlineRoom.mock.calls[0]![1]).toMatchObject({ playerCount: 2, aiTakeoverMs: 60000 })
})

test('the Players selector sets the room size', async () => {
  createOnlineRoom.mockResolvedValue({ gameId: 'g2', code: 'ROOMED', mySeat: 0, players: ['A','B','C','D'] })
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Alice')
  await userEvent.click(screen.getByRole('button', { name: '4' }))
  await userEvent.click(screen.getByText('Create Room'))
  await waitFor(() => expect(createOnlineRoom).toHaveBeenCalled())
  expect(createOnlineRoom.mock.calls[0]![1]).toMatchObject({ playerCount: 4 })
})

test('the AI-takeover picker sends the chosen value (Wait for me -> 0)', async () => {
  createOnlineRoom.mockResolvedValue({ gameId: 'g2', code: 'ROOMED', mySeat: 0, players: ['Alice', 'Open'] })
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Alice')
  await userEvent.click(screen.getByText('Wait for me'))
  await userEvent.click(screen.getByText('Create Room'))
  await waitFor(() => expect(createOnlineRoom).toHaveBeenCalled())
  expect(createOnlineRoom.mock.calls[0]![1]).toMatchObject({ aiTakeoverMs: 0 })
})

test('a create failure surfaces an error and does not navigate', async () => {
  createOnlineRoom.mockRejectedValue(new Error('boom'))
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Alice')
  await userEvent.click(screen.getByText('Create Room'))
  await waitFor(() => expect(screen.getByText(/Cannot reach server/)).toBeInTheDocument())
  expect(mockNavigate).not.toHaveBeenCalled()
})

test('a create requires a name', async () => {
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.click(screen.getByText('Create Room'))
  expect(await screen.findByText(/Name is required/)).toBeInTheDocument()
  expect(createOnlineRoom).not.toHaveBeenCalled()
})

test('Join Room joins by code and navigates to the waiting room', async () => {
  joinOnlineGame.mockResolvedValue({ gameId: 'g7', code: 'ABCDEF', mySeat: 1, players: ['Alice', 'Bob'] })
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Bob')
  await userEvent.type(screen.getByPlaceholderText('Room code'), 'ABCDEF')
  await userEvent.click(screen.getByText('Join Room'))
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/lobby/ABCDEF'))
  expect(sessionStorage.getItem('viota_online_session')).toContain('g7')
})

test('joining an already-active game (resumed) routes into the game, not the waiting room', async () => {
  // Fix #3: rejoining a seat you already own in a STARTED game returns
  // `resumed: true` (no waiting-room roster). This must NOT crash and must
  // NOT land on /lobby/:code (there's no waiting room to show).
  joinOnlineGame.mockResolvedValue({ gameId: 'g7', code: 'ABCDEF', mySeat: 1, players: ['Player 1', 'Bob'], resumed: true })
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Bob')
  await userEvent.type(screen.getByPlaceholderText('Room code'), 'ABCDEF')
  await userEvent.click(screen.getByText('Join Room'))
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/game/online'))
  expect(mockNavigate).not.toHaveBeenCalledWith('/lobby/ABCDEF')
  expect(sessionStorage.getItem('viota_online_session')).toContain('g7')
})

test('a join failure surfaces the error message', async () => {
  joinOnlineGame.mockRejectedValue(new Error('No open game found for code ZZZZZZ'))
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Bob')
  await userEvent.type(screen.getByPlaceholderText('Room code'), 'ZZZZZZ')
  await userEvent.click(screen.getByText('Join Room'))
  await waitFor(() => expect(screen.getByText(/No open game found/)).toBeInTheDocument())
})
