import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { vi } from 'vitest'
import { useModalDismiss } from './useModalDismiss'

function Harness({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null)
  useModalDismiss(open, onClose, cardRef)
  if (!open) return null
  return (
    <div ref={cardRef} tabIndex={-1} data-testid="card">
      <button>first</button>
      <button>last</button>
    </div>
  )
}

test('Escape calls onClose when open', async () => {
  const onClose = vi.fn()
  render(<Harness open onClose={onClose} />)
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('Escape does nothing when closed', async () => {
  const onClose = vi.fn()
  render(<Harness open={false} onClose={onClose} />)
  await userEvent.keyboard('{Escape}')
  expect(onClose).not.toHaveBeenCalled()
})

test('opening moves focus into the card (or a focusable descendant)', () => {
  const onClose = vi.fn()
  render(<Harness open onClose={onClose} />)
  const card = screen.getByTestId('card')
  expect(card.contains(document.activeElement)).toBe(true)
})

test('closing restores focus to the trigger that was focused before opening', () => {
  const trigger = document.createElement('button')
  document.body.appendChild(trigger)
  trigger.focus()

  const onClose = vi.fn()
  const { rerender } = render(<Harness open={false} onClose={onClose} />)
  rerender(<Harness open onClose={onClose} />)
  expect(screen.getByTestId('card').contains(document.activeElement)).toBe(true)

  rerender(<Harness open={false} onClose={onClose} />)
  expect(document.activeElement).toBe(trigger)

  document.body.removeChild(trigger)
})
