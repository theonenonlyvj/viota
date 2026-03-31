export type Color  = 'blue' | 'red' | 'yellow' | 'green'
export type Shape  = 'triangle' | 'plus' | 'square' | 'circle'
export type Num    = 1 | 2 | 3 | 4

export type RegularCard = { kind: 'regular'; color: Color; shape: Shape; number: Num }
export type WildCard    = { kind: 'wild' }
export type Card        = RegularCard | WildCard

export type Position = { x: number; y: number }
export type Grid     = Map<string, Card>

export type WildAssignment = { color: Color; shape: Shape; number: Num }

// A line is a contiguous segment of 2-4 cards
export type Line = { positions: Position[]; cards: Card[] }

// A placement is a card placed at a position this turn
export type Placement = { card: Card; position: Position }

export type PlayResult =
  | { valid: true }
  | { valid: false; error: string }

export type ScoreResult = {
  base: number
  multiplier: number
  total: number
  affectedLines: Line[]
}

export type Move =
  | { type: 'play'; placements: Placement[] }
  | { type: 'pass'; trades: Card[]; tradeOrder: Card[] }

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert'

export type GameState = {
  grid: Grid
  hands: Card[][]          // hands[playerIndex]
  drawPile: Card[]
  scores: number[]
  turnIndex: number        // which player's turn (index into hands/scores)
  playedCards: RegularCard[] // all regular cards removed from draw pile so far
}
