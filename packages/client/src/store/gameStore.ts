import { create } from 'zustand'
import { posKey, type Card, type RegularCard, type GameState, type Placement, type Position, type ScoreResult, type Difficulty, type Move } from '@viota/engine'
import { initGame, applyPlay, applyPass, applyWildRecycle, computeValidPositions, computePreviewScore } from '../gameLogic'

type Phase = 'idle' | 'placing' | 'ai-thinking' | 'game-over'

type GameStore = {
  grid: GameState['grid']
  hands: Card[][]
  drawPile: Card[]
  scores: number[]
  turnIndex: number
  playedCards: RegularCard[]
  playerCount: number
  difficulty: Difficulty
  humanIndex: number
  selectedCard: Card | null
  staged: Placement[]
  phase: Phase
  lastScoreResult: ScoreResult | null
  validPositions: Position[]
  previewScore: ScoreResult | null
  _worker: Worker | null
  startGame(playerCount: number, difficulty: Difficulty): void
  selectCard(card: Card): void
  placeCard(position: Position): void
  unstageCard(position: Position): void
  confirmPlay(): void
  pass(trades: Card[], tradeOrder: Card[]): void
  recycleWild(wildPosition: Position, replacement: RegularCard): void
  setWorker(worker: Worker | null): void
  handleWorkerMessage(move: Move): void
}

function postToWorker(worker: Worker, state: GameState, playerIndex: number, difficulty: Difficulty) {
  worker.postMessage({
    type: 'getMove',
    state: {
      grid: [...state.grid.entries()],
      hands: state.hands,
      drawPile: state.drawPile,
      scores: state.scores,
      turnIndex: state.turnIndex,
      playedCards: state.playedCards,
    },
    playerIndex,
    difficulty,
  })
}

export const useGameStore = create<GameStore>((set, get) => ({
  grid: new Map(),
  hands: [],
  drawPile: [],
  scores: [],
  turnIndex: 0,
  playedCards: [],
  playerCount: 2,
  difficulty: 'easy',
  humanIndex: 0,
  selectedCard: null,
  staged: [],
  phase: 'idle',
  lastScoreResult: null,
  validPositions: [],
  previewScore: null,
  _worker: null,

  startGame(playerCount, difficulty) {
    const gs = initGame(playerCount)
    set({
      ...gs,
      playerCount,
      difficulty,
      humanIndex: 0,
      selectedCard: null,
      staged: [],
      phase: 'idle',
      lastScoreResult: null,
      validPositions: [],
      previewScore: null,
    })
  },

  selectCard(card) {
    const { grid, staged } = get()
    const validPositions = computeValidPositions(grid, staged, card)
    set({ selectedCard: card, validPositions })
  },

  placeCard(position) {
    const { selectedCard, staged, grid } = get()
    if (!selectedCard) return
    const newStaged = [...staged, { card: selectedCard, position }]
    const previewScore = computePreviewScore(grid, newStaged)
    set({
      staged: newStaged,
      selectedCard: null,
      validPositions: [],
      previewScore,
      phase: 'placing',
    })
  },

  unstageCard(position) {
    const { staged, grid } = get()
    const key = posKey(position)
    const newStaged = staged.filter(p => posKey(p.position) !== key)
    const previewScore = computePreviewScore(grid, newStaged)
    set({
      staged: newStaged,
      selectedCard: null,
      validPositions: [],
      previewScore,
      phase: newStaged.length === 0 ? 'idle' : 'placing',
    })
  },

  confirmPlay() {
    const { grid, hands, drawPile, scores, turnIndex, playedCards, staged, humanIndex, difficulty, _worker } = get()
    if (staged.length === 0) return
    const gs: GameState = { grid, hands, drawPile, scores, turnIndex, playedCards }
    const result = applyPlay(gs, humanIndex, staged)
    if ('error' in result) return
    const { newState, scoreResult, gameOver } = result
    if (gameOver) {
      set({ ...newState, staged: [], selectedCard: null, validPositions: [], previewScore: null, lastScoreResult: scoreResult, phase: 'game-over' })
      return
    }
    const nextTurn = newState.turnIndex
    const isNextAI = nextTurn !== humanIndex
    set({
      ...newState,
      staged: [],
      selectedCard: null,
      validPositions: [],
      previewScore: null,
      lastScoreResult: scoreResult,
      phase: isNextAI ? 'ai-thinking' : 'idle',
    })
    if (isNextAI && _worker) postToWorker(_worker, newState, nextTurn, difficulty)
  },

  pass(trades, tradeOrder) {
    const { grid, hands, drawPile, scores, turnIndex, playedCards, humanIndex, difficulty, _worker } = get()
    const gs: GameState = { grid, hands, drawPile, scores, turnIndex, playedCards }
    const result = applyPass(gs, humanIndex, trades, tradeOrder)
    if ('error' in result) return
    const { newState } = result
    const nextTurn = newState.turnIndex
    const isNextAI = nextTurn !== humanIndex
    set({
      ...newState,
      staged: [],
      selectedCard: null,
      validPositions: [],
      previewScore: null,
      phase: isNextAI ? 'ai-thinking' : 'idle',
    })
    if (isNextAI && _worker) postToWorker(_worker, newState, nextTurn, difficulty)
  },

  recycleWild(wildPosition, replacement) {
    const { grid, hands, drawPile, scores, turnIndex, playedCards, humanIndex } = get()
    const gs: GameState = { grid, hands, drawPile, scores, turnIndex, playedCards }
    const result = applyWildRecycle(gs, humanIndex, wildPosition, replacement)
    if ('error' in result) return
    set({ ...result.newState, validPositions: [], previewScore: null })
  },

  setWorker(worker) {
    set({ _worker: worker })
  },

  handleWorkerMessage(move) {
    const { grid, hands, drawPile, scores, turnIndex, playedCards, humanIndex, difficulty, _worker } = get()
    const gs: GameState = { grid, hands, drawPile, scores, turnIndex, playedCards }
    let newState: GameState
    let gameOver = false
    if (move.type === 'play') {
      const result = applyPlay(gs, turnIndex, move.placements)
      if ('error' in result) return
      newState = result.newState
      gameOver = result.gameOver
    } else {
      const result = applyPass(gs, turnIndex, move.trades, move.tradeOrder)
      if ('error' in result) return
      newState = result.newState
    }
    if (gameOver) {
      set({ ...newState, phase: 'game-over' })
      return
    }
    const nextTurn = newState.turnIndex
    const isNextAI = nextTurn !== humanIndex
    set({ ...newState, phase: isNextAI ? 'ai-thinking' : 'idle' })
    if (isNextAI && _worker) {
      const w = _worker
      setTimeout(() => {
        const s = get()
        const current: GameState = { grid: s.grid, hands: s.hands, drawPile: s.drawPile, scores: s.scores, turnIndex: s.turnIndex, playedCards: s.playedCards }
        postToWorker(w, current, s.turnIndex, difficulty)
      }, 600)
    }
  },
}))
