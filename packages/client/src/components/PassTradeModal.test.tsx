import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import PassTradeModal from './PassTradeModal'
import type { Card } from '@viota/engine'

const hand: Card[] = [
  { kind: 'regular', color: 'red', shape: 'circle', number: 1 },
  { kind: 'regular', color: 'blue', shape: 'triangle', number: 2 },
  { kind: 'regular', color: 'green', shape: 'square', number: 3 },
  { kind: 'wild' },
]

test('renders all 4 hand cards', () => {
  render(<PassTradeModal hand={hand} onConfirm={vi.fn()} onClose={vi.fn()} />)
  expect(screen.getByText('1')).toBeInTheDocument()
  expect(screen.getByText('2')).toBeInTheDocument()
  expect(screen.getByText('3')).toBeInTheDocument()
  expect(screen.getByText('★')).toBeInTheDocument()
})

test('clicking a card selects it (shows in trade order row)', async () => {
  render(<PassTradeModal hand={hand} onConfirm={vi.fn()} onClose={vi.fn()} />)
  await userEvent.click(screen.getByText('1').closest('[data-testid="hand-card"]')!)
  expect(screen.getByTestId('trade-order-row')).toBeInTheDocument()
})

test('Confirm Pass calls onConfirm with selected cards', async () => {
  const handleConfirm = vi.fn()
  render(<PassTradeModal hand={hand} onConfirm={handleConfirm} onClose={vi.fn()} />)
  await userEvent.click(screen.getByText('1').closest('[data-testid="hand-card"]')!)
  await userEvent.click(screen.getByText('Confirm Pass'))
  expect(handleConfirm).toHaveBeenCalledOnce()
  const [trades] = handleConfirm.mock.calls[0]!
  expect(trades).toHaveLength(1)
  expect(trades[0]).toEqual(hand[0])
})

test('Cancel button calls onClose', async () => {
  const handleClose = vi.fn()
  render(<PassTradeModal hand={hand} onConfirm={vi.fn()} onClose={handleClose} />)
  await userEvent.click(screen.getByText('Cancel'))
  expect(handleClose).toHaveBeenCalledOnce()
})

test('confirming with no cards selected passes empty arrays', async () => {
  const handleConfirm = vi.fn()
  render(<PassTradeModal hand={hand} onConfirm={handleConfirm} onClose={vi.fn()} />)
  await userEvent.click(screen.getByText('Confirm Pass'))
  expect(handleConfirm).toHaveBeenCalledWith([], [])
})
