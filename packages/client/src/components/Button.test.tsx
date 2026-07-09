import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import Button from './Button'

test('renders a real button with the label and variant class', () => {
  render(<Button variant="primary">Play vs AI</Button>)
  const btn = screen.getByRole('button', { name: 'Play vs AI' })
  expect(btn.className).toContain('viota-btn--primary')
})

test('fires onClick', async () => {
  const onClick = vi.fn()
  render(<Button variant="secondary" onClick={onClick}>Play with friends</Button>)
  await userEvent.click(screen.getByRole('button', { name: 'Play with friends' }))
  expect(onClick).toHaveBeenCalledOnce()
})
