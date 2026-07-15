import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, vi } from 'vitest'

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }))
vi.mock('../store/gameStore', () => ({ useGameStore: (sel: any) => sel({ startGame: vi.fn() }) }))
vi.mock('../components/ResumeStrip', () => ({ default: () => null }))
vi.mock('../components/AccountModal', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="account-modal" /> : null),
}))

let mockUsername: string | null = null
vi.mock('../net/identity', () => ({
  getUsername: () => mockUsername,
  getDisplayName: () => 'Guest99',
}))

import Home from './Home'

beforeEach(() => { mockUsername = null })

function renderHome() { return render(<MemoryRouter><Home /></MemoryRouter>) }

test('shows both CTAs and the verbatim tagline', () => {
  renderHome()
  expect(screen.getByRole('button', { name: 'Play vs AI' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Play with friends' })).toBeInTheDocument()
  expect(screen.getByText(/Match on color, shape, and number/)).toBeInTheDocument()
})

test('Play with friends navigates to the lobby', async () => {
  renderHome()
  await userEvent.click(screen.getByRole('button', { name: 'Play with friends' }))
  expect(navigate).toHaveBeenCalledWith('/lobby')
})

test('Play vs AI opens the setup modal', async () => {
  renderHome()
  await userEvent.click(screen.getByRole('button', { name: 'Play vs AI' }))
  expect(screen.getByRole('dialog', { name: /play vs ai/i })).toBeInTheDocument()
})

test('how to play opens the how-to-play modal', async () => {
  renderHome()
  await userEvent.click(screen.getByRole('button', { name: /how to play/i }))
  expect(screen.getByRole('dialog', { name: /how to play/i })).toBeInTheDocument()
})

test('practice link navigates to /practice', async () => {
  renderHome()
  await userEvent.click(screen.getByRole('button', { name: /^practice$/i }))
  expect(navigate).toHaveBeenCalledWith('/practice')
})

test('leaderboard link navigates to /leaderboard', async () => {
  renderHome()
  await userEvent.click(screen.getByRole('button', { name: /^leaderboard$/i }))
  expect(navigate).toHaveBeenCalledWith('/leaderboard')
})

test('your stats link navigates to /stats', async () => {
  renderHome()
  await userEvent.click(screen.getByRole('button', { name: /^your stats$/i }))
  expect(navigate).toHaveBeenCalledWith('/stats')
})

test('the account entry shows the guest display name + a claim nudge when unclaimed', () => {
  mockUsername = null
  renderHome()
  const btn = screen.getByRole('button', { name: /^account/i })
  expect(btn).toHaveTextContent('Guest99')
  expect(screen.getByText(/create account to save/i)).toBeInTheDocument()
})

test('the account entry shows the claimed username with no nudge once claimed', () => {
  mockUsername = 'vijay'
  renderHome()
  const btn = screen.getByRole('button', { name: /^account/i })
  expect(btn).toHaveTextContent('vijay')
  expect(screen.queryByText(/create account to save/i)).toBeNull()
})

test('clicking the account entry opens the account modal', async () => {
  renderHome()
  expect(screen.queryByTestId('account-modal')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: /^account/i }))
  expect(screen.getByTestId('account-modal')).toBeInTheDocument()
})
