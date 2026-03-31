import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Home from './Home'
import { useGameStore } from '../store/gameStore'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

beforeEach(() => {
  mockNavigate.mockClear()
  useGameStore.getState().startGame(2, 'easy')
})

test('Home page renders title', () => {
  render(<MemoryRouter><Home /></MemoryRouter>)
  expect(screen.getByText('Viota')).toBeInTheDocument()
})

test('renders opponent count buttons 1, 2, 3', () => {
  render(<MemoryRouter><Home /></MemoryRouter>)
  expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '3' })).toBeInTheDocument()
})

test('renders Easy and Expert difficulty buttons', () => {
  render(<MemoryRouter><Home /></MemoryRouter>)
  expect(screen.getByRole('button', { name: 'Easy' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Expert' })).toBeInTheDocument()
})

test('Start Game calls startGame and navigates to /game/local', async () => {
  render(<MemoryRouter><Home /></MemoryRouter>)
  await userEvent.click(screen.getByText('Start Game'))
  expect(useGameStore.getState().playerCount).toBe(2)
  expect(useGameStore.getState().difficulty).toBe('easy')
  expect(mockNavigate).toHaveBeenCalledWith('/game/local')
})

test('selecting 3 opponents sets playerCount to 4 on start', async () => {
  render(<MemoryRouter><Home /></MemoryRouter>)
  await userEvent.click(screen.getByRole('button', { name: '3' }))
  await userEvent.click(screen.getByText('Start Game'))
  expect(useGameStore.getState().playerCount).toBe(4)
})

test('selecting Expert sets difficulty to expert on start', async () => {
  render(<MemoryRouter><Home /></MemoryRouter>)
  await userEvent.click(screen.getByRole('button', { name: 'Expert' }))
  await userEvent.click(screen.getByText('Start Game'))
  expect(useGameStore.getState().difficulty).toBe('expert')
})
