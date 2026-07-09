import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }))
vi.mock('../store/gameStore', () => ({ useGameStore: (sel: any) => sel({ startGame: vi.fn() }) }))
vi.mock('../components/ResumeStrip', () => ({ default: () => null }))

import Home from './Home'

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
