import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }))
vi.mock('../net/config', () => ({ serverUrl: () => 'http://sv' }))
vi.mock('../net/leaderboard', () => ({ fetchLeaderboard: vi.fn() }))
vi.mock('../net/identity', () => ({ getAccountId: vi.fn() }))

import { fetchLeaderboard } from '../net/leaderboard'
import { getAccountId } from '../net/identity'
import Leaderboard from './Leaderboard'

const ROWS = [
  { accountId: 'acc-1', displayName: 'Alice', username: 'alice', value: 0.75, games: 8 },
  { accountId: 'acc-2', displayName: 'Bob', username: null, value: 0.5, games: 6 },
]

function mockBoard(rows: typeof ROWS = ROWS, board = 'winrate-friends') {
  ;(fetchLeaderboard as any).mockResolvedValue({ board, rows })
}

function renderPage() {
  return render(<MemoryRouter><Leaderboard /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getAccountId as any).mockReturnValue(null)
})
afterEach(() => vi.clearAllMocks())

test('renders all three sections with their board tabs', async () => {
  mockBoard()
  renderPage()
  await screen.findByText('alice')

  expect(within(screen.getByTestId('board-section-vs-friends')).getByRole('button', { name: 'Win rate' })).toBeInTheDocument()
  expect(within(screen.getByTestId('board-section-vs-friends')).getByRole('button', { name: 'Wins' })).toBeInTheDocument()
  expect(within(screen.getByTestId('board-section-vs-friends')).getByRole('button', { name: 'Streak' })).toBeInTheDocument()
  expect(within(screen.getByTestId('board-section-vs-ai')).getByRole('button', { name: 'Win rate' })).toBeInTheDocument()
  expect(within(screen.getByTestId('board-section-vs-ai')).getByRole('button', { name: 'Wins' })).toBeInTheDocument()
  expect(within(screen.getByTestId('board-section-high-scores')).getByRole('button', { name: 'Best play' })).toBeInTheDocument()
  expect(within(screen.getByTestId('board-section-high-scores')).getByRole('button', { name: 'Best game' })).toBeInTheDocument()
})

test('loads the default board on mount and renders ranked rows (name/value/games)', async () => {
  mockBoard()
  renderPage()

  expect(await screen.findByText('alice')).toBeInTheDocument()
  expect(fetchLeaderboard).toHaveBeenCalledWith('http://sv', 'winrate-friends')

  const rows = screen.getAllByTestId('leaderboard-row')
  expect(rows).toHaveLength(2)
  expect(within(rows[0]!).getByText('alice')).toBeInTheDocument()
  expect(within(rows[0]!).getByText('75%')).toBeInTheDocument()
  expect(within(rows[0]!).getByText('8 games')).toBeInTheDocument()
  // Bob has no username -> falls back to display name
  expect(within(rows[1]!).getByText('Bob')).toBeInTheDocument()
})

test('switching to a different board tab re-fetches and renders its rows', async () => {
  mockBoard()
  renderPage()
  await screen.findByText('alice')

  ;(fetchLeaderboard as any).mockResolvedValue({
    board: 'wins-ai',
    rows: [{ accountId: 'acc-3', displayName: 'Carol', username: null, value: 12, games: 20 }],
  })
  fireEvent.click(within(screen.getByTestId('board-section-vs-ai')).getByRole('button', { name: 'Wins' }))

  expect(await screen.findByText('Carol')).toBeInTheDocument()
  expect(fetchLeaderboard).toHaveBeenLastCalledWith('http://sv', 'wins-ai')
})

test("highlights the current user's row", async () => {
  ;(getAccountId as any).mockReturnValue('acc-2')
  mockBoard()
  renderPage()
  await screen.findByText('alice')

  const rows = screen.getAllByTestId('leaderboard-row')
  expect(rows[0]).not.toHaveAttribute('aria-current')
  expect(rows[1]).toHaveAttribute('aria-current', 'true')
})

test('shows empty-state copy when a board has no qualifying rows', async () => {
  mockBoard([])
  renderPage()
  expect(await screen.findByText(/5\+ games vs friends/i)).toBeInTheDocument()
})

test('shows a friendly error state when the fetch fails', async () => {
  ;(fetchLeaderboard as any).mockRejectedValue(new Error('boom'))
  renderPage()
  expect(await screen.findByText(/could not load/i)).toBeInTheDocument()
})

test('Back to menu navigates home', async () => {
  mockBoard()
  renderPage()
  await screen.findByText('alice')
  fireEvent.click(screen.getByRole('button', { name: /back to menu/i }))
  expect(navigate).toHaveBeenCalledWith('/')
})
