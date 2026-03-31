import type { Card, Color, Shape, Num } from './types'

const COLORS:  Color[]  = ['blue', 'red', 'yellow', 'green']
const SHAPES:  Shape[]  = ['triangle', 'plus', 'square', 'circle']
const NUMBERS: Num[]    = [1, 2, 3, 4]

export function createDeck(): Card[] {
  const deck: Card[] = []
  for (const color of COLORS)
    for (const shape of SHAPES)
      for (const number of NUMBERS)
        deck.push({ kind: 'regular', color, shape, number })
  deck.push({ kind: 'wild' })
  deck.push({ kind: 'wild' })
  return deck
}

// Fisher-Yates shuffle — returns new array, does not mutate input
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}
