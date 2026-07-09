import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import WaitingRoom from './WaitingRoom'
import { saveSession } from '../net/session'
import type { NudgeOptions } from '../net/nudge'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate, useParams: () => ({ code: 'ABCDEF' }) }
})

const fetchRoom = vi.fn()
const startRoom = vi.fn()
const leaveGame = vi.fn()
vi.mock('../net/lobby', () => ({
  fetchRoom: (...a: unknown[]) => fetchRoom(...a),
  startRoom: (...a: unknown[]) => startRoom(...a),
  leaveGame: (...a: unknown[]) => leaveGame(...a),
}))

// Capture the nudge options so tests can push frames (host_changed / started).
let nudgeOpts: NudgeOptions | null = null
vi.mock('../net/nudge', () => ({
  createNudgeChannel: (_u: string, _g: string, opts: NudgeOptions) => {
    nudgeOpts = opts
    return { close: vi.fn(), reopen: vi.fn() }
  },
}))

// A full 2-human room (no open seats) hosted by seat 0.
const hostedRoom = {
  status: 'waiting' as const,
  playerCount: 2,
  code: 'ABCDEF',
  hostSeat: 0,
  openSeats: 0,
  aiTakeoverMs: 60000,
  seats: [
    { seatIndex: 0, ownerType: 'human', displayName: 'Alice' },
    { seatIndex: 1, ownerType: 'human', displayName: 'Bob' },
  ],
}

beforeEach(() => {
  mockNavigate.mockClear()
  fetchRoom.mockReset()
  startRoom.mockReset()
  leaveGame.mockReset()
  nudgeOpts = null
  sessionStorage.clear()
  saveSession({ gameId: 'g1', code: 'ABCDEF', mySeat: 0, players: ['Alice'] })
})

test('renders the room code prominently', () => {
  fetchRoom.mockResolvedValue(hostedRoom)
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  expect(screen.getByText('ABCDEF')).toBeInTheDocument()
})

test('lists the seated players from the polled roster', async () => {
  fetchRoom.mockResolvedValue(hostedRoom)
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  expect(await screen.findByText(/Alice/)).toBeInTheDocument()
  expect(await screen.findByText('Bob')).toBeInTheDocument()
})

test('shows the host AI-takeover choice read-only', async () => {
  fetchRoom.mockResolvedValue(hostedRoom)
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  expect(await screen.findByText(/AI takeover: 1 min/)).toBeInTheDocument()
})

test('the host (mySeat === hostSeat) sees Start and can start a 2-human room', async () => {
  fetchRoom.mockResolvedValue(hostedRoom)
  startRoom.mockResolvedValue(undefined)
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  await screen.findByText('Bob')
  await userEvent.click(screen.getByText('Start Game'))
  await waitFor(() => expect(startRoom).toHaveBeenCalledWith(expect.any(String), 'g1'))
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/game/online'))
})

test('a NON-host sees the waiting message and no Start button', async () => {
  fetchRoom.mockResolvedValue({ ...hostedRoom, hostSeat: 1 }) // seat 1 is host; I am seat 0
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  expect(await screen.findByText(/Waiting for host to start/)).toBeInTheDocument()
  expect(screen.queryByText('Start Game')).not.toBeInTheDocument()
})

test('a host_changed frame flips the Start button to the promoted (now-me) host', async () => {
  fetchRoom.mockResolvedValue({ ...hostedRoom, hostSeat: 1 }) // start as non-host
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  await screen.findByText(/Waiting for host to start/)
  expect(screen.queryByText('Start Game')).not.toBeInTheDocument()

  act(() => nudgeOpts!.onHostChanged!(0)) // host role moves to my seat
  expect(await screen.findByText('Start Game')).toBeInTheDocument()
})

test('the open-seat confirm gates the start call', async () => {
  fetchRoom.mockResolvedValue({
    ...hostedRoom, openSeats: 1,
    seats: [
      { seatIndex: 0, ownerType: 'human', displayName: 'Alice' },
      { seatIndex: 1, ownerType: 'human', displayName: 'Bob' },
      { seatIndex: 2, ownerType: 'open', displayName: null },
    ],
  })
  startRoom.mockResolvedValue(undefined)
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  await screen.findByText('Bob')

  await userEvent.click(screen.getByText('Start Game'))
  expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/1 open seat/))
  expect(startRoom).not.toHaveBeenCalled() // declined -> no deal

  confirmSpy.mockReturnValue(true)
  await userEvent.click(screen.getByText('Start Game'))
  await waitFor(() => expect(startRoom).toHaveBeenCalledWith(expect.any(String), 'g1'))
  confirmSpy.mockRestore()
})

test('a not_host 403 on start surfaces a graceful message', async () => {
  fetchRoom.mockResolvedValue(hostedRoom)
  startRoom.mockRejectedValue(new Error('not_host'))
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  await screen.findByText('Bob')
  await userEvent.click(screen.getByText('Start Game'))
  expect(await screen.findByText(/no longer the host/)).toBeInTheDocument()
})

test('auto-navigates into the game once it has started (poll fallback)', async () => {
  fetchRoom.mockResolvedValue({ status: 'started' })
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/game/online'))
})

test('a started WS frame navigates into the game (snappier than the poll)', async () => {
  fetchRoom.mockResolvedValue(hostedRoom) // still "waiting" per the poll
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  await screen.findByText('Bob') // channel is wired
  expect(mockNavigate).not.toHaveBeenCalled()
  act(() => nudgeOpts!.onStarted!(0))
  expect(mockNavigate).toHaveBeenCalledWith('/game/online')
})

test('Leave notifies the server (so a departing host is promoted) before going home', async () => {
  fetchRoom.mockResolvedValue(hostedRoom)
  leaveGame.mockResolvedValue(undefined)
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  await screen.findByText('Bob')
  await userEvent.click(screen.getByText('Leave'))
  await waitFor(() => expect(leaveGame).toHaveBeenCalledWith(expect.any(String), 'g1'))
  expect(mockNavigate).toHaveBeenCalledWith('/')
})

test('Start is disabled with fewer than 2 humans', async () => {
  fetchRoom.mockResolvedValue({
    status: 'waiting', playerCount: 3, code: 'ABCDEF', hostSeat: 0, openSeats: 2, aiTakeoverMs: null,
    seats: [
      { seatIndex: 0, ownerType: 'human', displayName: 'Alice' },
      { seatIndex: 1, ownerType: 'open', displayName: null },
      { seatIndex: 2, ownerType: 'open', displayName: null },
    ],
  })
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  await screen.findByText(/Alice/)
  expect(screen.getByRole('button', { name: 'Start Game' })).toBeDisabled()
})
