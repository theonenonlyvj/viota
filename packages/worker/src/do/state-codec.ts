import type { Card, GameState, RegularCard } from '@viota/engine'

/**
 * GameState <-> JSON codec for Durable Object persistence.
 *
 * CRITICAL: `GameState.grid` is a JS `Map`. `JSON.stringify` on a Map yields
 * `{}` and SILENTLY loses the entire board. Every GameState read/write in the
 * DO (initial_state, snapshot, replay) MUST route through this codec so the
 * grid survives as `[...grid.entries()]` <-> `new Map(entries)`, exactly as
 * `packages/server/src/gameState.ts` does.
 *
 * The `drawPile` is serialized as a plain array so its order survives
 * byte-exactly — replay determinism depends on it (the deal is not
 * seed-reproducible; the exact pile order is the only source of truth).
 */

type SerializedState = {
  grid: [string, Card][]
  hands: Card[][]
  drawPile: Card[]
  scores: number[]
  turnIndex: number
  playedCards: RegularCard[]
  consecutivePasses: number
  finished: boolean
}

export function serializeState(gs: GameState): string {
  const payload: SerializedState = {
    grid: [...gs.grid.entries()],
    hands: gs.hands,
    drawPile: gs.drawPile,
    scores: gs.scores,
    turnIndex: gs.turnIndex,
    playedCards: gs.playedCards,
    consecutivePasses: gs.consecutivePasses ?? 0,
    finished: gs.finished ?? false,
  }
  return JSON.stringify(payload)
}

export function deserializeState(s: string): GameState {
  const p = JSON.parse(s) as SerializedState
  return {
    grid: new Map<string, Card>(p.grid),
    hands: p.hands,
    drawPile: p.drawPile,
    scores: p.scores,
    turnIndex: p.turnIndex,
    playedCards: p.playedCards,
    consecutivePasses: p.consecutivePasses ?? 0,
    finished: p.finished ?? false,
  }
}
