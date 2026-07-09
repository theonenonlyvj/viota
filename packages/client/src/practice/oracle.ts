import { validatePlay, score, posKey, fromKey } from '@viota/engine'
import type { Card, Grid, Placement, Position } from '@viota/engine'

function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  if (k === 0) { yield []; return }
  for (let i = 0; i <= arr.length - k; i++) {
    for (const rest of combinations(arr.slice(i + 1), k - 1)) yield [arr[i], ...rest]
  }
}
function* permutations<T>(arr: T[]): Generator<T[]> {
  if (arr.length <= 1) { yield arr.slice(); return }
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)]
    for (const p of permutations(rest)) yield [arr[i], ...p]
  }
}
function collinear(cells: Position[]): boolean {
  if (cells.length <= 1) return true
  return cells.every(c => c.y === cells[0].y) || cells.every(c => c.x === cells[0].x)
}

// Independent candidate cells. Two fixed (non-recursive) seed families:
//   (a) every occupied cell, and
//   (b) each of the 4 orthogonal neighbors ("touch points") of every occupied cell.
// From each seed we open a +/-4 row-window and +/-4 col-window (empty cells only).
// Family (b) is essential: it lets the oracle discover legal perpendicular
// touch-then-extend plays — a brand-new row/column that meets the board at a single
// cell, in a row/column that contains no pre-existing occupied card. Windows through
// occupied cells alone (family (a)) would miss those. This stays a fixed construction —
// one hop off the board, no frontier/DFS recursion — so the oracle remains an
// independent check on the solver.
function candidateCells(grid: Grid): Position[] {
  const occ = [...grid.keys()].map(fromKey)
  const seeds: Position[] = []
  for (const p of occ) {
    seeds.push(p)
    seeds.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 })
  }
  const rows = new Map<number, number[]>()
  const cols = new Map<number, number[]>()
  for (const p of seeds) {
    ;(rows.get(p.y) ?? rows.set(p.y, []).get(p.y)!).push(p.x)
    ;(cols.get(p.x) ?? cols.set(p.x, []).get(p.x)!).push(p.y)
  }
  const out = new Set<string>()
  for (const [y, xs] of rows) {
    for (let x = Math.min(...xs) - 4; x <= Math.max(...xs) + 4; x++) {
      const k = posKey({ x, y }); if (!grid.has(k)) out.add(k)
    }
  }
  for (const [x, ys] of cols) {
    for (let y = Math.min(...ys) - 4; y <= Math.max(...ys) + 4; y++) {
      const k = posKey({ x, y }); if (!grid.has(k)) out.add(k)
    }
  }
  return [...out].map(fromKey)
}

export function bruteForceBest(grid: Grid, hand: Card[]): number {
  const cells = candidateCells(grid)
  const idxs = hand.map((_, i) => i)
  let best = 0
  let found = false
  for (let k = 1; k <= Math.min(4, hand.length); k++) {
    for (const cardIdxs of combinations(idxs, k)) {
      for (const cellCombo of combinations(cells, k)) {
        if (!collinear(cellCombo)) continue
        for (const perm of permutations(cardIdxs)) {
          const placements: Placement[] = perm.map((ci, j) => ({ card: hand[ci], position: cellCombo[j] }))
          if (!validatePlay(grid, placements).valid) continue
          const t = new Map(grid)
          for (const p of placements) t.set(posKey(p.position), p.card)
          const total = score(t, placements.map(p => p.position), { cardsPlayedThisTurn: placements.length }).total
          if (!found || total > best) { best = total; found = true }
        }
      }
    }
  }
  return found ? best : 0
}
