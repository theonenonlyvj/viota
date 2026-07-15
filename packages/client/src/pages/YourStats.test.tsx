import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }))
vi.mock('../net/config', () => ({ serverUrl: () => 'http://sv' }))
vi.mock('../net/leaderboard', () => ({ fetchMyStats: vi.fn() }))
vi.mock('../components/AccountModal', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="account-modal" /> : null),
}))

let mockUsername: string | null = null
vi.mock('../net/identity', () => ({ getUsername: () => mockUsername }))

import { fetchMyStats } from '../net/leaderboard'
import YourStats from './YourStats'

const STATS = {
  games: 10,
  vsFriends: { games: 6, wins: 4, winRate: 0.6667, streak: 3 },
  vsAI: { games: 4, wins: 3, winRate: 0.75 },
  bestPlay: 20,
  bestGame: 55,
  playerSince: Date.UTC(2026, 0, 15),
  lastPlayed: Date.UTC(2026, 6, 10),
  byPlayerCount: { '2': 5, '3': 3, '4': 2 },
  totalTimeMs: 5_400_000, // 90 minutes
}

function renderPage() {
  return render(<MemoryRouter><YourStats /></MemoryRouter>)
}

beforeEach(() => { vi.clearAllMocks(); mockUsername = null })
afterEach(() => vi.clearAllMocks())

test('shows a loading state before the fetch resolves', () => {
  ;(fetchMyStats as any).mockReturnValue(new Promise(() => {})) // never resolves
  renderPage()
  expect(screen.getByText(/loading/i)).toBeInTheDocument()
})

test('renders the full stats breakdown once /me/stats resolves', async () => {
  ;(fetchMyStats as any).mockResolvedValue(STATS)
  renderPage()

  const overview = await screen.findByTestId('stats-overview')
  expect(within(overview).getByText('10')).toBeInTheDocument()
  expect(within(overview).getByText('2026-01-15')).toBeInTheDocument()
  expect(within(overview).getByText('2026-07-10')).toBeInTheDocument()
  expect(within(overview).getByText('1h 30m')).toBeInTheDocument()

  const friends = screen.getByTestId('stats-vs-friends')
  expect(within(friends).getByText('6')).toBeInTheDocument()
  expect(within(friends).getByText('4')).toBeInTheDocument()
  expect(within(friends).getByText('67%')).toBeInTheDocument()
  expect(within(friends).getByText('3')).toBeInTheDocument() // streak

  const ai = screen.getByTestId('stats-vs-ai')
  expect(within(ai).getByText('4')).toBeInTheDocument()
  expect(within(ai).getByText('3')).toBeInTheDocument()
  expect(within(ai).getByText('75%')).toBeInTheDocument()

  const high = screen.getByTestId('stats-high-scores')
  expect(within(high).getByText('20')).toBeInTheDocument()
  expect(within(high).getByText('55')).toBeInTheDocument()

  const byCount = screen.getByTestId('stats-by-player-count')
  expect(within(byCount).getByText('5')).toBeInTheDocument()
  expect(within(byCount).getByText('3')).toBeInTheDocument()
  expect(within(byCount).getByText('2')).toBeInTheDocument()
})

test('shows a friendly empty state when /me/stats resolves null (ghost/not-logged-in)', async () => {
  ;(fetchMyStats as any).mockResolvedValue(null)
  renderPage()

  expect(await screen.findByText(/no stats yet/i)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /play with friends/i }))
  expect(navigate).toHaveBeenCalledWith('/lobby')
})

test('a fetch failure (rejected promise) resolves to the friendly empty state, not an infinite spinner', async () => {
  // fetchMyStats itself never throws (see net/leaderboard.ts) — this guards
  // the page defensively in case that contract ever changes.
  ;(fetchMyStats as any).mockRejectedValue(new Error('boom'))
  renderPage()
  expect(await screen.findByText(/no stats yet/i)).toBeInTheDocument()
})

test('Back to menu navigates home', async () => {
  ;(fetchMyStats as any).mockResolvedValue(STATS)
  renderPage()
  await screen.findByTestId('stats-overview')
  fireEvent.click(screen.getByRole('button', { name: /back to menu/i }))
  expect(navigate).toHaveBeenCalledWith('/')
})

test('shows the claim CTA in the empty state when no username is claimed', async () => {
  mockUsername = null
  ;(fetchMyStats as any).mockResolvedValue(null)
  renderPage()
  await screen.findByText(/no stats yet/i)
  expect(screen.getByRole('button', { name: /claim your name/i })).toBeInTheDocument()
})

test('shows the claim CTA in the populated state when no username is claimed', async () => {
  mockUsername = null
  ;(fetchMyStats as any).mockResolvedValue(STATS)
  renderPage()
  await screen.findByTestId('stats-overview')
  expect(screen.getByRole('button', { name: /claim your name/i })).toBeInTheDocument()
})

test('hides the claim CTA in both empty and populated states once a username is claimed', async () => {
  mockUsername = 'vijay'

  ;(fetchMyStats as any).mockResolvedValue(null)
  const { unmount } = renderPage()
  await screen.findByText(/no stats yet/i)
  expect(screen.queryByRole('button', { name: /claim your name/i })).toBeNull()
  unmount()

  ;(fetchMyStats as any).mockResolvedValue(STATS)
  renderPage()
  await screen.findByTestId('stats-overview')
  expect(screen.queryByRole('button', { name: /claim your name/i })).toBeNull()
})

test('clicking the claim CTA mounts the account modal', async () => {
  mockUsername = null
  ;(fetchMyStats as any).mockResolvedValue(STATS)
  renderPage()
  await screen.findByTestId('stats-overview')
  expect(screen.queryByTestId('account-modal')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /claim your name/i }))
  expect(screen.getByTestId('account-modal')).toBeInTheDocument()
})
