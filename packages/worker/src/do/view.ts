import type { Card, GameState, RegularCard } from '@viota/engine'

/**
 * Per-seat redacted client view — the ONLY shape a client ever receives.
 *
 * Redaction boundary (hard rule):
 *  - the board `grid` is public;
 *  - the requesting seat's own hand is FULL;
 *  - every OTHER seat's hand is a COUNT only (never the cards);
 *  - the `drawPile` is a COUNT only (never the ordered array — leaking the
 *    order would break the hidden-information game AND replay secrecy);
 *  - `initial_state` has no client-reachable path at all.
 *
 * `grid` is emitted as entries (`[...grid.entries()]`) — the Map-safe wire form
 * the codec uses — so the client can rebuild it as `new Map(entries)`.
 */
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
}

export function buildClientView(state: GameState, seatIndex: number): ClientView {
  return {
    grid: [...state.grid.entries()],
    mySeat: seatIndex,
    myHand: state.hands[seatIndex] ?? [], // own hand FULL
    handCounts: state.hands.map((h) => h.length), // others -> COUNT only
    drawPileCount: state.drawPile.length, // COUNT only, never the array
    scores: state.scores,
    turnIndex: state.turnIndex,
    playedCards: state.playedCards,
    consecutivePasses: state.consecutivePasses ?? 0,
    finished: state.finished ?? false,
  }
}
