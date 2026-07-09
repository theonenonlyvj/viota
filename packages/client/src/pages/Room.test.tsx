import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi } from 'vitest'

const loadSession = vi.fn()
vi.mock('../net/session', () => ({ loadSession: () => loadSession() }))
vi.mock('./WaitingRoom', () => ({ default: () => <div>waiting-room</div> }))
vi.mock('../components/JoinRoom', () => ({ default: ({ code }: { code: string }) => <div>join {code}</div> }))

import Room from './Room'

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/lobby/:code" element={<Room />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => loadSession.mockReset())

test('shows the waiting room when the session is for this room', () => {
  loadSession.mockReturnValue({ gameId: 'g1', code: 'ABC123', mySeat: 0, players: ['me'] })
  at('/lobby/ABC123')
  expect(screen.getByText('waiting-room')).toBeInTheDocument()
})

test('shows the join card (with the code) when there is no session', () => {
  loadSession.mockReturnValue(null)
  at('/lobby/ABC123')
  expect(screen.getByText(/join ABC123/i)).toBeInTheDocument()
})

test('shows the join card when the session is for a different room', () => {
  loadSession.mockReturnValue({ gameId: 'g2', code: 'ZZZ999', mySeat: 0, players: ['me'] })
  at('/lobby/ABC123')
  expect(screen.getByText(/join ABC123/i)).toBeInTheDocument()
})
