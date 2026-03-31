import {
  validatePlay, validateWildRecycle, score, createDeck, shuffle, posKey,
  type Card, type RegularCard, type GameState, type Placement, type Position, type ScoreResult,
} from '@viota/engine'

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

export function initGame(playerCount: number): GameState {
  if (playerCount < 2 || playerCount > 4) throw new Error('playerCount must be 2–4')
  const deck = shuffle(createDeck())
  const hands: Card[][] = []
  let pile = [...deck]
  for (let i = 0; i < playerCount; i++) {
    hands.push(pile.splice(0, 4))
  }
  return {
    grid: new Map(),
    hands,
    drawPile: pile,
    scores: Array.from({ length: playerCount }, () => 0),
    turnIndex: 0,
    playedCards: [],
  }
}

export function applyWildRecycle(
  state: GameState,
  playerIndex: number,
  wildPosition: Position,
  replacement: RegularCard
): { newState: GameState } | { error: string } {
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
      grid: newGrid,
      hands: newHands,
      drawPile: newPile,
      scores: newScores,
      turnIndex: newTurnIndex,
      playedCards: newPlayedCards,
    },
    scoreResult,
    gameOver: gameEnding,
  }
}

export function applyPass(
  state: GameState,
  playerIndex: number,
  trades: Card[],
  tradeOrder: Card[]
): { newState: GameState } | { error: string } {
  if (state.turnIndex !== playerIndex) return { error: 'Not your turn' }
  if (trades.length > 4) return { error: 'Cannot trade more than 4 cards' }
  if (!handContains(state.hands[playerIndex]!, trades)) return { error: 'Trade cards not all in hand' }

  let newHand = [...state.hands[playerIndex]!]
  for (const card of trades) {
    const idx = newHand.findIndex(c => cardsMatch(c, card))
    newHand.splice(idx, 1)
  }

  const newPile = [...state.drawPile]
  const draws = newPile.splice(0, trades.length)
  newHand = [...newHand, ...draws]

  // Traded cards go to the bottom of the draw pile in the specified order
  newPile.push(...tradeOrder)

  const playerCount = state.hands.length
  const newTurnIndex = (state.turnIndex + 1) % playerCount
  const newHands = state.hands.map((h, i) => (i === playerIndex ? newHand : h))

  return {
    newState: { ...state, hands: newHands, drawPile: newPile, turnIndex: newTurnIndex },
  }
}
