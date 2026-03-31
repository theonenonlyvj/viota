import type { GameState, Move } from '../types'
import { mediumMove } from './medium'

// Hard: medium + positional heuristics (stub — delegates to medium for now)
export function hardMove(state: GameState, playerIndex: number): Move {
  return mediumMove(state, playerIndex)
}
