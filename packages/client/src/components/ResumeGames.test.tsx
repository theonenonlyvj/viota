import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import ResumeGames from './ResumeGames'
import { loadSession } from '../net/session'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const myGames = vi.fn()
vi.mock('../net/lobby', () => ({ myGames: (...a: unknown[]) => myGames(...a) }))

beforeEach(() => {
  mockNavigate.mockClear()
  myGames.mockReset()
  sessionStorage.clear()
})

test('renders nothing when there are no resumable games', async () => {
  myGames.mockResolvedValue([])
  const { container } = render(<MemoryRouter><ResumeGames /></MemoryRouter>)
  await waitFor(() => expect(myGames).toHaveBeenCalled())
  expect(container.textContent).not.toMatch(/saved games/)
})

test('lists resumable games (code + status + seat)', async () => {
  myGames.mockResolvedValue([
    { gameId: 'g-a', code: 'AAA', status: 'active', playerCount: 2, seatIndex: 1, lastActivityAt: Date.now() },
  ])
  render(<MemoryRouter><ResumeGames /></MemoryRouter>)
  expect(await screen.findByText('AAA')).toBeInTheDocument()
  expect(screen.getByText(/in play/)).toBeInTheDocument()
})

test('selecting an ACTIVE game saves the session and routes to the game', async () => {
  myGames.mockResolvedValue([
    { gameId: 'g-a', code: 'AAA', status: 'active', playerCount: 2, seatIndex: 1, lastActivityAt: Date.now() },
  ])
  render(<MemoryRouter><ResumeGames /></MemoryRouter>)
  await userEvent.click(await screen.findByText('AAA'))
  expect(loadSession()).toMatchObject({ gameId: 'g-a', code: 'AAA', mySeat: 1 })
  expect(mockNavigate).toHaveBeenCalledWith('/game/online')
})

test('selecting a WAITING game routes back to its room', async () => {
  myGames.mockResolvedValue([
    { gameId: 'g-w', code: 'WWW', status: 'waiting', playerCount: 3, seatIndex: 0, lastActivityAt: Date.now() },
  ])
  render(<MemoryRouter><ResumeGames /></MemoryRouter>)
  await userEvent.click(await screen.findByText('WWW'))
  expect(loadSession()).toMatchObject({ gameId: 'g-w', mySeat: 0 })
  expect(mockNavigate).toHaveBeenCalledWith('/lobby/WWW')
})
