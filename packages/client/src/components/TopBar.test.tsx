import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import TopBar from './TopBar'

const defaultProps = {
  scores: [3, 7],
  drawPileCount: 42,
  playerCount: 2,
  humanIndex: 0,
  difficulty: 'easy' as const,
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onAutoFit: vi.fn(),
  onRotateCW: vi.fn(),
  onRotateCCW: vi.fn(),
}

test('renders human score', () => {
  render(<TopBar {...defaultProps} />)
  expect(screen.getByText('3')).toBeInTheDocument()
})

test('renders AI score', () => {
  render(<TopBar {...defaultProps} />)
  expect(screen.getByText('7')).toBeInTheDocument()
})

test('renders draw pile count', () => {
  render(<TopBar {...defaultProps} />)
  expect(screen.getByText('42')).toBeInTheDocument()
})

test('zoom in button calls onZoomIn', async () => {
  const onZoomIn = vi.fn()
  render(<TopBar {...defaultProps} onZoomIn={onZoomIn} />)
  await userEvent.click(screen.getByLabelText('zoom in'))
  expect(onZoomIn).toHaveBeenCalledOnce()
})

test('zoom out button calls onZoomOut', async () => {
  const onZoomOut = vi.fn()
  render(<TopBar {...defaultProps} onZoomOut={onZoomOut} />)
  await userEvent.click(screen.getByLabelText('zoom out'))
  expect(onZoomOut).toHaveBeenCalledOnce()
})
