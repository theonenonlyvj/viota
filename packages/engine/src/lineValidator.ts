import type { Card, RegularCard, Color, Shape, Num, WildAssignment } from './types'

const COLORS:  Color[]  = ['blue', 'red', 'yellow', 'green']
const SHAPES:  Shape[]  = ['triangle', 'plus', 'square', 'circle']
const NUMBERS: Num[]    = [1, 2, 3, 4]

// Check a line of RegularCards (Wilds must be pre-resolved to RegularCard).
export function isValidLine(cards: RegularCard[]): boolean {
  if (cards.length <= 1) return true

  const valid = (vals: (string | number)[]) => {
    const unique = new Set(vals)
    return unique.size === 1 || unique.size === vals.length
  }

  return (
    valid(cards.map(c => c.color)) &&
    valid(cards.map(c => c.shape)) &&
    valid(cards.map(c => c.number))
  )
}

// Attempt to find consistent RegularCard assignments for each wild such that
// every line in `lines` (where wilds appear as WildCard objects) is valid.
// Returns array of assignments in same order as `wilds`, or null if impossible.
// wilds: the WildCard objects (by reference — used for identity matching in lines)
// lines: each line is a Card[] that may contain wilds
export function solveWilds(wilds: Card[], lines: Card[][]): WildAssignment[] | null {
  if (wilds.length === 0) return lines.length === 0 ? null : []

  const allAssignments: WildAssignment[] = []
  for (const color of COLORS)
    for (const shape of SHAPES)
      for (const number of NUMBERS)
        allAssignments.push({ color, shape, number })

  function solve(idx: number, assignments: WildAssignment[]): WildAssignment[] | null {
    if (idx === wilds.length) {
      // Verify all lines
      for (const line of lines) {
        const resolved = line.map((card, _i) => {
          if (card.kind === 'regular') return card
          const wi = wilds.indexOf(card)
          const a = assignments[wi]
          if (!a) return card as unknown as RegularCard // shouldn't happen
          return { kind: 'regular' as const, ...a }
        })
        if (!isValidLine(resolved)) return null
      }
      return assignments
    }

    for (const a of allAssignments) {
      const result = solve(idx + 1, [...assignments, a])
      if (result) return result
    }
    return null
  }

  return solve(0, [])
}
