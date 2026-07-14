import { create } from 'zustand'
import { posKey, validateWildRecycle, type Card, type RegularCard, type GameState, type Placement, type Position, type ScoreResult, type Difficulty, type Move } from '@viota/engine'
import { initGame, applyPlay, applyPass, applyWildRecycle, computeValidPositions, computePreviewScore } from '../gameLogic'
import type { ClientView as NetView, ClientMove, MovePayload, PostMoveResult, SyncResponse } from '../net/protocol'
import type { OnlineClient } from '../net/online'
import { serverUrl } from '../net/config'
import { reportLocalGame, type LocalMove } from '../net/reportGame'

type Phase = 'idle' | 'placing' | 'ai-thinking' | 'game-over'

type GameStore = {
  grid: GameState['grid']
  hands: Card[][]
  drawPile: Card[]
  scores: number[]
  turnIndex: number
  playedCards: RegularCard[]
  consecutivePasses: number
  finished: boolean
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
  mode: 'local' | 'online'
  // --- Local-game reporting (Task 8: POST /games/report) ---
  /** Minted once at local-game start; the idempotency key for /games/report. */
  localGameId: string | null
  /** The full move log for the CURRENT local game (every seat) — accumulated
   *  as moves commit, since a local game never touches the server mid-play. */
  localMoves: LocalMove[]
  localStartedAt: number | null
  /** Guards `reportLocalIfFinished` so a finished local game is ever reported ONCE. */
  localReported: boolean
  // --- New HTTP-first online state (Phase 6) ---
  gameId: string | null
  mySeat: number
  moveIndex: number
  handCounts: number[]
  /** Live server-authoritative display names, indexed by seat (fix: no more
   *  stale "Open/Open" or fabricated "Player N" — refreshes every sync). Empty
   *  until the first server view carrying a roster arrives. */
  players: string[]
  drawPileCount: number
  pending: boolean            // a local move is in flight (no optimistic board mutation)
  aiCoverSeat: number | null  // dismissible ai_cover toast target
  reclaimable: boolean        // my seat is AI-covered -> offer a reclaim
  vetoOffer: boolean          // my turn + tail is my AI moves -> offer undo-AI-turn
  net: OnlineClient | null
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
  /** Fires reportLocalGame ONCE for the current local game, iff mode==='local'
   *  and it has actually finished. Safe to call redundantly (no-ops after the
   *  first successful guard flip). */
  reportLocalIfFinished(): void
  // --- New HTTP-first online actions (Phase 6) ---
  startOnline(gameId: string, mySeat: number): void
  setOnlineClient(net: OnlineClient | null): void
  applyOnlineView(view: NetView, moveIndex: number, moves?: ClientMove[]): void
  applySync(res: SyncResponse): void
  resync(): void
  onlinePlay(): void
  onlinePass(trades: Card[], tradeOrder: Card[]): void
  onlineConfirmRecycle(replacement: RegularCard): void
  handlePostMoveResult(res: PostMoveResult): void
  reclaimSeat(): void
  doVeto(): void
  handleAiCover(seat: number): void
  dismissAiCover(): void
}

/** Append one committed LOCAL move to the game's move log (immutable — returns
 *  a NEW array, per zustand convention). `created_at` is stamped here so every
 *  caller doesn't have to. */
