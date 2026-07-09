import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

const navigate = vi.fn()
const startGame = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }))
vi.mock('../store/gameStore', () => ({ useGameStore: (sel: any) => sel({ startGame }) }))

import PlayVsAiModal from './PlayVsAiModal'

test('Start uses selected opponents+difficulty and navigates to the local game', async () => {
  render(<PlayVsAiModal open onClose={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: '3' }))          // 3 opponents
  await userEvent.click(screen.getByRole('button', { name: /expert/i }))    // expert
  await userEvent.click(screen.getByRole('button', { name: /^start/i }))
  expect(startGame).toHaveBeenCalledWith(4, 'expert')                       // 3 opponents + me
  expect(navigate).toHaveBeenCalledWith('/game/local')
})

test('returns null when closed', () => {
  const { container } = render(<PlayVsAiModal open={false} onClose={() => {}} />)
  expect(container.firstChild).toBeNull()
})
