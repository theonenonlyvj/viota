import { describe, it, expect } from 'vitest'
import { initGame, applyPlay, applyPass, applyWildRecycle } from '../src/gameLoop'
import type { Card, RegularCard, GameState, Placement } from '@viota/engine'

const R = (color: string, shape: string, n: number): Card =>
  ({ kind: 'regular', color: color as any, shape: shape as any, number: n as any })
const W = (): Card => ({ kind: 'wild' })

describe('initGame', () => {
  it('deals 4 cards to each player', () => {
    const state = initGame(2)
    expect(state.hands[0]).toHaveLength(4)
    expect(state.hands[1]).toHaveLength(4)
  })

  it('sets draw pile to 66 - (playerCount * 4) cards', () => {
    expect(initGame(2).drawPile).toHaveLength(58)
    expect(initGame(4).drawPile).toHaveLength(50)
  })

  it('starts with empty grid and zero scores', () => {
    const state = initGame(3)
    expect(state.grid.size).toBe(0)
    expect(state.scores).toEqual([0, 0, 0])
    expect(state.turnIndex).toBe(0)
  })

  it('throws if playerCount is out of range', () => {
    expect(() => initGame(1)).toThrow()
    expect(() => initGame(5)).toThrow()
  })
})

describe('applyPlay', () => {
  function stateWithOneCard(): GameState {
    // One card on grid, player 0 has a legal next card
    return {
      grid: new Map([['0,0', R('red', 'circle', 1)]]),
      hands: [[R('blue', 'circle', 2), R('green', 'circle', 3), R('yellow', 'circle', 4), R('red', 'triangle', 1)]],
      drawPile: [R('red', 'plus', 1)],
      scores: [0],
      turnIndex: 0,
      playedCards: [],
    }
  }

  it('returns error on empty turn index mismatch', () => {
    const state = stateWithOneCard()
    const pl: Placement[] = [{ card: R('blue', 'circle', 2), position: { x: 1, y: 0 } }]
    const result = applyPlay(state, 1, pl) // playerIndex 1, but turnIndex is 0
    expect('error' in result).toBe(true)
  })

  it('returns error if card is not in hand', () => {
    const state = stateWithOneCard()
    const pl: Placement[] = [{ card: R('blue', 'square', 4), position: { x: 1, y: 0 } }]
    const result = applyPlay(state, 0, pl)
    expect('error' in result).toBe(true)
  })

  it('applies a valid play, scores it, draws a replacement card', () => {
    const state = stateWithOneCard()
    const pl: Placement[] = [{ card: R('blue', 'circle', 2), position: { x: 1, y: 0 } }]
    const result = applyPlay(state, 0, pl)
    expect('error' in result).toBe(false)
    const { newState, scoreResult } = result as Exclude<typeof result, { error: string }>
    expect(scoreResult.total).toBeGreaterThan(0)
    expect(newState.grid.get('1,0')).toEqual(R('blue', 'circle', 2))
    expect(newState.hands[0]).toHaveLength(4) // drew 1 replacement
    expect(newState.scores[0]).toBeGreaterThan(0)
    expect(newState.turnIndex).toBe(0) // only 1 player
  })

  it('detects game-over when pile empty and player plays last card', () => {
    const state: GameState = {
      grid: new Map([['0,0', R('red', 'circle', 1)]]),
      hands: [[R('blue', 'circle', 2)]], // 1 card in hand
      drawPile: [], // pile already empty
      scores: [0],
      turnIndex: 0,
      playedCards: [],
    }
    const pl: Placement[] = [{ card: R('blue', 'circle', 2), position: { x: 1, y: 0 } }]
    const result = applyPlay(state, 0, pl) as Exclude<typeof result, { error: string }>
    expect(result.gameOver).toBe(true)
    expect(result.scoreResult.multiplier).toBeGreaterThanOrEqual(2) // game-ending ×2
  })

  it('advances turnIndex correctly', () => {
    const state: GameState = {
      grid: new Map([['0,0', R('red', 'circle', 1)]]),
      hands: [
        [R('blue', 'circle', 2), R('green', 'circle', 3), R('yellow', 'circle', 4), R('red', 'plus', 1)],
        [R('blue', 'triangle', 1), R('green', 'square', 1), R('yellow', 'plus', 1), R('red', 'circle', 2)],
      ],
      drawPile: [R('red', 'plus', 2)],
      scores: [0, 0],
      turnIndex: 0,
      playedCards: [],
    }
    const pl: Placement[] = [{ card: R('blue', 'circle', 2), position: { x: 1, y: 0 } }]
    const result = applyPlay(state, 0, pl) as Exclude<typeof result, { error: string }>
    expect(result.newState.turnIndex).toBe(1)
  })
})

