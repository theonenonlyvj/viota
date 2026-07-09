import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { posKey } from '@viota/engine'
import type { Grid } from '@viota/engine'
import StaticBoard from './StaticBoard'

function gridOf(entries: [number, number, any][]): Grid {
  const g: Grid = new Map(); for (const [x, y, c] of entries) g.set(posKey({ x, y }), c); return g
}

describe('StaticBoard', () => {
  it('renders placed cards and calls onPlace when a valid cell is clicked', () => {
    const onPlace = vi.fn()
    const grid = gridOf([[0, 0, { kind: 'regular', color: 'red', shape: 'circle', number: 1 }]])
    render(<StaticBoard grid={grid} staged={[]} validPositions={[{ x: 1, y: 0 }]} onPlace={onPlace} onUnstage={() => {}} />)
    const validCells = screen.getAllByTestId('valid-cell')
    expect(validCells.length).toBe(1)
    fireEvent.click(validCells[0])
    expect(onPlace).toHaveBeenCalledWith({ x: 1, y: 0 })
  })
})
