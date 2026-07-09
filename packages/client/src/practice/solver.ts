import { validatePlay, score, posKey, fromKey, getMaximalSegments } from '@viota/engine'
import type { Card, Grid, Placement, Position, RegularCard } from '@viota/engine'
import type { ScoredPlay, ConceptCheckId, Puzzle, UserMove, GradeResult } from './types'

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

function tentativeGrid(grid: Grid, placements: Placement[]): Grid {
  const t = new Map(grid)
  for (const { card, position } of placements) t.set(posKey(position), card)
  return t
}

// The maximal line (length>=2) through the first placement that a placement lies on.
function touchedLine(grid: Grid, placements: Placement[]): Card[] {
  const t = tentativeGrid(grid, placements)
  const segs = getMaximalSegments(t, placements[0].position) // returns Position[][]
  // choose the longest segment that contains a placement
  const placedKeys = new Set(placements.map(p => posKey(p.position)))
  let bestSeg: Position[] = []
  for (const seg of segs) {
    if (seg.length < 2) continue
    if (seg.some(pos => placedKeys.has(posKey(pos))) && seg.length > bestSeg.length) bestSeg = seg
  }
  return bestSeg.map(pos => t.get(posKey(pos))!)
}

function regulars(cards: Card[]): RegularCard[] {
  return cards.filter(c => c.kind === 'regular') as RegularCard[]
}
function allSame<T>(xs: T[]): boolean { return xs.every(x => x === xs[0]) }
function allDiff<T>(xs: T[]): boolean { return new Set(xs).size === xs.length }

export const CONCEPT_CHECKS: Record<ConceptCheckId, (grid: Grid, placements: Placement[]) => boolean> = {
  'any-line': (grid, placements) => validatePlay(grid, placements).valid && touchedLine(grid, placements).length >= 2,

  'line-all-same': (grid, placements) => {
    const line = regulars(touchedLine(grid, placements))
    if (line.length < 2) return false
    return allSame(line.map(c => c.color)) || allSame(line.map(c => c.shape)) || allSame(line.map(c => c.number))
  },

  'line-all-different': (grid, placements) => {
    const line = regulars(touchedLine(grid, placements))
    if (line.length < 2) return false
    return allDiff(line.map(c => c.color)) && allDiff(line.map(c => c.shape)) && allDiff(line.map(c => c.number))
  },

  'mixed-properties': (grid, placements) => {
    const line = regulars(touchedLine(grid, placements))
    if (line.length < 2) return false
    const sameCount = [
      allSame(line.map(c => c.color)), allSame(line.map(c => c.shape)), allSame(line.map(c => c.number)),
    ].filter(Boolean).length
    return sameCount >= 1 && sameCount <= 2 // at least one same AND at least one not-same
  },

  'spans-both-ends': (grid, placements) => {
    if (!validatePlay(grid, placements).valid || placements.length < 2) return false
    const t = tentativeGrid(grid, placements)
    const seg = getMaximalSegments(t, placements[0].position)
      .filter(s => s.length >= 2)
      .sort((a, b) => b.length - a.length)[0]
    if (!seg) return false
    const xs = seg.map(p => p.x), ys = seg.map(p => p.y)
    const placed = new Set(placements.map(p => posKey(p.position)))
    const horizontal = ys.every(y => y === ys[0])
    if (horizontal) {
      const minX = Math.min(...xs), maxX = Math.max(...xs)
      return placed.has(posKey({ x: minX, y: ys[0] })) && placed.has(posKey({ x: maxX, y: ys[0] }))
    }
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    return placed.has(posKey({ x: xs[0], y: minY })) && placed.has(posKey({ x: xs[0], y: maxY }))
  },

  'creates-second-line': (grid, placements) => {
    if (!validatePlay(grid, placements).valid) return false
    const t = tentativeGrid(grid, placements)
    // count distinct maximal lines (len>=2) that pass through any placement
    const keys = new Set<string>()
    for (const p of placements) {
      for (const seg of getMaximalSegments(t, p.position)) {
        if (seg.length >= 2) keys.add(seg.map(posKey).sort().join('#'))
      }
    }
    return keys.size >= 2
  },

  'wild-in-two-lines': (grid, placements) => {
    if (!validatePlay(grid, placements).valid) return false
    const wild = placements.find(p => p.card.kind === 'wild')
    if (!wild) return false
    const t = tentativeGrid(grid, placements)
    const lines = getMaximalSegments(t, wild.position).filter(s => s.length >= 2)
    return lines.length >= 2
  },
}

export function gradeUserMove(puzzle: Puzzle, move: UserMove): GradeResult {
  const grid = new Map(puzzle.position.grid)
  const best = bestPlays(grid, puzzle.position.hand)
  const bestScore = best.length ? best[0].total : 0

  // forced-pass puzzles: solved iff the user passes
  if (puzzle.answerKind === 'forced-pass') {
    return { solved: move.action === 'pass', userScore: null, bestScore, best: [] }
  }

  if (move.action === 'pass') {
    return { solved: false, userScore: null, bestScore, best: puzzle.mode === 'top-score' ? best : [] }
  }

  const valid = validatePlay(grid, move.placements).valid
  let userScore: number | null = null
  if (valid) {
    const t = new Map(grid)
    for (const { card, position } of move.placements) t.set(posKey(position), card)
    userScore = score(t, move.placements.map(p => p.position), { cardsPlayedThisTurn: move.placements.length }).total
  }

  if (puzzle.mode === 'top-score') {
    return { solved: valid && userScore === bestScore, userScore, bestScore, best }
  }

  // concept (play): solved iff legal AND satisfies the predicate; never reveal the play-solver's best
  const ok = valid && !!puzzle.conceptCheck && CONCEPT_CHECKS[puzzle.conceptCheck](grid, move.placements)
  return { solved: ok, userScore, bestScore, best: [] }
}
