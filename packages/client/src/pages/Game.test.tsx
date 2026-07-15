import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Game from './Game'
import { useGameStore } from '../store/gameStore'

vi.mock('../components/AccountModal', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="account-modal" /> : null),
}))

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
}

beforeEach(() => {
  useGameStore.getState().startGame(2, 'easy')
  vi.stubGlobal('Worker', MockWorker)
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

test('renders without crashing', () => {
  render(<MemoryRouter><Game /></MemoryRouter>)
  expect(screen.getByText('Confirm Play')).toBeInTheDocument()
})

test('Confirm Play button is disabled when nothing is staged', () => {
  render(<MemoryRouter><Game /></MemoryRouter>)
  const btn = screen.getByText('Confirm Play').closest('button')!
  expect(btn.disabled).toBe(true)
})

test('Pass / Trade button opens modal', async () => {
  render(<MemoryRouter><Game /></MemoryRouter>)
  await userEvent.click(screen.getByText('Pass / Trade'))
  expect(screen.getByText('Confirm Pass')).toBeInTheDocument()
})

test('game-over state shows Play Again button', () => {
  render(<MemoryRouter><Game /></MemoryRouter>)
  act(() => useGameStore.setState({ phase: 'game-over' }))
  expect(screen.getByText('Play Again')).toBeInTheDocument()
})

test('game-over shows the claim CTA when no username is claimed', () => {
  render(<MemoryRouter><Game /></MemoryRouter>)
  act(() => useGameStore.setState({ phase: 'game-over' }))
  expect(screen.getByRole('button', { name: /save this win/i })).toBeInTheDocument()
})

test('game-over hides the claim CTA once a username is claimed', () => {
  localStorage.setItem('viota_username', 'vijay')
  render(<MemoryRouter><Game /></MemoryRouter>)
  act(() => useGameStore.setState({ phase: 'game-over' }))
  expect(screen.queryByRole('button', { name: /save this win/i })).toBeNull()
})

test('clicking the game-over claim CTA opens the account modal', async () => {
  render(<MemoryRouter><Game /></MemoryRouter>)
  act(() => useGameStore.setState({ phase: 'game-over' }))
  expect(screen.queryByTestId('account-modal')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: /save this win/i }))
  expect(screen.getByTestId('account-modal')).toBeInTheDocument()
})
