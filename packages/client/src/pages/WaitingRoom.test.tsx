import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import WaitingRoom from './WaitingRoom'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ code: 'ABCD' }),
  }
})

vi.mock('../net/connection', () => ({
  createConnection: () => ({
    send: vi.fn(),
    close: vi.fn(),
    onMessage: vi.fn(),
    onStatusChange: vi.fn(),
    status: () => 'connected',
  }),
}))

beforeEach(() => {
  sessionStorage.setItem('viota_token', 'jwt123')
  sessionStorage.setItem('viota_room', 'ABCD')
  sessionStorage.setItem('viota_name', 'Alice')
  sessionStorage.setItem('viota_playerIndex', '0')
})

test('renders room code prominently', () => {
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  expect(screen.getByText('ABCD')).toBeInTheDocument()
})

test('renders waiting message', () => {
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  expect(screen.getByText(/waiting/i)).toBeInTheDocument()
})

test('host sees Start Game button', () => {
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  expect(screen.getByText('Start Game')).toBeInTheDocument()
})

test('renders disconnect timeout selector for host', () => {
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  expect(screen.getByText('2min')).toBeInTheDocument()
})
