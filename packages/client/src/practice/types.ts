import type { Card, Placement } from '@viota/engine'

export type ScoredPlay = { placements: Placement[]; total: number }

export type PuzzleMode = 'top-score' | 'concept'

export type ConceptCheckId =
  | 'any-line' | 'line-all-same' | 'line-all-different' | 'mixed-properties'
  | 'spans-both-ends' | 'creates-second-line' | 'wild-in-two-lines'

export type AcceptedMove =
  | { action: 'play'; placements: Placement[] }
  | { action: 'pass' }

export type UserMove =
  | { action: 'play'; placements: Placement[] }
  | { action: 'pass' }

export type Puzzle = {
  id: string
  title: string
  concept: string
  mode: PuzzleMode
  answerKind: 'play' | 'forced-pass'   // play = place cards; forced-pass = board has no legal play
  instruction: string
  position: { grid: [string, Card][]; hand: Card[] }
  conceptCheck?: ConceptCheckId        // required when mode==='concept' && answerKind==='play'
  explanation: string
}

export type GradeResult = {
  solved: boolean
  userScore: number | null
  bestScore: number
  best: ScoredPlay[]     // only surfaced for top-score puzzles
}
