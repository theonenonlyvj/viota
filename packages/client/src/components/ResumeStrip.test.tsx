import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }))
vi.mock('../net/lobby', () => ({ myGames: vi.fn() }))
vi.mock('../hooks/useLocalResumableGame', () => ({ useLocalResumableGame: vi.fn(() => null) }))
vi.mock('../net/session', () => ({ saveSession: vi.fn() }))
vi.mock('../net/identity', () => ({ getDisplayName: () => 'Me' }))
vi.mock('../net/config', () => ({ serverUrl: () => 'http://x' }))

import { myGames } from '../net/lobby'
import { useLocalResumableGame } from '../hooks/useLocalResumableGame'
import ResumeStrip from './ResumeStrip'

function renderStrip() {
  return render(<MemoryRouter><ResumeStrip /></MemoryRouter>)
}

test('renders nothing when there is no online or local game', async () => {
  ;(myGames as any).mockResolvedValue([])
  const { container } = renderStrip()
  // wait a tick for the async effect
  await Promise.resolve()
  expect(container.querySelector('.resume-strip')).toBeNull()
})

test('shows an online row and routes on click', async () => {
  ;(myGames as any).mockResolvedValue([
    { gameId: 'g1', code: 'ABC123', status: 'active', playerCount: 2, seatIndex: 0, lastActivityAt: Date.now() },
  ])
  renderStrip()
  const row = await screen.findByText(/ABC123/)
  row.closest('.resume-row')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(navigate).toHaveBeenCalledWith('/game/online')
})

test('shows a local row when the hook returns a game', async () => {
  ;(myGames as any).mockResolvedValue([])
  ;(useLocalResumableGame as any).mockReturnValue({ lastActivityAt: Date.now() })
  renderStrip()
  expect(await screen.findByText(/vs AI/i)).toBeInTheDocument()
})
