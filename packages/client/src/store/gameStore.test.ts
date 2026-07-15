import { beforeEach, expect, test, vi } from 'vitest'
import { useGameStore } from './gameStore'
import { posKey } from '@viota/engine'
import type { Card, RegularCard, Move, Position } from '@viota/engine'
import { computeValidPositions } from '../gameLogic'
import { reportLocalGame } from '../net/reportGame'

vi.mock('../net/reportGame', () => ({ reportLocalGame: vi.fn().mockResolvedValue(undefined) }))

function store() { return useGameStore.getState() }

beforeEach(() => {
  vi.clearAllMocks()
  store().startGame(2, 'easy')
})

test('startGame initialises 2-player state with starter card', () => {
  const s = store()
  expect(s.hands).toHaveLength(2)
  expect(s.hands[0]).toHaveLength(4)
  expect(s.scores).toEqual([0, 0])
  expect(s.phase).toBe('idle')
  expect(s.staged).toHaveLength(0)
  expect(s.selectedCard).toBeNull()
  expect(s.grid.size).toBe(1) // starter card
  expect(s.grid.has(posKey({ x: 0, y: 0 }))).toBe(true)
})

test('selectCard sets selectedCard and computes validPositions adjacent to starter', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  expect(store().selectedCard).toBe(card)
  // (0,0) is occupied by starter, valid positions should be adjacent
  expect(store().validPositions).not.toContainEqual({ x: 0, y: 0 })
  // Should have some valid positions (or none if card is incompatible)
  expect(Array.isArray(store().validPositions)).toBe(true)
})

test('placeCard adds placement to staged and clears selectedCard', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  const validPos = store().validPositions
  if (validPos.length === 0) return // skip if no valid position for this random hand
  const pos = validPos[0]!
  store().placeCard(pos)
  const s = store()
  expect(s.staged).toHaveLength(1)
  expect(s.staged[0]!.card).toBe(card)
  expect(s.staged[0]!.position).toEqual(pos)
  expect(s.selectedCard).toBeNull()
  expect(s.phase).toBe('placing')
})

test('unstageCard removes placement and returns phase to idle', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  const validPos = store().validPositions
  if (validPos.length === 0) return
  const pos = validPos[0]!
  store().placeCard(pos)
  store().unstageCard(pos)
  const s = store()
  expect(s.staged).toHaveLength(0)
  expect(s.phase).toBe('idle')
})

test('confirmPlay applies play, advances turn to AI, sets phase ai-thinking', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  const validPos = store().validPositions
  if (validPos.length === 0) return
  const pos = validPos[0]!
  store().placeCard(pos)
  store().confirmPlay()
  const s = store()
  expect(s.grid.get(posKey(pos))).toEqual(card)
  expect(s.staged).toHaveLength(0)
  expect(s.phase).toBe('ai-thinking')
})

test('confirmPlay triggers worker postMessage when AI turn follows', () => {
  const mockWorker = { postMessage: vi.fn() } as unknown as Worker
  store().setWorker(mockWorker)
  const card = store().hands[0]![0]!
  store().selectCard(card)
  const validPos = store().validPositions
  if (validPos.length === 0) { store().setWorker(null); return }
  const pos = validPos[0]!
  store().placeCard(pos)
  store().confirmPlay()
  expect(mockWorker.postMessage).toHaveBeenCalledOnce()
  const msg = (mockWorker.postMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0]
  expect(msg.type).toBe('getMove')
  expect(msg.playerIndex).toBe(1)
  store().setWorker(null)
})

test('pass advances turn and triggers AI when applicable', () => {
  store().pass([], [])
  const s = store()
  expect(s.turnIndex).toBe(1)
  expect(s.phase).toBe('ai-thinking')
})

test('handleWorkerMessage applies pass move and advances to human turn', () => {
  store().pass([], [])
  const move: Move = { type: 'pass', trades: [], tradeOrder: [] }
  store().handleWorkerMessage(move)
  expect(store().turnIndex).toBe(0)
  expect(store().phase).toBe('idle')
})

test('previewScore is null after unstaging all cards', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  const validPos = store().validPositions
  if (validPos.length === 0) return
  const pos = validPos[0]!
  store().placeCard(pos)
  store().unstageCard(pos)
  expect(store().previewScore).toBeNull()
})

test('startRecycle sets recycleTarget and computes recycleValidCards', () => {
  const s = store()
  const wildPos: Position = { x: 1, y: 0 }
  const newGrid = new Map(s.grid)
  newGrid.set(posKey(wildPos), { kind: 'wild' } as Card)
  useGameStore.setState({ grid: newGrid })

  store().startRecycle(wildPos)
  expect(store().recycleTarget).toEqual(wildPos)
  expect(Array.isArray(store().recycleValidCards)).toBe(true)
})

test('startRecycle ignores non-wild positions', () => {
  store().startRecycle({ x: 0, y: 0 })
  expect(store().recycleTarget).toBeNull()
})

