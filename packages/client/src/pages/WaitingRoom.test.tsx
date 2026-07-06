import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import WaitingRoom from './WaitingRoom'
import { saveSession } from '../net/session'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ code: 'ABCDEF' }),
  }
})

beforeEach(() => {
  mockNavigate.mockClear()
  sessionStorage.clear()
  saveSession({ gameId: 'g1', code: 'ABCDEF', mySeat: 0, players: ['Alice', 'AI 2'] })
})

test('renders the room code prominently', () => {
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  expect(screen.getByText('ABCDEF')).toBeInTheDocument()
})

test('lists the seated players', () => {
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  expect(screen.getByText(/Alice/)).toBeInTheDocument()
  expect(screen.getByText('AI 2')).toBeInTheDocument()
})

test('Start Game navigates to the online game', async () => {
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  await userEvent.click(screen.getByText('Start Game'))
  expect(mockNavigate).toHaveBeenCalledWith('/game/online')
})
