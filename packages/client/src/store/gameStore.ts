import { create } from 'zustand'
import { posKey, validateWildRecycle, type Card, type RegularCard, type GameState, type Placement, type Position, type ScoreResult, type Difficulty, type Move } from '@viota/engine'
import { initGame, applyPlay, applyPass, applyWildRecycle, computeValidPositions, computePreviewScore } from '../gameLogic'

type Phase = 'idle' | 'placing' | 'ai-thinking' | 'game-over'

type ClientView = {
  grid: [string, Card][]
  myHand: Card[]
  handSizes: number[]
  drawPileCount: number
  scores: number[]
  turnIndex: number
  playedCards: RegularCard[]
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'

type Connection = { send(msg: object): void; close(): void }

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
  recycleTarget: Position | null
  recycleValidCards: Card[]
  // Online mode state
  mode: 'local' | 'online'
  connectionStatus: ConnectionStatus
  playerNames: string[]
  myIndex: number
  turnTimer: number
  disconnectVote: { disconnectedPlayer: number; votes: Map<number, string>; totalVoters: number } | null
  handSizes: number[]
  aiTakeoverInfo: { playerIndex: number; difficulty: string } | null
  _connection: Connection | null
  // Local mode actions
  startGame(playerCount: number, difficulty: Difficulty): void
  selectCard(card: Card): void
  placeCard(position: Position): void
  unstageCard(position: Position): void
  confirmPlay(): void
  pass(trades: Card[], tradeOrder: Card[]): void
  recycleWild(wildPosition: Position, replacement: RegularCard): void
  setWorker(worker: Worker | null): void
  handleWorkerMessage(move: Move): void
  startRecycle(position: Position): void
  cancelRecycle(): void
  confirmRecycle(replacement: RegularCard): void
  // Online mode actions
  initOnline(myIndex: number, playerNames: string[]): void
  applyServerState(view: ClientView): void
  setConnectionStatus(status: ConnectionStatus): void
  setConnection(conn: Connection | null): void
  handleVoteStart(disconnectedPlayer: number): void
  handleVoteCancelled(): void
  handleAiTakeover(playerIndex: number, difficulty: string): void
  handleVoteUpdate(disconnectedPlayer: number, votesReceived: number, totalVoters: number): void
  sendVote(disconnectedPlayer: number, choice: string): void
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
  recycleTarget: null,
  recycleValidCards: [],
  mode: 'local',
  connectionStatus: 'disconnected',
  playerNames: [],
  myIndex: 0,
  turnTimer: 0,
  disconnectVote: null,
  handSizes: [],
  aiTakeoverInfo: null,
  _connection: null,

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
      recycleTarget: null,
      recycleValidCards: [],
      mode: 'local',
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
    const { mode, _connection, staged } = get()
    if (mode === 'online' && _connection) {
      if (staged.length === 0) return
      _connection.send({ type: 'play', placements: staged })
      set({ staged: [], selectedCard: null, validPositions: [], previewScore: null, phase: 'ai-thinking' })
      return
    }
    const { grid, hands, drawPile, scores, turnIndex, playedCards, humanIndex, difficulty, _worker } = get()
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
    const { mode, _connection } = get()
    if (mode === 'online' && _connection) {
      _connection.send({ type: 'pass', trades, tradeOrder })
      set({ staged: [], selectedCard: null, validPositions: [], previewScore: null, phase: 'ai-thinking' })
      return
    }
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

  startRecycle(position) {
    const { grid, hands, humanIndex, staged, turnIndex } = get()
    if (turnIndex !== humanIndex) return
    const card = grid.get(posKey(position))
    if (!card || card.kind !== 'wild') return
    const stagedCards = new Set(staged.map(p => p.card))
    const hand = hands[humanIndex]!
    const validCards = hand.filter(c => {
      if (stagedCards.has(c)) return false
      if (c.kind !== 'regular') return false
      return validateWildRecycle(grid, position, c)
    })
    set({ recycleTarget: position, recycleValidCards: validCards })
  },

  cancelRecycle() {
    set({ recycleTarget: null, recycleValidCards: [] })
  },

  confirmRecycle(replacement) {
    const { mode, _connection, recycleTarget: rt } = get()
    if (mode === 'online' && _connection && rt) {
      _connection.send({ type: 'wildRecycle', wildPosition: rt, replacement })
      set({ recycleTarget: null, recycleValidCards: [] })
      return
    }
    const { grid, hands, drawPile, scores, turnIndex, playedCards, humanIndex, recycleTarget } = get()
    if (!recycleTarget) return
    const gs: GameState = { grid, hands, drawPile, scores, turnIndex, playedCards }
    const result = applyWildRecycle(gs, humanIndex, recycleTarget, replacement)
    if ('error' in result) return
    set({ ...result.newState, recycleTarget: null, recycleValidCards: [], validPositions: [], previewScore: null })
  },

  // Online mode actions
  initOnline(myIndex, playerNames) {
    set({
      mode: 'online',
      myIndex,
      humanIndex: myIndex,
      playerNames,
      playerCount: playerNames.length,
      grid: new Map(),
      hands: Array.from({ length: playerNames.length }, () => []),
      drawPile: [],
      scores: Array.from({ length: playerNames.length }, () => 0),
      turnIndex: 0,
      playedCards: [],
      selectedCard: null,
      staged: [],
      phase: 'idle',
      lastScoreResult: null,
      validPositions: [],
      previewScore: null,
      recycleTarget: null,
      recycleValidCards: [],
      turnTimer: 0,
      disconnectVote: null,
      handSizes: Array.from({ length: playerNames.length }, () => 0),
      aiTakeoverInfo: null,
    })
  },

  applyServerState(view) {
    const { myIndex } = get()
    const grid = new Map(view.grid)
    const hands: Card[][] = Array.from({ length: view.handSizes.length }, () => [])
    hands[myIndex] = view.myHand
    const isMyTurn = view.turnIndex === myIndex
    set({
      grid,
      hands,
      handSizes: view.handSizes,
      drawPile: [],
      scores: view.scores,
      turnIndex: view.turnIndex,
      playedCards: view.playedCards,
      staged: [],
      selectedCard: null,
      validPositions: [],
      previewScore: null,
      recycleTarget: null,
      recycleValidCards: [],
      turnTimer: 0,
      phase: isMyTurn ? 'idle' : 'ai-thinking',
    })
  },

  setConnectionStatus(status) {
    set({ connectionStatus: status })
  },

  setConnection(conn) {
    set({ _connection: conn })
  },

  handleVoteStart(disconnectedPlayer) {
    set({ disconnectVote: { disconnectedPlayer, votes: new Map(), totalVoters: 0 } })
  },

  handleVoteCancelled() {
    set({ disconnectVote: null })
  },

  handleAiTakeover(playerIndex, difficulty) {
    set({ disconnectVote: null, aiTakeoverInfo: { playerIndex, difficulty } })
  },

  handleVoteUpdate(disconnectedPlayer, votesReceived, totalVoters) {
    const { disconnectVote } = get()
    if (!disconnectVote || disconnectVote.disconnectedPlayer !== disconnectedPlayer) return
    set({ disconnectVote: { ...disconnectVote, totalVoters } })
  },

  sendVote(disconnectedPlayer, choice) {
    const { _connection } = get()
    if (_connection) _connection.send({ type: 'vote', disconnectedPlayer, choice })
  },
}))
