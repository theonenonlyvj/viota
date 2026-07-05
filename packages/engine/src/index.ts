export type {
  Color, Shape, Num,
  RegularCard, WildCard, Card,
  Position, Grid,
  WildAssignment, Line, Placement,
  PlayResult, ScoreResult, Move, Difficulty, GameState,
} from './types'

export { createDeck, shuffle } from './deck'
export { posKey, fromKey, getSegment, getMaximalSegments } from './grid'
export { isValidLine, solveWilds } from './lineValidator'
export { validatePlay } from './playValidator'
export { score } from './scorer'
export { validateWildRecycle } from './wildRecycle'
export { initGame, applyPlay, applyPass, applyWildRecycle, STALEMATE_PASS_ROUNDS } from './gameLoop'
export { AIAgent } from './ai/index'
