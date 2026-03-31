import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { vi } from 'vitest'
import Board, { type BoardHandle } from './Board'
import { useGameStore } from '../store/gameStore'

function Wrapper() {
  const ref = useRef<BoardHandle>(null)
  return <Board ref={ref} />
}

beforeEach(() => {
  useGameStore.getState().startGame(2, 'easy')
})

test('renders without crashing', () => {
  const { container } = render(<Wrapper />)
  expect(container.firstChild).toBeInTheDocument()
})

test('valid cell is rendered after selectCard', () => {
  const card = useGameStore.getState().hands[0]![0]!
  act(() => useGameStore.getState().selectCard(card))
  render(<Wrapper />)
  expect(screen.getAllByTestId('valid-cell').length).toBeGreaterThan(0)
})

test('clicking valid cell triggers placeCard in store', async () => {
  const card = useGameStore.getState().hands[0]![0]!
  act(() => useGameStore.getState().selectCard(card))
  render(<Wrapper />)
  const validCell = screen.getAllByTestId('valid-cell')[0]!
  await userEvent.click(validCell)
  expect(useGameStore.getState().staged).toHaveLength(1)
})
