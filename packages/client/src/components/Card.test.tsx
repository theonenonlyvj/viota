import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import Card from './Card'
import type { Card as CardType } from '@viota/engine'

test('regular card renders number', () => {
  const card: CardType = { kind: 'regular', color: 'red', shape: 'circle', number: 3 }
  render(<Card card={card} />)
  expect(screen.getByText('3')).toBeInTheDocument()
})

test('wild card renders star', () => {
  render(<Card card={{ kind: 'wild' }} />)
  expect(screen.getByText('★')).toBeInTheDocument()
})

test('selected card has yellow glow in boxShadow', () => {
  const card: CardType = { kind: 'regular', color: 'blue', shape: 'triangle', number: 2 }
  const { container } = render(<Card card={card} selected />)
  const el = container.firstChild as HTMLElement
  expect(el.style.boxShadow).toContain('#facc15')
})

test('onClick fires when card is clicked', async () => {
  const card: CardType = { kind: 'regular', color: 'green', shape: 'square', number: 1 }
  const handleClick = vi.fn()
  const { container } = render(<Card card={card} onClick={handleClick} />)
  await userEvent.click(container.firstChild as HTMLElement)
  expect(handleClick).toHaveBeenCalledOnce()
})
