import type { GameState, Move } from '../types'
import { hardMove } from './hard'

// Expert: hard + 1-ply opponent model (stub — delegates to hard for now)
export function expertMove(state: GameState, playerIndex: number): Move {
  return hardMove(state, playerIndex)
}
