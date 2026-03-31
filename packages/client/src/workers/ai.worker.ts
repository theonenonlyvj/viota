import { computeAIMove } from './ai.worker-logic'
import type { Difficulty } from '@viota/engine'

self.onmessage = (e: MessageEvent) => {
  const { type, state, playerIndex, difficulty } = e.data as {
    type: string
    state: Parameters<typeof computeAIMove>[0]
    playerIndex: number
    difficulty: Difficulty
  }
  if (type === 'getMove') {
    const move = computeAIMove(state, playerIndex, difficulty)
    self.postMessage({ move })
  }
}
