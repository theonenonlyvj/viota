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

test('glow prop applies purple boxShadow', () => {
  const card: CardType = { kind: 'regular', color: 'red', shape: 'circle', number: 2 }
  const { container } = render(<Card card={card} glow="purple" />)
  const el = container.firstChild as HTMLElement
  expect(el.style.boxShadow).toContain('#c084fc')
})

test('glow prop on wild card applies purple boxShadow', () => {
  const { container } = render(<Card card={{ kind: 'wild' }} glow="purple" />)
  const el = container.firstChild as HTMLElement
  expect(el.style.boxShadow).toContain('#c084fc')
})

test('rotation prop counter-rotates the card so it stays upright', () => {
  const card: CardType = { kind: 'regular', color: 'red', shape: 'circle', number: 3 }
  const { container } = render(<Card card={card} rotation={90} />)
  const el = container.firstChild as HTMLElement
  expect(el.style.transform).toContain('rotate(-90deg)')
})

test('rotation prop counter-rotates at 180 and 270 too', () => {
  const card: CardType = { kind: 'regular', color: 'blue', shape: 'square', number: 5 }
  const r180 = render(<Card card={card} rotation={180} />)
  expect((r180.container.firstChild as HTMLElement).style.transform).toContain('rotate(-180deg)')
  r180.unmount()
  const r270 = render(<Card card={card} rotation={270} />)
  expect((r270.container.firstChild as HTMLElement).style.transform).toContain('rotate(-270deg)')
})

test('no rotation prop (or 0) leaves the card unrotated', () => {
  const card: CardType = { kind: 'regular', color: 'green', shape: 'plus', number: 1 }
  const { container } = render(<Card card={card} />)
  const el = container.firstChild as HTMLElement
  expect(el.style.transform).not.toContain('rotate(-90deg)')
  expect(el.style.transform).not.toContain('rotate(-180deg)')
  expect(el.style.transform).not.toContain('rotate(-270deg)')
})

test('rotation counter-rotates a wild card too', () => {
  const { container } = render(<Card card={{ kind: 'wild' }} rotation={270} />)
  const el = container.firstChild as HTMLElement
  expect(el.style.transform).toContain('rotate(-270deg)')
})
