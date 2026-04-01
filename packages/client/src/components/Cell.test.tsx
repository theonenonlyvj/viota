import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import Cell from './Cell'

test('valid cell has green dashed border and calls onPlace when clicked', async () => {
  const handlePlace = vi.fn()
  render(<Cell variant="valid" onPlace={handlePlace} />)
  const el = screen.getByTestId('valid-cell')
  expect(el.style.border).toContain('dashed')
  await userEvent.click(el)
  expect(handlePlace).toHaveBeenCalledOnce()
})

test('empty cell is dimmed and not interactive', () => {
  const { container } = render(<Cell variant="empty" />)
  const el = container.firstChild as HTMLElement
  expect(el.style.opacity).toBe('0.3')
})

test('wild cell renders card and calls onRecycle when clicked', async () => {
  const card = { kind: 'wild' as const }
  const handleRecycle = vi.fn()
  const { container } = render(<Cell variant="wild" card={card} onRecycle={handleRecycle} />)
  await userEvent.click(container.firstChild as HTMLElement)
  expect(handleRecycle).toHaveBeenCalledOnce()
})

test('wild-targeted cell has purple glow', () => {
  const card = { kind: 'wild' as const }
  render(<Cell variant="wild-targeted" card={card} />)
  const el = screen.getByText('★').closest('div[style]') as HTMLElement
  expect(el.style.boxShadow).toContain('#c084fc')
})
