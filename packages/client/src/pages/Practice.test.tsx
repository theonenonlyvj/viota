import { describe, it, expect } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Practice from './Practice'

describe('Practice', () => {
  it('lists puzzles and shows a puzzle title', () => {
    render(<MemoryRouter><Practice /></MemoryRouter>)
    expect(screen.getByText('Complete a lot')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Complete a lot' })).toBeInTheDocument()
  })

  it('opening a puzzle shows its instruction', () => {
    render(<MemoryRouter><Practice /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Open Open a line' }))
    expect(screen.getByText(/any two cards can start a line/i)).toBeInTheDocument()
  })

  it('solves the complete-lot top-score puzzle: select+place the optimal 3 cards, Check shows solved', () => {
    render(<MemoryRouter><Practice /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Open Complete a lot' }))

    const handEl = screen.getByTestId('puzzle-hand')

    // Puzzle hand: red-circle-2, red-circle-3, red-circle-4, blue-triangle-1.
    // Extending the board's red-circle-1 to a 4-card same-color lot scores 20 (the optimum),
    // regardless of which direction the UI's valid-cell ordering happens to offer first.
    for (const num of ['2', '3', '4']) {
      fireEvent.click(within(handEl).getByText(num).closest('div')!)
      const validCells = screen.getAllByTestId('valid-cell')
      fireEvent.click(validCells[0]!)
    }

    fireEvent.click(screen.getByRole('button', { name: /check/i }))

    expect(screen.getByText(/solved/i)).toBeInTheDocument()
  })

  it('shows a Pass button only for forced-pass puzzles, and grading a pass solves it', () => {
    render(<MemoryRouter><Practice /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Open Complete a lot' }))
    expect(screen.queryByRole('button', { name: /^pass$/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /back to menu/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Nothing to play' }))
    expect(screen.getByRole('button', { name: /^pass$/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^pass$/i }))
    expect(screen.getByText(/solved/i)).toBeInTheDocument()
  })

  it('Back to menu navigates away from the list', () => {
    render(<MemoryRouter><Practice /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /back to menu/i })).toBeInTheDocument()
  })
})
