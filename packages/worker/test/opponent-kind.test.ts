import { describe, it, expect } from 'vitest'
import { opponentKindFor } from '../src/stats/opponentKind'

describe('opponentKindFor', () => {
  it("classifies 'ai' when the only other seat is ai-owned", () => {
    const seats = [
      { seat_index: 0, owner_type: 'human' },
      { seat_index: 1, owner_type: 'ai' },
    ]
    expect(opponentKindFor(seats, 0)).toBe('ai')
  })

  it("classifies 'human' when the other seat is human-owned", () => {
    const seats = [
      { seat_index: 0, owner_type: 'human' },
      { seat_index: 1, owner_type: 'human' },
    ]
    expect(opponentKindFor(seats, 0)).toBe('human')
  })

  it("classifies 'human' in a 3-seat game with one human + one ai opponent (any human wins)", () => {
    const seats = [
      { seat_index: 0, owner_type: 'human' },
      { seat_index: 1, owner_type: 'human' },
      { seat_index: 2, owner_type: 'ai' },
    ]
    expect(opponentKindFor(seats, 0)).toBe('human')
  })

  it('never counts the seat itself as its own opponent', () => {
    // A single-seat degenerate case: no OTHER seat exists, so no human opponent.
    const seats = [{ seat_index: 0, owner_type: 'human' }]
    expect(opponentKindFor(seats, 0)).toBe('ai')
  })
})
