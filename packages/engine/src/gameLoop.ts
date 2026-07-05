import { validatePlay } from './playValidator'
import { validateWildRecycle } from './wildRecycle'
import { score } from './scorer'
import { createDeck, shuffle } from './deck'
import { posKey } from './grid'
import type { Card, RegularCard, GameState, Placement, Position, ScoreResult } from './types'

function cardsMatch(a: Card, b: Card): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'wild') return true
  const bR = b as RegularCard
  return (a as RegularCard).color === bR.color &&
    (a as RegularCard).shape === bR.shape &&
    (a as RegularCard).number === bR.number
}

// Returns true if all cards in `need` can be found in `hand` (respects multiplicity)
function handContains(hand: Card[], need: Card[]): boolean {
  const remaining = [...hand]
  for (const card of need) {
    const idx = remaining.findIndex(h => cardsMatch(h, card))
    if (idx === -1) return false
    remaining.splice(idx, 1)
  }
  return true
}

// True when `order` is a permutation (same multiset) of `trades`.
function isPermutation(trades: Card[], order: Card[]): boolean {
  if (trades.length !== order.length) return false
  const remaining = [...trades]
  for (const card of order) {
    const idx = remaining.findIndex(t => cardsMatch(t, card))
    if (idx === -1) return false
    remaining.splice(idx, 1)
  }
  return true
}

export function initGame(playerCount: number): GameState {
  if (playerCount < 2 || playerCount > 4) throw new Error('playerCount must be 2–4')
  const deck = shuffle(createDeck())
  const pile = [...deck]

  // Deal the starter card. If the top card is a Wild, reinsert it at a random
  // spot in the remaining pile and flip the next card, so the game always
  // starts on a card with a real color/shape/number (per house rule).
  let starterCard = pile.shift()!
  while (starterCard.kind === 'wild') {
    const idx = Math.floor(Math.random() * (pile.length + 1))
    pile.splice(idx, 0, starterCard)
    starterCard = pile.shift()!
  }

  const grid: GameState['grid'] = new Map()
  grid.set(posKey({ x: 0, y: 0 }), starterCard)

  // Track starter (always a regular card now)
  const playedCards: RegularCard[] = starterCard.kind === 'regular' ? [starterCard] : []

  const hands: Card[][] = []
  for (let i = 0; i < playerCount; i++) {
    hands.push(pile.splice(0, 4))
  }
  return {
    grid,
    hands,
    drawPile: pile,
    scores: Array.from({ length: playerCount }, () => 0),
    turnIndex: 0,
    playedCards,
    consecutivePasses: 0,
    finished: false,
  }
}

export function applyWildRecycle(
  state: GameState,
  playerIndex: number,
  wildPosition: Position,
  replacement: RegularCard
): { newState: GameState } | { error: string } {
  if (state.finished) return { error: 'Game is over' }
  if (state.turnIndex !== playerIndex) return { error: 'Not your turn' }
  if (!handContains(state.hands[playerIndex]!, [replacement])) return { error: 'Replacement card not in hand' }
  if (!validateWildRecycle(state.grid, wildPosition, replacement)) return { error: 'Invalid wild recycle' }

  const newGrid = new Map(state.grid)
  newGrid.set(posKey(wildPosition), replacement)

  const newHand = [...state.hands[playerIndex]!]
  const replIdx = newHand.findIndex(c => cardsMatch(c, replacement))
  newHand.splice(replIdx, 1)
  newHand.push({ kind: 'wild' })

  const newHands = state.hands.map((h, i) => (i === playerIndex ? newHand : h))

  return {
    newState: { ...state, grid: newGrid, hands: newHands },
  }
}

