import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import HowToPlayModal from './HowToPlayModal'

test('renders the real rules content and closes', async () => {
  const onClose = vi.fn()
  render(<HowToPlayModal open onClose={onClose} />)
  expect(screen.getByText(/what is a line/i)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /^close$/i }))
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

test('is ephemeral — writes nothing to localStorage', () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  render(<HowToPlayModal open onClose={() => {}} />)
  expect(setItem).not.toHaveBeenCalled()
  setItem.mockRestore()
})
