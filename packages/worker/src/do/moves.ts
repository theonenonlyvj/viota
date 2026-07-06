import {
  applyPlay,
  applyPass,
  applyWildRecycle,
  type Card,
  type GameState,
  type Placement,
  type Position,
  type RegularCard,
} from '@viota/engine'

/**
 * The move model — a discriminated union of every committable action, plus the
 * two pure helpers the pipeline relies on:
 *
 *  1. `validateMovePayloadShape` — a SHAPE/BOUNDS guard only (the mandatory
 *     `validate.ts`-style first step). It NEVER decides legality: placement
 *     counts, permutation-ness of a trade, and "replacement is a regular card"
 *     are structural facts. Whether a play/recycle is actually LEGAL (occupied
 *     cells, adjacency, line/wild consistency, card-in-hand, whose turn) is the
 *     engine's job and the engine's alone.
 *
 *  2. `applyMovePayload` — dispatches a validated payload to the correct pure
 *     engine function. The engine is the sole legality/scoring authority; this
 *     never reimplements a rule, it only routes + normalizes the result shape.
 *
 * `wild_recycle` is a real, committed action that does NOT advance the turn —
 * it must be modeled everywhere (CHECK, replay, apply) or replay diverges.
 */
export type MovePayload =
  | { type: 'play'; placements: Placement[] }
  | { type: 'pass'; trades: Card[]; tradeOrder: Card[] }
  | { type: 'wild_recycle'; wildPosition: Position; replacement: RegularCard }

export type ShapeResult =
  | { ok: true; move: MovePayload }
  | { ok: false; error: string }

/** Normalized engine result: the new state + the analytics-relevant deltas. */
export type AppliedMove = { newState: GameState; scoreDelta: number; gameOver: boolean }

const COLORS = ['blue', 'red', 'yellow', 'green']
const SHAPES = ['triangle', 'plus', 'square', 'circle']
const NUMBERS = [1, 2, 3, 4]

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function isRegularCard(c: unknown): c is RegularCard {
  return (
    isObj(c) &&
    c.kind === 'regular' &&
    typeof c.color === 'string' && COLORS.includes(c.color) &&
    typeof c.shape === 'string' && SHAPES.includes(c.shape) &&
    typeof c.number === 'number' && NUMBERS.includes(c.number)
  )
}

function isCard(c: unknown): c is Card {
  return isObj(c) && (c.kind === 'wild' || isRegularCard(c))
}

function isPosition(p: unknown): p is Position {
  return isObj(p) && Number.isInteger(p.x) && Number.isInteger(p.y)
}

function isPlacement(p: unknown): p is Placement {
  return isObj(p) && isCard(p.card) && isPosition(p.position)
}

/** Wilds are interchangeable; two regulars match on color+shape+number. */
function cardsEqual(a: Card, b: Card): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'wild') return true
  const br = b as RegularCard
  return a.color === br.color && a.shape === br.shape && a.number === br.number
}

/** True when `order` is a multiset permutation of `trades` (mirrors the engine). */
function isPermutation(trades: Card[], order: Card[]): boolean {
  if (trades.length !== order.length) return false
  const remaining = [...trades]
  for (const card of order) {
    const idx = remaining.findIndex((t) => cardsEqual(t, card))
    if (idx === -1) return false
    remaining.splice(idx, 1)
  }
  return true
}

const err = (error: string): ShapeResult => ({ ok: false, error })

/**
 * Validate a raw (untrusted) payload's shape and bounds. Returns a typed
 * `MovePayload` on success. Rejects anything the engine should never see:
 *  - play: `placements` is an array of 1-4 well-formed placements;
 *  - pass: `trades` (0-4) + `tradeOrder` are card arrays and tradeOrder permutes trades;
 *  - wild_recycle: a valid integer position + a REGULAR replacement card.
 */
export function validateMovePayloadShape(raw: unknown): ShapeResult {
  if (!isObj(raw)) return err('payload must be an object')

  switch (raw.type) {
    case 'play': {
      if (!Array.isArray(raw.placements)) return err('placements must be an array')
      if (raw.placements.length < 1 || raw.placements.length > 4) {
        return err('placements length must be 1-4')
      }
      if (!raw.placements.every(isPlacement)) return err('invalid placement')
      return { ok: true, move: { type: 'play', placements: raw.placements as Placement[] } }
    }
    case 'pass': {
      if (!Array.isArray(raw.trades)) return err('trades must be an array')
      if (!Array.isArray(raw.tradeOrder)) return err('tradeOrder must be an array')
      if (raw.trades.length > 4) return err('cannot trade more than 4 cards')
      if (!raw.trades.every(isCard)) return err('invalid trade card')
      if (!raw.tradeOrder.every(isCard)) return err('invalid tradeOrder card')
      if (!isPermutation(raw.trades as Card[], raw.tradeOrder as Card[])) {
        return err('tradeOrder must be a permutation of trades')
      }
      return { ok: true, move: { type: 'pass', trades: raw.trades as Card[], tradeOrder: raw.tradeOrder as Card[] } }
    }
    case 'wild_recycle': {
      if (!isPosition(raw.wildPosition)) return err('invalid wildPosition')
      if (!isRegularCard(raw.replacement)) return err('replacement must be a regular card')
      return {
        ok: true,
        move: { type: 'wild_recycle', wildPosition: raw.wildPosition, replacement: raw.replacement },
      }
    }
    default:
      return err('unknown move type')
  }
}

/**
 * Apply a validated payload to a GameState via the correct pure engine function.
 * The engine validates legality; on any engine error this surfaces the engine's
 * error string verbatim. Never mutates `state` (the engine returns fresh state).
 */
export function applyMovePayload(
  state: GameState,
  seatIndex: number,
  move: MovePayload,
): AppliedMove | { error: string } {
  switch (move.type) {
    case 'play': {
      const r = applyPlay(state, seatIndex, move.placements)
      if ('error' in r) return { error: r.error }
      return { newState: r.newState, scoreDelta: r.scoreResult.total, gameOver: r.gameOver }
    }
    case 'pass': {
      const r = applyPass(state, seatIndex, move.trades, move.tradeOrder)
      if ('error' in r) return { error: r.error }
      return { newState: r.newState, scoreDelta: 0, gameOver: r.gameOver }
    }
    case 'wild_recycle': {
      const r = applyWildRecycle(state, seatIndex, move.wildPosition, move.replacement)
      if ('error' in r) return { error: r.error }
      // A wild_recycle is a real committed action but NEVER advances the turn
      // and NEVER ends the game.
      return { newState: r.newState, scoreDelta: 0, gameOver: false }
    }
  }
}
