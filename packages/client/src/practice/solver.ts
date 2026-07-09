import { validatePlay, score, posKey, fromKey } from '@viota/engine'
import type { Card, Grid, Placement, Position } from '@viota/engine'
import type { ScoredPlay } from './types'

export function cardIdentity(card: Card): string {
  return card.kind === 'wild' ? 'wild' : `${card.color}-${card.shape}-${card.number}`
}

export function playKey(placements: Placement[]): string {
  return placements
    .map(p => `${posKey(p.position)}=${cardIdentity(p.card)}`)
    .sort()
    .join('|')
}

function isCollinear(pl: Placement[]): boolean {
  if (pl.length <= 1) return true
  const sameRow = pl.every(p => p.position.y === pl[0].position.y)
  const sameCol = pl.every(p => p.position.x === pl[0].position.x)
  return sameRow || sameCol
}

// Empty cells orthogonally adjacent to any occupied-or-staged cell.
function frontierCells(grid: Grid, staged: Placement[]): Position[] {
  const occupied = new Set<string>(grid.keys())
  for (const p of staged) occupied.add(posKey(p.position))
  const cand = new Set<string>()
  for (const key of occupied) {
    const { x, y } = fromKey(key)
    for (const n of [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]) {
      const nk = posKey(n)
      if (!occupied.has(nk)) cand.add(nk)
    }
  }
  return [...cand].map(fromKey)
}

export function enumerateLegalPlays(grid: Grid, hand: Card[]): ScoredPlay[] {
  const results = new Map<string, ScoredPlay>()
  const MAX = Math.min(4, hand.length)

  function recurse(staged: Placement[], remaining: number[]) {
    if (staged.length > 0 && validatePlay(grid, staged).valid) {
      const tentative = new Map(grid)
      for (const { card, position } of staged) tentative.set(posKey(position), card)
      const sr = score(tentative, staged.map(p => p.position), { cardsPlayedThisTurn: staged.length })
      const key = playKey(staged)
      if (!results.has(key)) results.set(key, { placements: staged.slice(), total: sr.total })
    }
    if (staged.length >= MAX) return
    for (const pos of frontierCells(grid, staged)) {
      for (const idx of remaining) {
        const next = [...staged, { card: hand[idx], position: pos }]
        if (!isCollinear(next)) continue
        recurse(next, remaining.filter(i => i !== idx))
      }
    }
  }

  recurse([], hand.map((_, i) => i))
  return [...results.values()]
}

export function bestPlays(grid: Grid, hand: Card[]): ScoredPlay[] {
  const all = enumerateLegalPlays(grid, hand)
  if (all.length === 0) return []
  const max = Math.max(...all.map(p => p.total))
  return all.filter(p => p.total === max)
}
