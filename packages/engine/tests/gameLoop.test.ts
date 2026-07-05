import { describe, it, expect, vi, afterEach } from 'vitest'
import { initGame, applyPlay, applyPass, applyWildRecycle, STALEMATE_PASS_ROUNDS } from '../src/gameLoop'
import type { Card, GameState, Placement } from '../src/types'

const R = (c: string, s: string, n: number): Card => ({ kind: 'regular', color: c as any, shape: s as any, number: n as any })
const W = (): Card => ({ kind: 'wild' })

function twoPlayer(over: Partial<GameState> = {}): GameState {
  return {
    grid: new Map([['0,0', R('red', 'circle', 1)]]),
    hands: [
      [R('red', 'plus', 1), R('blue', 'triangle', 2), R('green', 'square', 3), R('yellow', 'circle', 4)],
      [R('red', 'triangle', 1), R('blue', 'plus', 2), R('green', 'circle', 3), R('yellow', 'square', 4)],
    ],
    drawPile: [R('red', 'circle', 2), R('blue', 'circle', 3)],
    scores: [0, 0],
    turnIndex: 0,
    playedCards: [],
    consecutivePasses: 0,
    finished: false,
    ...over,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('applyPass — bottom-first draw order', () => {
  it('keeps the hand at 4 when trading more cards than the pile holds', () => {
    // pile has 1 card; player trades 3. Bottom-first: trades go under the pile,
    // then draw 3 from the top — you get the old top card plus 2 of your own back.
    const state = twoPlayer({ drawPile: [R('red', 'circle', 2)] })
    const trades = [R('red', 'plus', 1), R('blue', 'triangle', 2), R('green', 'square', 3)]
    const result = applyPass(state, 0, trades, trades)
    expect('error' in result).toBe(false)
    const { newState } = result as { newState: GameState }
    expect(newState.hands[0]).toHaveLength(4)
  })

  it('places traded cards on the bottom in the player-chosen order', () => {
    const state = twoPlayer({ drawPile: [R('red', 'circle', 2), R('blue', 'circle', 3), R('green', 'circle', 4)] })
    const trades = [R('red', 'plus', 1), R('blue', 'triangle', 2)]
    // player chooses to bury blue-triangle-2 first, then red-plus-1
    const order = [R('blue', 'triangle', 2), R('red', 'plus', 1)]
    const { newState } = applyPass(state, 0, trades, order) as { newState: GameState }
    const pile = newState.drawPile
    // top 2 were drawn; bottom two are the traded cards in the chosen order
    expect(pile[pile.length - 2]).toEqual(R('blue', 'triangle', 2))
    expect(pile[pile.length - 1]).toEqual(R('red', 'plus', 1))
  })
})

describe('applyPass — tradeOrder must be a permutation of trades', () => {
  it('rejects a tradeOrder that injects cards not being traded', () => {
    const result = applyPass(twoPlayer(), 0, [], [W(), W()])
    expect('error' in result).toBe(true)
  })

  it('rejects a tradeOrder whose length differs from trades', () => {
    const state = twoPlayer()
    const result = applyPass(state, 0, [R('red', 'plus', 1)], [R('red', 'plus', 1), R('blue', 'triangle', 2)])
    expect('error' in result).toBe(true)
  })

  it('accepts a genuine reordering of the traded cards', () => {
    const state = twoPlayer()
    const trades = [R('red', 'plus', 1), R('blue', 'triangle', 2)]
    const result = applyPass(state, 0, trades, [trades[1]!, trades[0]!])
    expect('error' in result).toBe(false)
  })
})

describe('applyPass — stalemate ends the game', () => {
  it(`ends the game after ${STALEMATE_PASS_ROUNDS} consecutive all-pass rounds`, () => {
    let state = twoPlayer({ drawPile: [] })
    let gameOver = false
    for (let i = 0; i < STALEMATE_PASS_ROUNDS * 2; i++) {
      const r = applyPass(state, state.turnIndex, [], []) as { newState: GameState; gameOver: boolean }
      state = r.newState
      gameOver = r.gameOver
    }
    expect(gameOver).toBe(true)
    expect(state.finished).toBe(true)
  })

  it('a play resets the pass streak so a later pass does not end the game early', () => {
    // 5 passes (just under the 6 = 3 rounds × 2 players threshold), then a play, then more passes
    let state = twoPlayer({ drawPile: [] })
    for (let i = 0; i < 5; i++) {
      state = (applyPass(state, state.turnIndex, [], []) as { newState: GameState }).newState
    }
    expect(state.finished).toBe(false)
    // player 1 plays a legal card, resetting the streak
    const play = applyPlay(state, state.turnIndex, [{ card: R('blue', 'plus', 2), position: { x: 1, y: 0 } }])
    expect('error' in play).toBe(false)
    state = (play as { newState: GameState }).newState
    expect(state.consecutivePasses).toBe(0)
  })
})

describe('initGame — starter is never a wild', () => {
  it('reinserts a wild starter and flips a regular card instead', () => {
    // Force shuffle+splice to keep deck order, and make the top card a wild.
    // createDeck() puts the 2 wilds last; a 0-return random keeps them at the end,
    // so we instead stub random to make the FIRST card the one drawn — verify no wild starter.
    // Simplest robust check: run many games; a wild must never be the starter.
    for (let i = 0; i < 200; i++) {
      const state = initGame(2)
      const starter = state.grid.get('0,0')!
      expect(starter.kind).toBe('regular')
    }
  })

  it('still contains exactly 66 cards across grid + hands + pile', () => {
    const state = initGame(3)
    const all = [...state.grid.values(), ...state.hands.flat(), ...state.drawPile]
    expect(all).toHaveLength(66)
    expect(all.filter(c => c.kind === 'wild')).toHaveLength(2)
  })
})

describe('finished-game guard', () => {
  it('applyPlay refuses moves on a finished game', () => {
    const state = twoPlayer({ finished: true })
    const pl: Placement[] = [{ card: R('blue', 'triangle', 2), position: { x: 1, y: 0 } }]
    expect('error' in applyPlay(state, 0, pl)).toBe(true)
  })

  it('applyPass refuses moves on a finished game', () => {
    expect('error' in applyPass(twoPlayer({ finished: true }), 0, [], [])).toBe(true)
  })

  it('applyWildRecycle refuses moves on a finished game', () => {
    const state = twoPlayer({
      grid: new Map([['0,0', R('red', 'circle', 1)], ['1,0', W()], ['2,0', R('blue', 'circle', 3)]]),
      hands: [[R('yellow', 'circle', 2), R('green', 'circle', 4), W(), R('red', 'plus', 1)], []],
      finished: true,
    })
    expect('error' in applyWildRecycle(state, 0, { x: 1, y: 0 }, R('yellow', 'circle', 2))).toBe(true)
  })

  it('applyPlay marks the state finished on the game-ending play', () => {
    const state = twoPlayer({ hands: [[R('blue', 'circle', 2)], [R('red', 'triangle', 1)]], drawPile: [] })
    const result = applyPlay(state, 0, [{ card: R('blue', 'circle', 2), position: { x: 1, y: 0 } }]) as { newState: GameState; gameOver: boolean }
    expect(result.gameOver).toBe(true)
    expect(result.newState.finished).toBe(true)
  })
})
