import { describe, it, expect } from 'vitest'
import { createDeck, shuffle } from '../src/deck'
import type { RegularCard } from '../src/types'

describe('createDeck', () => {
  it('has 66 cards', () => {
    expect(createDeck()).toHaveLength(66)
  })

  it('has exactly 2 wild cards', () => {
    const wilds = createDeck().filter(c => c.kind === 'wild')
    expect(wilds).toHaveLength(2)
  })

  it('has 64 unique regular cards', () => {
    const regulars = createDeck().filter((c): c is RegularCard => c.kind === 'regular')
    expect(regulars).toHaveLength(64)
    const keys = regulars.map(c => `${c.color}-${c.shape}-${c.number}`)
    expect(new Set(keys).size).toBe(64)
  })

  it('covers all combinations', () => {
    const regulars = createDeck().filter((c): c is RegularCard => c.kind === 'regular')
    const colors  = ['blue','red','yellow','green'] as const
    const shapes  = ['triangle','plus','square','circle'] as const
    const numbers = [1,2,3,4] as const
    for (const color of colors)
      for (const shape of shapes)
        for (const number of numbers)
          expect(regulars.some(c => c.color===color && c.shape===shape && c.number===number)).toBe(true)
  })
})

describe('shuffle', () => {
  it('returns same length', () => {
    const deck = createDeck()
    expect(shuffle(deck)).toHaveLength(66)
  })

  it('contains same cards', () => {
    const deck = createDeck()
    const shuffled = shuffle(deck)
    expect(shuffled).toEqual(expect.arrayContaining(deck))
  })

  it('does not mutate original', () => {
    const deck = createDeck()
    const copy = [...deck]
    shuffle(deck)
    expect(deck).toEqual(copy)
  })
})