export function applyPlay(
  state: GameState,
  playerIndex: number,
  placements: Placement[]
): { newState: GameState; scoreResult: ScoreResult; gameOver: boolean } | { error: string } {
  if (state.finished) return { error: 'Game is over' }
  if (state.turnIndex !== playerIndex) return { error: 'Not your turn' }
  if (placements.length === 0) return { error: 'Must place at least 1 card' }

  const hand = state.hands[playerIndex]!
  const playedCards = placements.map(p => p.card)

  if (!handContains(hand, playedCards)) return { error: 'Played cards not all in hand' }

  const validation = validatePlay(state.grid, placements)
  if (!validation.valid) return { error: validation.error }

  // Build new grid
  const newGrid = new Map(state.grid)
  for (const { card, position } of placements) newGrid.set(posKey(position), card)

  // Game-ending check: pile was already empty AND player played all their cards
  const gameEnding = state.drawPile.length === 0 && placements.length === hand.length

  // Score (uses final grid including newly placed cards)
  const scoreResult = score(newGrid, placements.map(p => p.position), {
    cardsPlayedThisTurn: placements.length,
    gameEnding,
  })

  // Remove played cards from hand
  let newHand = [...hand]
  for (const card of playedCards) {
    const idx = newHand.findIndex(c => cardsMatch(c, card))
    newHand.splice(idx, 1)
  }

  // Draw replacements from top of pile
  const newPile = [...state.drawPile]
  const draws = newPile.splice(0, placements.length)
  newHand = [...newHand, ...draws]

  // Update played regular cards tracking
  const newPlayedCards = [
    ...state.playedCards,
    ...playedCards.filter((c): c is RegularCard => c.kind === 'regular'),
  ]

  const newScores = state.scores.map((s, i) => (i === playerIndex ? s + scoreResult.total : s))
  const newHands = state.hands.map((h, i) => (i === playerIndex ? newHand : h))
  const playerCount = state.hands.length
  const newTurnIndex = gameEnding ? state.turnIndex : (state.turnIndex + 1) % playerCount

  return {
    newState: {
      ...state,
      grid: newGrid,
      hands: newHands,
      drawPile: newPile,
      scores: newScores,
      turnIndex: newTurnIndex,
      playedCards: newPlayedCards,
      consecutivePasses: 0, // a play breaks any pass streak
      finished: gameEnding,
    },
    scoreResult,
    gameOver: gameEnding,
  }
}

// A stalemate ends the game after this many consecutive all-player pass rounds.
export const STALEMATE_PASS_ROUNDS = 3

export function applyPass(
  state: GameState,
  playerIndex: number,
  trades: Card[],
  tradeOrder: Card[]
): { newState: GameState; gameOver: boolean } | { error: string } {
  if (state.finished) return { error: 'Game is over' }
  if (state.turnIndex !== playerIndex) return { error: 'Not your turn' }
  if (trades.length > 4) return { error: 'Cannot trade more than 4 cards' }
  if (!handContains(state.hands[playerIndex]!, trades)) return { error: 'Trade cards not all in hand' }
  if (!isPermutation(trades, tradeOrder)) return { error: 'tradeOrder must be a reordering of the traded cards' }

  let newHand = [...state.hands[playerIndex]!]
  for (const card of trades) {
    const idx = newHand.findIndex(c => cardsMatch(c, card))
    newHand.splice(idx, 1)
  }

  // Bottom-first: the traded cards go to the bottom of the pile (in the player's
  // chosen order), THEN you draw from the top. If you traded more cards than the
  // pile had, you draw some of your own cards back — your hand always returns to 4.
  const newPile = [...state.drawPile, ...tradeOrder]
  const draws = newPile.splice(0, trades.length)
  newHand = [...newHand, ...draws]

  const playerCount = state.hands.length
  const newTurnIndex = (state.turnIndex + 1) % playerCount
  const newHands = state.hands.map((h, i) => (i === playerIndex ? newHand : h))

  const consecutivePasses = (state.consecutivePasses ?? 0) + 1
  const gameOver = consecutivePasses >= STALEMATE_PASS_ROUNDS * playerCount

  return {
    newState: {
      ...state,
      hands: newHands,
      drawPile: newPile,
      turnIndex: newTurnIndex,
      consecutivePasses,
      finished: gameOver,
    },
    gameOver,
  }
}
