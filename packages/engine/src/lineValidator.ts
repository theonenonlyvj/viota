import type { Card, RegularCard, Color, Shape, Num, WildAssignment, Grid, Position } from './types'
import { posKey, fromKey, getMaximalSegments } from './grid'

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
//
// Contract: every wild appearing in `lines` MUST be present in `wilds`. Callers
// build the wild list via a transitive closure over shared lines (see
// wildLinesConsistent); an unmatched wild is a caller bug and throws.
export function solveWilds(wilds: Card[], lines: Card[][]): WildAssignment[] | null {
  if (wilds.length === 0) {
    // No wilds to assign — the lines are fully determined; validate them directly.
    return lines.every(line => isValidLine(line as RegularCard[])) ? [] : null
  }

  const allAssignments: WildAssignment[] = []
  for (const color of COLORS)
    for (const shape of SHAPES)
      for (const number of NUMBERS)
        allAssignments.push({ color, shape, number })

  function solve(idx: number, assignments: WildAssignment[]): WildAssignment[] | null {
    if (idx === wilds.length) {
      // Verify all lines
      for (const line of lines) {
        const resolved = line.map((card) => {
          if (card.kind === 'regular') return card
          const wi = wilds.indexOf(card)
          if (wi === -1) {
            throw new Error('solveWilds: encountered a wild not present in the wilds list (caller must supply the transitive closure of connected wilds)')
          }
          return { kind: 'regular' as const, ...assignments[wi]! }
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

// Verify that every line reachable from `seedPositions` — including, transitively,
// every line that any connected wild participates in — has a globally consistent
// assignment. A wild must represent the SAME card in every line it belongs to, so
// two wilds sharing a line (or chained through a series of shared lines) must be
// solved jointly. Also enforces the max line length of 4.
//
// Used by validatePlay (seed = newly played positions) and validateWildRecycle
// (seed = the recycled position).
export function wildLinesConsistent(grid: Grid, seedPositions: Position[]): boolean {
  const segByKey = new Map<string, Position[]>()
  const wildKeys = new Set<string>()
  const queue: string[] = []

  // Add a segment to the working set; returns false if it exceeds max length.
  const addSegment = (seg: Position[]): boolean => {
    if (seg.length > 4) return false
    const k = seg.map(posKey).sort().join('|')
    if (segByKey.has(k)) return true
    segByKey.set(k, seg)
    for (const p of seg) {
      const c = grid.get(posKey(p))
      const pk = posKey(p)
      if (c && c.kind === 'wild' && !wildKeys.has(pk)) {
        wildKeys.add(pk)
        queue.push(pk)
      }
    }
    return true
  }

  // Seed from the anchor positions...
  for (const p of seedPositions) {
    for (const seg of getMaximalSegments(grid, p)) if (!addSegment(seg)) return false
  }
  // ...then expand transitively through every connected wild.
  while (queue.length > 0) {
    const wk = queue.shift()!
    for (const seg of getMaximalSegments(grid, fromKey(wk))) if (!addSegment(seg)) return false
  }

  // Identity is POSITIONAL, not object-based: give each wild grid cell its own
  // fresh sentinel keyed by position, so two cells can never collapse into one
  // CSP variable even if a caller/serializer aliases the same wild object across
  // cells. (solveWilds matches wilds by object reference; feeding it distinct
  // per-position sentinels makes that matching robust.)
  const sentinelByKey = new Map<string, Card>()
  for (const k of wildKeys) sentinelByKey.set(k, { kind: 'wild' })
  const resolveCell = (p: Position): Card => {
    const k = posKey(p)
    const c = grid.get(k)!
    return c.kind === 'wild' ? sentinelByKey.get(k)! : c
  }

  // Split into wild / no-wild lines and validate.
  const wildLines: Card[][] = []
  for (const seg of segByKey.values()) {
    const cards = seg.map(resolveCell)
    if (cards.some(c => c.kind === 'wild')) wildLines.push(cards)
    else if (!isValidLine(cards as RegularCard[])) return false
  }

  if (wildLines.length === 0) return true

  const allWilds = [...wildKeys].map(k => sentinelByKey.get(k)!)
  return solveWilds(allWilds, wildLines) !== null
}
