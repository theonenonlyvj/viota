import type { Card, GameState, RegularCard } from '@viota/engine'
import { posKey } from '@viota/engine'
import type { MovePayload } from '../src/do/moves'
import type { SeatOwner } from '../src/do/init'

// --- Deterministic card fixtures --------------------------------------------
export const WILD: Card = { kind: 'wild' }
const RT = (n: 1 | 2 | 3 | 4): RegularCard => ({ kind: 'regular', color: 'red', shape: 'triangle', number: n })
const BS = (n: 1 | 2 | 3 | 4): RegularCard => ({ kind: 'regular', color: 'blue', shape: 'square', number: n })
const GC = (n: 1 | 2 | 3 | 4): RegularCard => ({ kind: 'regular', color: 'green', shape: 'circle', number: n })
const YP = (n: 1 | 2 | 3 | 4): RegularCard => ({ kind: 'regular', color: 'yellow', shape: 'plus', number: n })
const BC1: RegularCard = { kind: 'regular', color: 'blue', shape: 'circle', number: 1 }

/** One scripted move: who plays it, under which account, and the payload. */
export type ScriptStep = { seatIndex: number; accountId: string; move: MovePayload }

export type ScriptedGame = {
  initialState: GameState
  seatOwners: SeatOwner[]
  script: ScriptStep[]
}

/**
 * A fully deterministic, hand-crafted 2-seat game that exercises all three move
 * types (play, wild_recycle, pass, play) with every move legal against the pure
 * engine. The deal is NOT random — so replay-equality and the exact drawPile
 * order can be asserted byte-for-byte.
 *
 * Board starts: (0,0)=WILD, (1,0)=red-triangle-1. Sequence:
 *   A) seat 0 plays red-triangle-2 @ (2,0)      -> turn -> seat 1
 *   B) seat 1 recycles the wild @ (0,0) -> RT4  -> turn stays seat 1
 *   C) seat 1 passes, trading BS3+BS4           -> turn -> seat 0
 *   D) seat 0 plays red-triangle-3 @ (3,0)      -> turn -> seat 1  (a 4-card lot)
 */
export function buildScriptedGame(): ScriptedGame {
  const grid = new Map<string, Card>()
  grid.set(posKey({ x: 0, y: 0 }), WILD)
  grid.set(posKey({ x: 1, y: 0 }), RT(1))

  const initialState: GameState = {
    grid,
    hands: [
      [RT(2), RT(3), BS(1), BS(2)], // seat 0
      [RT(4), BS(3), BS(4), BC1],   // seat 1
    ],
    drawPile: [GC(1), GC(2), GC(3), GC(4), YP(1), YP(2)],
    scores: [0, 0],
    turnIndex: 0,
    playedCards: [RT(1)],
    consecutivePasses: 0,
    finished: false,
  }

  const seatOwners: SeatOwner[] = [
    { ownerType: 'human', accountId: 'acct-0', displayName: 'P0' },
    { ownerType: 'human', accountId: 'acct-1', displayName: 'P1' },
  ]

  const script: ScriptStep[] = [
    { seatIndex: 0, accountId: 'acct-0', move: { type: 'play', placements: [{ card: RT(2), position: { x: 2, y: 0 } }] } },
    { seatIndex: 1, accountId: 'acct-1', move: { type: 'wild_recycle', wildPosition: { x: 0, y: 0 }, replacement: RT(4) } },
    { seatIndex: 1, accountId: 'acct-1', move: { type: 'pass', trades: [BS(3), BS(4)], tradeOrder: [BS(4), BS(3)] } },
    { seatIndex: 0, accountId: 'acct-0', move: { type: 'play', placements: [{ card: RT(3), position: { x: 3, y: 0 } }] } },
  ]

  return { initialState, seatOwners, script }
}
