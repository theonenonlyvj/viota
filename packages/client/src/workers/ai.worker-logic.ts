import { AIAgent, type Card, type GameState, type Difficulty, type Move } from '@viota/engine'

type SerializedState = Omit<GameState, 'grid'> & { grid: [string, Card][] }

export function computeAIMove(
  serialized: SerializedState,
  playerIndex: number,
  difficulty: Difficulty
): Move {
  const state: GameState = {
    ...serialized,
    grid: new Map(serialized.grid),
  }
  return AIAgent(difficulty)(state, playerIndex)
}