function appendLocalMove(moves: LocalMove[], entry: Omit<LocalMove, 'created_at'>): LocalMove[] {
  return [...moves, { ...entry, created_at: Date.now() }]
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
  consecutivePasses: 0,
  finished: false,
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
  localGameId: null,
  localMoves: [],
  localStartedAt: null,
  localReported: false,
  gameId: null,
  mySeat: 0,
  moveIndex: 0,
  handCounts: [],
  players: [],
  drawPileCount: 0,
  pending: false,
  aiCoverSeat: null,
  reclaimable: false,
  vetoOffer: false,
  net: null,

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
      localGameId: crypto.randomUUID(),
      localMoves: [],
      localStartedAt: Date.now(),
      localReported: false,
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
    const { grid, hands, drawPile, scores, turnIndex, playedCards, humanIndex, difficulty, _worker, staged, mode, localMoves } = get()
    if (staged.length === 0) return
    const gs: GameState = { grid, hands, drawPile, scores, turnIndex, playedCards, consecutivePasses: get().consecutivePasses, finished: get().finished }
    const result = applyPlay(gs, humanIndex, staged)
    if ('error' in result) return
    const { newState, scoreResult, gameOver } = result
    const nextLocalMoves =
      mode === 'local'
        ? appendLocalMove(localMoves, { seat_index: humanIndex, type: 'play', payload: JSON.stringify({ type: 'play', placements: staged }), score_delta: scoreResult.total })
        : localMoves
    if (gameOver) {
      set({ ...newState, staged: [], selectedCard: null, validPositions: [], previewScore: null, lastScoreResult: scoreResult, phase: 'game-over', localMoves: nextLocalMoves })
      get().reportLocalIfFinished()
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
      localMoves: nextLocalMoves,
    })
    if (isNextAI && _worker) postToWorker(_worker, newState, nextTurn, difficulty)
  },

  pass(trades, tradeOrder) {
    const { grid, hands, drawPile, scores, turnIndex, playedCards, humanIndex, difficulty, _worker, mode, localMoves } = get()
    const gs: GameState = { grid, hands, drawPile, scores, turnIndex, playedCards, consecutivePasses: get().consecutivePasses, finished: get().finished }
    const result = applyPass(gs, humanIndex, trades, tradeOrder)
    if ('error' in result) return
    const { newState, gameOver } = result
    const nextLocalMoves =
      mode === 'local'
        ? appendLocalMove(localMoves, { seat_index: humanIndex, type: 'pass', payload: JSON.stringify({ type: 'pass', trades, tradeOrder }), score_delta: 0 })
        : localMoves
    if (gameOver) {
      set({ ...newState, staged: [], selectedCard: null, validPositions: [], previewScore: null, phase: 'game-over', localMoves: nextLocalMoves })
      get().reportLocalIfFinished()
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
      phase: isNextAI ? 'ai-thinking' : 'idle',
      localMoves: nextLocalMoves,
    })
    if (isNextAI && _worker) postToWorker(_worker, newState, nextTurn, difficulty)
  },

  recycleWild(wildPosition, replacement) {
    const { grid, hands, drawPile, scores, turnIndex, playedCards, humanIndex, mode, localMoves } = get()
    const gs: GameState = { grid, hands, drawPile, scores, turnIndex, playedCards, consecutivePasses: get().consecutivePasses, finished: get().finished }
    const result = applyWildRecycle(gs, humanIndex, wildPosition, replacement)
    if ('error' in result) return
    // wild_recycle never advances the turn or ends the game (see gameLogic's
    // applyWildRecycle) — just log it; no gameOver/report check needed here.
    const nextLocalMoves =
      mode === 'local'
        ? appendLocalMove(localMoves, { seat_index: humanIndex, type: 'wild_recycle', payload: JSON.stringify({ type: 'wild_recycle', wildPosition, replacement }), score_delta: 0 })
        : localMoves
    set({ ...result.newState, validPositions: [], previewScore: null, localMoves: nextLocalMoves })
  },

  setWorker(worker) {
    set({ _worker: worker })
  },

  handleWorkerMessage(move) {
    const { grid, hands, drawPile, scores, turnIndex, playedCards, humanIndex, difficulty, _worker, mode, localMoves } = get()
    const gs: GameState = { grid, hands, drawPile, scores, turnIndex, playedCards, consecutivePasses: get().consecutivePasses, finished: get().finished }
    let newState: GameState
    let gameOver = false
    let scoreDelta = 0
    if (move.type === 'play') {
      const result = applyPlay(gs, turnIndex, move.placements)
      if ('error' in result) return
      newState = result.newState
      gameOver = result.gameOver
      scoreDelta = result.scoreResult.total
    } else {
      const result = applyPass(gs, turnIndex, move.trades, move.tradeOrder)
      if ('error' in result) return
      newState = result.newState
      gameOver = result.gameOver
    }
    // The AI's OWN move (seat = turnIndex, not humanIndex) — logged for
    // completeness (mirrors the online archive logging every seat), though
    // only the reporting human seat's own moves feed its derived stats.
    const nextLocalMoves =
      mode === 'local' ? appendLocalMove(localMoves, { seat_index: turnIndex, type: move.type, payload: JSON.stringify(move), score_delta: scoreDelta }) : localMoves
    if (gameOver) {
      set({ ...newState, phase: 'game-over', localMoves: nextLocalMoves })
      get().reportLocalIfFinished()
      return
    }
    const nextTurn = newState.turnIndex
    const isNextAI = nextTurn !== humanIndex
    set({ ...newState, phase: isNextAI ? 'ai-thinking' : 'idle', localMoves: nextLocalMoves })
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
    const { grid, hands, drawPile, scores, turnIndex, playedCards, humanIndex, recycleTarget, mode, localMoves } = get()
    if (!recycleTarget) return
    const gs: GameState = { grid, hands, drawPile, scores, turnIndex, playedCards, consecutivePasses: get().consecutivePasses, finished: get().finished }
    const result = applyWildRecycle(gs, humanIndex, recycleTarget, replacement)
    if ('error' in result) return
    // wild_recycle never advances the turn or ends the game (see gameLogic's
    // applyWildRecycle) — just log it; no gameOver/report check needed here.
    const nextLocalMoves =
      mode === 'local'
        ? appendLocalMove(localMoves, { seat_index: humanIndex, type: 'wild_recycle', payload: JSON.stringify({ type: 'wild_recycle', wildPosition: recycleTarget, replacement }), score_delta: 0 })
        : localMoves
    set({ ...result.newState, recycleTarget: null, recycleValidCards: [], validPositions: [], previewScore: null, localMoves: nextLocalMoves })
  },

  /**
   * Uploads the just-finished LOCAL game via `reportLocalGame` (Task 8) —
   * fire-and-forget, called from confirmPlay/pass/handleWorkerMessage's
   * gameOver branches. `localReported` guards it so a finished local game is
   * ever reported ONCE, no matter how this gets re-entered. Never touches
   * online state/behavior (no-ops unless mode==='local').
   */
  reportLocalIfFinished() {
    const s = get()
    if (s.mode !== 'local' || !s.finished || s.localReported) return
    set({ localReported: true })
    void reportLocalGame(serverUrl(), {
      clientGameId: s.localGameId ?? crypto.randomUUID(),
      playerCount: s.playerCount,
      humanSeat: s.humanIndex,
      scores: s.scores,
      moves: s.localMoves,
      startedAt: s.localStartedAt ?? Date.now(),
      endedAt: Date.now(),
    })
  },

  // === New HTTP-first online mode (Phase 6) ===============================

  startOnline(gameId, mySeat) {
    set({
      mode: 'online',
      gameId,
      mySeat,
      humanIndex: mySeat,
      moveIndex: 0,
      pending: false,
      aiCoverSeat: null,
      reclaimable: false,
      vetoOffer: false,
      grid: new Map(),
      hands: [],
      handCounts: [],
      players: [],
      drawPileCount: 0,
      scores: [],
      turnIndex: 0,
      playedCards: [],
      consecutivePasses: 0,
      finished: false,
      selectedCard: null,
      staged: [],
      validPositions: [],
      previewScore: null,
      recycleTarget: null,
      recycleValidCards: [],
      phase: 'ai-thinking',
    })
  },

  setOnlineClient(net) {
    set({ net })
  },

  /**
   * Replace state WHOLESALE from an authoritative ClientView (spec §3/§5) — never
   * a merge. Ignores a stale/lower moveIndex. Clears the pending affordance +
   * any staged/selection (the authoritative board is the truth). No optimistic
   * mutation ever happens, so there is nothing to reconcile.
   */
  applyOnlineView(view, moveIndex, moves) {
    if (moveIndex < get().moveIndex) return // stale echo — ignore
    const grid = new Map(view.grid)
    const hands: Card[][] = Array.from({ length: view.handCounts.length }, () => [])
    hands[view.mySeat] = view.myHand
    const isMyTurn = view.turnIndex === view.mySeat
    const last = moves && moves.length > 0 ? moves[moves.length - 1] : undefined
    const vetoOffer = !!(isMyTurn && !view.finished && last && last.byAi && last.seatIndex === view.mySeat)
    // Server-authoritative names (seat order), when the view carries a roster.
    // Empty when it doesn't (never in production; only an under-specified test
    // fixture), so the caller can fall back to whatever it had before.
    const players = (view.players ?? []).map((p) => p.displayName)
    set({
      mode: 'online',
      moveIndex,
      mySeat: view.mySeat,
      humanIndex: view.mySeat,
      playerCount: view.handCounts.length,
      grid,
      hands,
      handCounts: view.handCounts,
      players,
      drawPileCount: view.drawPileCount,
      scores: view.scores,
      turnIndex: view.turnIndex,
      playedCards: view.playedCards,
      consecutivePasses: view.consecutivePasses,
      finished: view.finished,
      staged: [],
      selectedCard: null,
      validPositions: [],
      previewScore: null,
      recycleTarget: null,
      recycleValidCards: [],
      pending: false,
      // Once it is my turn I control my seat again — clear any reclaim offer.
      reclaimable: isMyTurn ? false : get().reclaimable,
      vetoOffer,
      phase: view.finished ? 'game-over' : isMyTurn ? 'idle' : 'ai-thinking',
    })
  },

  applySync(res) {
    get().applyOnlineView(res.snapshot, res.moveIndex, res.moves)
  },

  resync() {
    const { net, moveIndex } = get()
    if (!net) return
    net.sync(moveIndex).then((r) => get().applySync(r)).catch(() => {})
  },

  /** Show the pending affordance: input disabled, played cards dimmed, no board
   *  mutation. Cleared on the authoritative echo (applyOnlineView). */
  onlinePlay() {
    const { net, staged, finished } = get()
    if (!net || finished || staged.length === 0) return
    const move: MovePayload = { type: 'play', placements: staged.map((p) => ({ card: p.card, position: p.position })) }
    const clientMoveId = crypto.randomUUID()
    set({ pending: true, selectedCard: null, validPositions: [], previewScore: null })
    net.postMove(move, clientMoveId).then((r) => get().handlePostMoveResult(r)).catch(() => {})
  },

  onlinePass(trades, tradeOrder) {
    const { net, finished } = get()
    if (!net || finished) return
    const move: MovePayload = { type: 'pass', trades, tradeOrder }
    const clientMoveId = crypto.randomUUID()
    set({ pending: true, selectedCard: null, validPositions: [], previewScore: null, staged: [] })
    net.postMove(move, clientMoveId).then((r) => get().handlePostMoveResult(r)).catch(() => {})
  },

  onlineConfirmRecycle(replacement) {
    const { net, recycleTarget, finished } = get()
    if (!net || finished || !recycleTarget) return
    const move: MovePayload = { type: 'wild_recycle', wildPosition: recycleTarget, replacement }
    const clientMoveId = crypto.randomUUID()
    set({ recycleTarget: null, recycleValidCards: [], pending: true })
    net.postMove(move, clientMoveId).then((r) => get().handlePostMoveResult(r)).catch(() => {})
  },

  handlePostMoveResult(res) {
    if (res.status === 'ok') {
      get().applyOnlineView(res.view, res.moveIndex)
    } else if (res.status === 'duplicate' || res.status === 'error') {
      // Already applied, or the server rejected — pull authoritative truth.
      get().resync()
    }
    // 'queued' (offline): leave pending; the reconcile drain + re-sync resolves it.
  },

  reclaimSeat() {
    const { net } = get()
    if (!net) return
    set({ reclaimable: false })
    net.reclaim().then((r) => { if (r) get().applyOnlineView(r.snapshot, r.moveIndex) }).catch(() => {})
  },

  doVeto() {
    const { net } = get()
    if (!net) return
    net.veto().then((r) => {
      if ('ok' in r && r.ok) get().applyOnlineView(r.snapshot, r.moveIndex)
      else set({ vetoOffer: false })
    }).catch(() => set({ vetoOffer: false }))
  },

  handleAiCover(seat) {
    const { mySeat } = get()
    set({ aiCoverSeat: seat, reclaimable: seat === mySeat ? true : get().reclaimable })
  },

  dismissAiCover() {
    set({ aiCoverSeat: null })
  },
}))