test('cancelRecycle clears recycleTarget', () => {
  const s = store()
  const wildPos: Position = { x: 1, y: 0 }
  const newGrid = new Map(s.grid)
  newGrid.set(posKey(wildPos), { kind: 'wild' } as Card)
  useGameStore.setState({ grid: newGrid })

  store().startRecycle(wildPos)
  expect(store().recycleTarget).not.toBeNull()
  store().cancelRecycle()
  expect(store().recycleTarget).toBeNull()
  expect(store().recycleValidCards).toEqual([])
})

test('confirmRecycle swaps wild with hand card and clears recycle state', () => {
  const s = store()
  const wildPos: Position = { x: 1, y: 0 }
  const newGrid = new Map(s.grid)
  newGrid.set(posKey(wildPos), { kind: 'wild' } as Card)
  useGameStore.setState({ grid: newGrid })

  store().startRecycle(wildPos)
  const validCards = store().recycleValidCards
  if (validCards.length === 0) return

  const replacement = validCards[0]! as RegularCard
  store().confirmRecycle(replacement)

  expect(store().grid.get(posKey(wildPos))).toEqual(replacement)
  expect(store().hands[0]!.some(c => c.kind === 'wild')).toBe(true)
  expect(store().recycleTarget).toBeNull()
  expect(store().recycleValidCards).toEqual([])
})

test('startRecycle excludes staged cards from recycleValidCards', () => {
  const s = store()
  const wildPos: Position = { x: 1, y: 0 }
  const newGrid = new Map(s.grid)
  newGrid.set(posKey(wildPos), { kind: 'wild' } as Card)
  useGameStore.setState({ grid: newGrid })

  const card = store().hands[0]![0]!
  store().selectCard(card)
  const validPos = store().validPositions
  if (validPos.length > 0) {
    store().placeCard(validPos[0]!)
  }

  store().startRecycle(wildPos)
  const stagedCards = new Set(store().staged.map(p => p.card))
  for (const vc of store().recycleValidCards) {
    expect(stagedCards.has(vc)).toBe(false)
  }
})

// The old vote-based online mode was deleted in Phase 6 (auto-cover + the
// HTTP-first store path replace it). New online-store tests live in
// gameStore.online.test.ts.

// --- Task 8: local-game move log + report-on-finish wiring -----------------

const RT = (n: 1 | 2 | 3 | 4): RegularCard => ({ kind: 'regular', color: 'red', shape: 'triangle', number: n })

/** Force the store into a ONE-MOVE-FROM-OVER local state: an empty draw pile
 *  and a 1-card human hand, so `confirmPlay`'s single play satisfies the
 *  engine's game-ending rule (`drawPile.length===0 && placements.length===
 *  hand.length` — see gameLoop.ts's applyPlay). The wild+red-triangle-1/2
 *  geometry is the SAME proven-legal fixture packages/worker/test/helpers.ts
 *  drives for real (buildScriptedGame's step A). */
function forceOneMoveFromGameOver() {
  const grid = new Map<string, Card>()
  grid.set(posKey({ x: 0, y: 0 }), { kind: 'wild' })
  grid.set(posKey({ x: 1, y: 0 }), RT(1))
  const playCard = RT(2)
  useGameStore.setState({
    grid,
    hands: [[playCard], []],
    drawPile: [],
    scores: [0, 0],
    turnIndex: 0,
    playedCards: [RT(1)],
    consecutivePasses: 0,
    finished: false,
    playerCount: 2,
    humanIndex: 0,
    mode: 'local',
    staged: [{ card: playCard, position: { x: 2, y: 0 } }],
    localMoves: [],
    localReported: false,
  })
}

test('confirmPlay accumulates a local move log entry with the engine-derived score_delta', () => {
  store().pass([], []) // seat 0 passes (turnIndex -> 1), logged as this game's move #1
  expect(store().localMoves).toHaveLength(1)
  expect(store().localMoves[0]).toMatchObject({ seat_index: 0, type: 'pass', score_delta: 0 })
  expect(typeof store().localMoves[0]!.created_at).toBe('number')
})

test('a finished LOCAL game calls reportLocalGame exactly once, with the move log + humanSeat', () => {
  forceOneMoveFromGameOver()

  store().confirmPlay()

  expect(store().finished).toBe(true)
  expect(store().phase).toBe('game-over')
  expect(store().localReported).toBe(true)
  expect(reportLocalGame).toHaveBeenCalledTimes(1)

  const [url, game] = (reportLocalGame as ReturnType<typeof vi.fn>).mock.calls[0]!
  expect(typeof url).toBe('string')
  expect(game.humanSeat).toBe(0)
  expect(game.scores).toEqual(store().scores)
  expect(game.moves).toHaveLength(1)
  expect(game.moves[0]).toMatchObject({ seat_index: 0, type: 'play' })

  // Re-entering the finished-game report path (e.g. a stray re-render/call)
  // must never double-report.
  store().reportLocalIfFinished()
  expect(reportLocalGame).toHaveBeenCalledTimes(1)
})

test('reportLocalIfFinished no-ops for an online game (never reports online play)', () => {
  useGameStore.setState({ mode: 'online', finished: true, localReported: false })
  store().reportLocalIfFinished()
  expect(reportLocalGame).not.toHaveBeenCalled()
})
