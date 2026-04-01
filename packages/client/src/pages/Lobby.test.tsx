import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Lobby from './Lobby'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

global.fetch = vi.fn()

beforeEach(() => {
  mockNavigate.mockClear()
  ;(fetch as ReturnType<typeof vi.fn>).mockClear()
})

test('renders create and join sections', () => {
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  expect(screen.getByText('Create Room')).toBeInTheDocument()
  expect(screen.getByText('Join Room')).toBeInTheDocument()
})

test('renders name input', () => {
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument()
})

test('Create Room posts to server and navigates', async () => {
  ;(fetch as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 'ABCD' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'jwt123', playerIndex: 0 }) })

  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Alice')
  await userEvent.click(screen.getByText('Create Room'))
  expect(mockNavigate).toHaveBeenCalledWith('/lobby/ABCD')
})

test('Join Room posts to server and navigates', async () => {
  ;(fetch as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'jwt456', playerIndex: 1 }) })

  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Bob')
  await userEvent.type(screen.getByPlaceholderText('Room code'), 'ABCD')
  await userEvent.click(screen.getByText('Join Room'))
  expect(mockNavigate).toHaveBeenCalledWith('/lobby/ABCD')
})
