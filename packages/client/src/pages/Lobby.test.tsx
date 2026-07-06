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

const createOnlineGame = vi.fn()
const createOnlineRoom = vi.fn()
const joinOnlineGame = vi.fn()
vi.mock('../net/lobby', () => ({
  createOnlineGame: (...a: unknown[]) => createOnlineGame(...a),
  createOnlineRoom: (...a: unknown[]) => createOnlineRoom(...a),
  joinOnlineGame: (...a: unknown[]) => joinOnlineGame(...a),
}))
vi.mock('../net/ghost', () => ({ claimGhostGames: vi.fn().mockResolvedValue({ claimed: 0 }) }))

beforeEach(() => {
  mockNavigate.mockClear()
  createOnlineGame.mockReset()
  createOnlineRoom.mockReset()
  joinOnlineGame.mockReset()
  sessionStorage.clear()
})

test('renders name input, opponent selector, and the three actions', () => {
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument()
  expect(screen.getByText('Play vs AI')).toBeInTheDocument()
  expect(screen.getByText('Create Room')).toBeInTheDocument()
  expect(screen.getByText('Join Room')).toBeInTheDocument()
  expect(screen.getByText('Opponents')).toBeInTheDocument()
})

test('Play vs AI creates a solo game and navigates straight to the game', async () => {
  createOnlineGame.mockResolvedValue({ gameId: 'g1', code: 'ABCDEF', mySeat: 0, players: ['Alice', 'AI 2'] })
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Alice')
  await userEvent.click(screen.getByText('Play vs AI'))
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/game/online'))
  expect(sessionStorage.getItem('viota_online_session')).toContain('g1')
})

test('Create Room creates a multiplayer room and navigates to the waiting room', async () => {
  createOnlineRoom.mockResolvedValue({ gameId: 'g2', code: 'ROOMED', mySeat: 0, players: ['Alice', 'Open'] })
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Alice')
  await userEvent.click(screen.getByText('Create Room'))
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/lobby/ROOMED'))
  expect(sessionStorage.getItem('viota_online_session')).toContain('g2')
})

test('Create Room sends the DEFAULT aiTakeoverMs (1 min) when untouched', async () => {
  createOnlineRoom.mockResolvedValue({ gameId: 'g2', code: 'ROOMED', mySeat: 0, players: ['Alice', 'Open'] })
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Alice')
  await userEvent.click(screen.getByText('Create Room'))
  await waitFor(() => expect(createOnlineRoom).toHaveBeenCalled())
  expect(createOnlineRoom.mock.calls[0]![1]).toMatchObject({ aiTakeoverMs: 60000 })
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
  createOnlineGame.mockRejectedValue(new Error('boom'))
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Alice')
  await userEvent.click(screen.getByText('Play vs AI'))
  await waitFor(() => expect(screen.getByText(/Cannot reach server/)).toBeInTheDocument())
  expect(mockNavigate).not.toHaveBeenCalled()
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

test('a join failure surfaces the error message', async () => {
  joinOnlineGame.mockRejectedValue(new Error('No open game found for code ZZZZZZ'))
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Bob')
  await userEvent.type(screen.getByPlaceholderText('Room code'), 'ZZZZZZ')
  await userEvent.click(screen.getByText('Join Room'))
  await waitFor(() => expect(screen.getByText(/No open game found/)).toBeInTheDocument())
})
