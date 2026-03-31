import { describe, it, expect } from 'vitest'
import { isValidLine, solveWilds } from '../src/lineValidator'
import type { Card, RegularCard } from '../src/types'

const card = (color: string, shape: string, number: number): RegularCard =>
  ({ kind: 'regular', color: color as any, shape: shape as any, number: number as any })

const wild = (): Card => ({ kind: 'wild' })

describe('isValidLine — no wilds', () => {
  it('any 2 cards are valid', () => {
    expect(isValidLine([card('red','circle',1), card('blue','triangle',2)])).toBe(true)
  })

  it('3 cards all-same color valid', () => {
    expect(isValidLine([
      card('red','circle',1), card('red','plus',2), card('red','square',3)
    ])).toBe(true)
  })

  it('3 cards all-different color valid', () => {
    expect(isValidLine([
      card('red','circle',1), card('blue','circle',1), card('green','circle',1)
    ])).toBe(true)
  })

  it('3 cards mixed color invalid', () => {
    expect(isValidLine([
      card('red','circle',1), card('red','plus',2), card('blue','square',3)
    ])).toBe(false)
  })

  it('4-card lot: all different all properties', () => {
    expect(isValidLine([
      card('red','circle',1), card('blue','triangle',2),
      card('yellow','plus',3), card('green','square',4)
    ])).toBe(true)
  })

  it('4-card lot: same color, same shape, all different numbers', () => {
    expect(isValidLine([
      card('red','circle',1), card('red','circle',2),
      card('red','circle',3), card('red','circle',4)
    ])).toBe(true)
  })

  it('4 cards invalid if one property is 2-same 2-different', () => {
    // colors: red, red, blue, green — two red = not all-same, not all-different
    expect(isValidLine([
      card('red','circle',1), card('red','triangle',2),
      card('blue','plus',3), card('green','square',4)
    ])).toBe(false)
  })

  it('single card is valid (no constraint)', () => {
    expect(isValidLine([card('red','circle',1)])).toBe(true)
  })
})

describe('solveWilds', () => {
  it('returns null for empty lines array', () => {
    expect(solveWilds([], [])).toBeNull()
  })

  it('assigns wild to make a 2-card line valid', () => {
    // wild + [red,circle,1] — any assignment works; result must be non-null
    const result = solveWilds(
      [{ kind: 'wild' }],
      [[wild(), card('red','circle',1)]]
    )
    expect(result).not.toBeNull()
  })

  it('assigns wild consistently across two lines', () => {
    // Wild is at intersection. Line A: [wild, red circle 1, blue circle 2] — must have all-diff colors, same shape, all-diff numbers
    // Line B: [wild, green plus 3] — any assignment
    // Wild must satisfy both lines simultaneously
    const w = wild()
    const result = solveWilds(
      [w],
      [
        [w, card('red','circle',1), card('blue','circle',2)],
        [w, card('green','plus',3)],
      ]
    )
    // yellow circle 4 would satisfy line A (colors: yellow/red/blue all diff, shapes: circle/circle/circle all same, nums: 4/1/2 all diff)
    // and line B (yellow circle 4 + green plus 3 — any 2 cards are valid)
    expect(result).not.toBeNull()
    if (result) {
      // Verify: plug the assignment back in and check both lines
      const assigned = result[0]!
      const lineA: RegularCard[] = [assigned, card('red','circle',1), card('blue','circle',2)]
      const lineB: RegularCard[] = [assigned, card('green','plus',3)]
      expect(isValidLine(lineA)).toBe(true)
      expect(isValidLine(lineB)).toBe(true)
    }
  })

  it('returns null when no valid assignment exists', () => {
    // Line A: [w, red circle 2, red circle 3, red circle 4] → w = red circle 1
    // Line B: [w, red circle 1, red circle 3, red circle 4] → w = red circle 2
    // w can't be both red-circle-1 and red-circle-2
    const w = wild()
    const result = solveWilds(
      [w],
      [
        [w, card('red','circle',2), card('red','circle',3), card('red','circle',4)],
        [w, card('red','circle',1), card('red','circle',3), card('red','circle',4)],
      ]
    )
    expect(result).toBeNull()
  })
})
