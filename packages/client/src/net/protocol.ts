import type { Card, Placement, Position, RegularCard } from '@viota/engine'

/**
 * Client-facing wire types for the HTTP-first online protocol (Worker Phases 1-5).
 *
 * These mirror the Worker's redacted projections EXACTLY — the client only ever
 * sees per-seat redacted views (own hand full; others + draw pile as counts).
 * Source of truth: packages/worker/src/do/{view,client-move,moves}.ts.
 */

/** A seat's public roster entry (names are public within a game). */
export type ClientPlayer = { seat: number; displayName: string; ownerType: string }

/** The per-seat redacted board view — the ONLY board shape a client receives. */
export type ClientView = {
  grid: [string, Card][]
  mySeat: number
  myHand: Card[]
  handCounts: number[]
  drawPileCount: number
  scores: number[]
  turnIndex: number
  playedCards: RegularCard[]
  consecutivePasses: number
  finished: boolean
  /** Live server-authoritative seat roster — refreshes every sync, unlike the
   *  one-time sessionStorage snapshot it replaces. */
  players: ClientPlayer[]
}

/** A redacted move-log row (pass trades collapse to a count; plays are public). */
export type ClientMove = {
  moveIndex: number
  turnNumber: number
  seatIndex: number
  type: 'play' | 'pass' | 'wild_recycle'
  payload: unknown
  scoreDelta: number
  scoreAfter: number
  byAi: boolean
}

/** The move payload discriminated union the Worker's /move endpoint accepts. */
export type MovePayload =
  | { type: 'play'; placements: Placement[] }
  | { type: 'pass'; trades: Card[]; tradeOrder: Card[] }
  | { type: 'wild_recycle'; wildPosition: Position; replacement: RegularCard }

/** GET /sync?since=k */
export type SyncResponse = {
  moveIndex: number
  snapshot: ClientView
  moves: ClientMove[]
}

/** POST /reclaim */
export type ReclaimResponse = {
  moveIndex: number
  snapshot: ClientView
}

/** POST /veto (200) or { vetoable:false } (409). */
export type VetoResponse =
  | { ok: true; moveIndex: number; reverted: number[]; snapshot: ClientView }
  | { vetoable: false }

/** Normalized result of POST /move (via the outbox). */
export type PostMoveResult =
  | { status: 'ok'; moveIndex: number; view: ClientView }
  | { status: 'duplicate'; view: ClientView }
  | { status: 'error'; http: number; error: string }
  | { status: 'queued' } // network failure — the move stays in the outbox
