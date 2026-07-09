import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import HowToPlayModal from './HowToPlayModal'

test('shows a visible placeholder and closes', async () => {
  const onClose = vi.fn()
  render(<HowToPlayModal open onClose={onClose} />)
  expect(screen.getByText(/rules coming soon/i)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /close/i }))
  expect(onClose).toHaveBeenCalledOnce()
})

test('returns null when closed', () => {
  const { container } = render(<HowToPlayModal open={false} onClose={() => {}} />)
  expect(container.firstChild).toBeNull()
})

test('pressing Escape calls onClose', async () => {
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(<HowToPlayModal open onClose={onClose} />)
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledOnce()
})
