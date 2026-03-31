import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import Hand from './Hand'
import type { Card, Placement } from '@viota/engine'

const hand: Card[] = [
  { kind: 'regular', color: 'red', shape: 'circle', number: 1 },
  { kind: 'regular', color: 'blue', shape: 'triangle', number: 2 },
  { kind: 'regular', color: 'green', shape: 'square', number: 3 },
  { kind: 'wild' },
]

test('renders all 4 hand cards', () => {
  render(<Hand hand={hand} selectedCard={null} staged={[]} onSelectCard={vi.fn()} />)
  expect(screen.getByText('1')).toBeInTheDocument()
  expect(screen.getByText('2')).toBeInTheDocument()
  expect(screen.getByText('3')).toBeInTheDocument()
  expect(screen.getByText('★')).toBeInTheDocument()
})

test('staged card is dimmed (opacity 0.3)', () => {
  const staged: Placement[] = [{ card: hand[0]!, position: { x: 0, y: 0 } }]
  const { container } = render(<Hand hand={hand} selectedCard={null} staged={staged} onSelectCard={vi.fn()} />)
  const wrappers = container.querySelectorAll('[style*="opacity"]')
  const dimmed = [...wrappers].filter(el => (el as HTMLElement).style.opacity === '0.3')
  expect(dimmed).toHaveLength(1)
})

test('calls onSelectCard with correct card when non-staged card clicked', async () => {
  const handleSelect = vi.fn()
  render(<Hand hand={hand} selectedCard={null} staged={[]} onSelectCard={handleSelect} />)
  await userEvent.click(screen.getByText('1').closest('div')!)
  expect(handleSelect).toHaveBeenCalledWith(hand[0])
})
