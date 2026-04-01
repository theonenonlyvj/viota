import { render, screen, act } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import OnlineGame from './OnlineGame'
import { useGameStore } from '../store/gameStore'

beforeEach(() => {
  useGameStore.getState().initOnline(0, ['Alice', 'Bob'])
  const card = { kind: 'regular' as const, color: 'red' as const, shape: 'circle' as const, number: 2 as const }
  useGameStore.getState().applyServerState({
    grid: [['0,0', card]],
    myHand: [card, card, card, card],
    handSizes: [4, 4],
    drawPileCount: 50,
    scores: [0, 0],
    turnIndex: 0,
    playedCards: [],
  })
})

test('renders without crashing', () => {
  render(<MemoryRouter><OnlineGame /></MemoryRouter>)
  expect(screen.getByText('Confirm Play')).toBeInTheDocument()
})

test('shows player names in TopBar', () => {
  render(<MemoryRouter><OnlineGame /></MemoryRouter>)
  expect(screen.getByText('Alice')).toBeInTheDocument()
  expect(screen.getByText('Bob')).toBeInTheDocument()
})

test('game-over shows Play Again linking to lobby', () => {
  render(<MemoryRouter><OnlineGame /></MemoryRouter>)
  act(() => useGameStore.setState({ phase: 'game-over' }))
  expect(screen.getByText('Play Again')).toBeInTheDocument()
})
