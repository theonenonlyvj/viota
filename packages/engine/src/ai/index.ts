import type { GameState, Move, Difficulty } from '../types'
import { easyMove } from './easy'
import { mediumMove } from './medium'
import { hardMove } from './hard'
import { expertMove } from './expert'

export function AIAgent(difficulty: Difficulty): (state: GameState, playerIndex: number) => Move {
  switch (difficulty) {
    case 'easy':   return easyMove
    case 'medium': return mediumMove
    case 'hard':   return hardMove
    case 'expert': return expertMove
  }
}
