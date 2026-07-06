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
const joinOnlineGame = vi.fn()
vi.mock('../net/lobby', () => ({
  createOnlineGame: (...a: unknown[]) => createOnlineGame(...a),
  joinOnlineGame: (...a: unknown[]) => joinOnlineGame(...a),
}))
vi.mock('../net/ghost', () => ({ claimGhostGames: vi.fn().mockResolvedValue({ claimed: 0 }) }))

beforeEach(() => {
  mockNavigate.mockClear()
  createOnlineGame.mockReset()
  joinOnlineGame.mockReset()
  sessionStorage.clear()
})

test('renders name input, opponent selector, and create/join actions', () => {
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument()
  expect(screen.getByText('Create Online Game')).toBeInTheDocument()
  expect(screen.getByText('Join Room')).toBeInTheDocument()
  expect(screen.getByText('AI Opponents')).toBeInTheDocument()
})

test('Create Online Game creates a game and navigates to the room', async () => {
  createOnlineGame.mockResolvedValue({ gameId: 'g1', code: 'ABCDEF', mySeat: 0, players: ['Alice', 'AI 2'] })
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Alice')
  await userEvent.click(screen.getByText('Create Online Game'))
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/lobby/ABCDEF'))
  // session persisted for the waiting room / game page
  expect(sessionStorage.getItem('viota_online_session')).toContain('g1')
})

test('a create failure surfaces an error and does not navigate', async () => {
  createOnlineGame.mockRejectedValue(new Error('boom'))
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Alice')
  await userEvent.click(screen.getByText('Create Online Game'))
  await waitFor(() => expect(screen.getByText(/Cannot reach server/)).toBeInTheDocument())
  expect(mockNavigate).not.toHaveBeenCalled()
})

test('Join Room surfaces the deferred-endpoint message', async () => {
  joinOnlineGame.mockRejectedValue(new Error('join-by-code is not available yet (needs the Worker ...)'))
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Bob')
  await userEvent.type(screen.getByPlaceholderText('Room code'), 'ABCDEF')
  await userEvent.click(screen.getByText('Join Room'))
  await waitFor(() => expect(screen.getByText(/not available yet/)).toBeInTheDocument())
})
