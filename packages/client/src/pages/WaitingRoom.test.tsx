import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import WaitingRoom from './WaitingRoom'
import { saveSession } from '../net/session'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate, useParams: () => ({ code: 'ABCDEF' }) }
})

const fetchRoom = vi.fn()
const startRoom = vi.fn()
vi.mock('../net/lobby', () => ({
  fetchRoom: (...a: unknown[]) => fetchRoom(...a),
  startRoom: (...a: unknown[]) => startRoom(...a),
}))

const twoHumans = {
  status: 'waiting' as const,
  playerCount: 3,
  code: 'ABCDEF',
  seats: [
    { seatIndex: 0, ownerType: 'human', displayName: 'Alice' },
    { seatIndex: 1, ownerType: 'human', displayName: 'Bob' },
    { seatIndex: 2, ownerType: 'open', displayName: null },
  ],
}

beforeEach(() => {
  mockNavigate.mockClear()
  fetchRoom.mockReset()
  startRoom.mockReset()
  sessionStorage.clear()
  saveSession({ gameId: 'g1', code: 'ABCDEF', mySeat: 0, players: ['Alice'] })
})

test('renders the room code prominently', () => {
  fetchRoom.mockResolvedValue(twoHumans)
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  expect(screen.getByText('ABCDEF')).toBeInTheDocument()
})

test('lists the seated players from the polled roster', async () => {
  fetchRoom.mockResolvedValue(twoHumans)
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  expect(await screen.findByText(/Alice/)).toBeInTheDocument()
  expect(await screen.findByText('Bob')).toBeInTheDocument()
})

test('Start Game (>=2 humans) starts the room and navigates to the game', async () => {
  fetchRoom.mockResolvedValue(twoHumans)
  startRoom.mockResolvedValue(undefined)
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  await screen.findByText('Bob') // wait for the roster (enables Start)
  await userEvent.click(screen.getByText('Start Game'))
  await waitFor(() => expect(startRoom).toHaveBeenCalledWith(expect.any(String), 'g1'))
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/game/online'))
})

test('auto-navigates into the game once it has started', async () => {
  fetchRoom.mockResolvedValue({ status: 'started' })
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/game/online'))
})

test('Start is disabled with fewer than 2 humans', async () => {
  fetchRoom.mockResolvedValue({
    status: 'waiting', playerCount: 3, code: 'ABCDEF',
    seats: [
      { seatIndex: 0, ownerType: 'human', displayName: 'Alice' },
      { seatIndex: 1, ownerType: 'open', displayName: null },
      { seatIndex: 2, ownerType: 'open', displayName: null },
    ],
  })
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  await screen.findByText(/Alice/)
  expect(screen.getByText('Start Game')).toBeDisabled()
})
