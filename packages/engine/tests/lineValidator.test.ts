import { describe, it, expect } from 'vitest'
import { isValidLine, solveWilds, wildLinesConsistent } from '../src/lineValidator'
import type { Card, Grid, RegularCard } from '../src/types'

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
  it('returns an empty assignment (success) for no wilds and no lines', () => {
    // Vacuously satisfiable: nothing to assign, nothing to violate.
    expect(solveWilds([], [])).toEqual([])
  })

  it('validates lines even when there are no wilds — invalid line → null', () => {
    // colors red, red, blue → not all-same, not all-different
    expect(solveWilds([], [[card('red','circle',1), card('red','plus',2), card('blue','square',3)]])).toBeNull()
  })

  it('validates lines even when there are no wilds — valid line → success', () => {
    expect(solveWilds([], [[card('red','circle',1), card('blue','circle',2)]])).toEqual([])
  })

  it('assigns wild to make a 2-card line valid', () => {
    // wild + [red,circle,1] — any assignment works; result must be non-null.
    // The same wild object must appear in both the wilds list and the line.
    const w = wild()
    const result = solveWilds([w], [[w, card('red','circle',1)]])
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

  it('is robust to two board cells aliasing the SAME wild object (positional identity)', () => {
    // Column [green-triangle-1, W, yellow-plus-2, W] is a valid 4-line with the
    // two wilds as DISTINCT cards (e.g. red-square-3 and blue-circle-4).
    // If the two cells alias one wild OBJECT, an identity-based solver would
    // collapse them into a single CSP variable and wrongly reject. The engine's
    // real path (wildLinesConsistent) must key identity by POSITION, not object,
    // so it stays correct even if a caller/serializer aliases cells.
    const aliased: Card = { kind: 'wild' }
    const gridAliased: Grid = new Map<string, Card>([
      ['0,0', card('green', 'triangle', 1)],
      ['0,1', aliased],
      ['0,2', card('yellow', 'plus', 2)],
      ['0,3', aliased], // SAME object reference as (0,1)
    ])
    expect(wildLinesConsistent(gridAliased, [{ x: 0, y: 0 }])).toBe(true)

    // Control: identical board with DISTINCT wild objects is (and stays) valid.
    const gridDistinct: Grid = new Map<string, Card>([
      ['0,0', card('green', 'triangle', 1)],
      ['0,1', { kind: 'wild' }],
      ['0,2', card('yellow', 'plus', 2)],
      ['0,3', { kind: 'wild' }],
    ])
    expect(wildLinesConsistent(gridDistinct, [{ x: 0, y: 0 }])).toBe(true)
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
