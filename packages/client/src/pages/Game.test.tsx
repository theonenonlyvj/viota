import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Game from './Game'
import { useGameStore } from '../store/gameStore'

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