describe('applyPass', () => {
  it('removes traded cards from hand and draws replacements', () => {
    const state: GameState = {
      grid: new Map([['0,0', R('red', 'circle', 1)]]),
      hands: [[R('red', 'plus', 1), R('blue', 'triangle', 2), R('green', 'square', 3), R('yellow', 'circle', 4)]],
      drawPile: [R('red', 'circle', 2), R('blue', 'circle', 3)],
      scores: [0],
      turnIndex: 0,
      playedCards: [],
    }
    const trades = [R('red', 'plus', 1), R('blue', 'triangle', 2)]
    const result = applyPass(state, 0, trades, trades)
    expect('error' in result).toBe(false)
    const { newState } = result as { newState: GameState }
    expect(newState.hands[0]).toHaveLength(4) // 2 removed, 2 drawn
    // traded cards go to bottom of draw pile
    expect(newState.drawPile).toHaveLength(2)
  })

  it('returns error if trade card not in hand', () => {
    const state: GameState = {
      grid: new Map([['0,0', R('red', 'circle', 1)]]),
      hands: [[R('red', 'plus', 1), R('blue', 'triangle', 2), R('green', 'square', 3), R('yellow', 'circle', 4)]],
      drawPile: [R('red', 'circle', 2)],
      scores: [0],
      turnIndex: 0,
      playedCards: [],
    }
    const result = applyPass(state, 0, [R('red', 'circle', 4)], [R('red', 'circle', 4)])
    expect('error' in result).toBe(true)
  })

  it('allows passing with 0 trades (pure pass)', () => {
    const state: GameState = {
      grid: new Map([['0,0', R('red', 'circle', 1)]]),
      hands: [[R('red', 'plus', 1), R('blue', 'triangle', 2), R('green', 'square', 3), R('yellow', 'circle', 4)]],
      drawPile: [R('red', 'circle', 2)],
      scores: [0],
      turnIndex: 0,
      playedCards: [],
    }
    const result = applyPass(state, 0, [], [])
    expect('error' in result).toBe(false)
  })
})

describe('applyWildRecycle', () => {
  it('swaps wild from grid to hand, replacement goes to grid', () => {
    const state: GameState = {
      grid: new Map([
        ['0,0', R('red', 'circle', 1)],
        ['1,0', W()],
        ['2,0', R('blue', 'circle', 3)],
      ]),
      hands: [[R('yellow', 'circle', 2), R('green', 'circle', 4), W(), R('red', 'plus', 1)]],
      drawPile: [],
      scores: [0],
      turnIndex: 0,
      playedCards: [],
    }
    const replacement = R('yellow', 'circle', 2) as RegularCard
    const result = applyWildRecycle(state, 0, { x: 1, y: 0 }, replacement)
    expect('error' in result).toBe(false)
    const { newState } = result as { newState: GameState }
    // Replacement is now on the grid
    expect(newState.grid.get('1,0')).toEqual(replacement)
    // Wild is in hand
    expect(newState.hands[0]!.some(c => c.kind === 'wild')).toBe(true)
    // Replacement removed from hand (had 1 wild + 3 regular, now should have lost one regular and gained one wild)
    expect(newState.hands[0]).toHaveLength(4)
    // turnIndex does NOT advance
    expect(newState.turnIndex).toBe(0)
  })

  it('returns error if position has no wild', () => {
    const state: GameState = {
      grid: new Map([['0,0', R('red', 'circle', 1)]]),
      hands: [[R('blue', 'circle', 2), R('green', 'circle', 3), R('yellow', 'circle', 4), R('red', 'plus', 1)]],
      drawPile: [],
      scores: [0],
      turnIndex: 0,
      playedCards: [],
    }
    const result = applyWildRecycle(state, 0, { x: 0, y: 0 }, R('blue', 'circle', 2) as RegularCard)
    expect('error' in result).toBe(true)
  })
})
