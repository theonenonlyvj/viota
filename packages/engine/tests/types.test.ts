import { describe, it, expectTypeOf } from 'vitest'
import type { Card, RegularCard, WildCard, Color, Shape, Num, Position, Grid } from '../src/types'

describe('types', () => {
  it('RegularCard has color, shape, number', () => {
    const c: RegularCard = { kind: 'regular', color: 'blue', shape: 'circle', number: 2 }
    expectTypeOf(c.color).toEqualTypeOf<Color>()
    expectTypeOf(c.shape).toEqualTypeOf<Shape>()
    expectTypeOf(c.number).toEqualTypeOf<Num>()
  })

  it('WildCard has kind wild', () => {
    const w: WildCard = { kind: 'wild' }
    expectTypeOf(w.kind).toEqualTypeOf<'wild'>()
  })

  it('Card is RegularCard | WildCard', () => {
    const cards: Card[] = [
      { kind: 'regular', color: 'red', shape: 'triangle', number: 1 },
      { kind: 'wild' },
    ]
    expectTypeOf(cards).toEqualTypeOf<Card[]>()
  })

  it('Grid maps string keys to Card', () => {
    const g: Grid = new Map()
    g.set('0,0', { kind: 'wild' })
    expectTypeOf(g).toEqualTypeOf<Grid>()
  })
})
