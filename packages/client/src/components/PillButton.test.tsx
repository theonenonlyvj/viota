import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import PillButton from './PillButton'

test('renders the label and reflects aria-pressed from active', () => {
  const { rerender } = render(<PillButton active={false} onClick={() => {}}>4</PillButton>)
  const btn = screen.getByRole('button', { name: '4' })
  expect(btn).toHaveAttribute('aria-pressed', 'false')

  rerender(<PillButton active onClick={() => {}}>4</PillButton>)
  expect(screen.getByRole('button', { name: '4' })).toHaveAttribute('aria-pressed', 'true')
})

test('fires onClick when clicked', async () => {
  const onClick = vi.fn()
  render(<PillButton active={false} onClick={onClick}>Wait for me</PillButton>)
  await userEvent.click(screen.getByText('Wait for me'))
  expect(onClick).toHaveBeenCalledTimes(1)
})
