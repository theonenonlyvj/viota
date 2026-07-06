import { env, runInDurableObject } from 'cloudflare:test'
import { it, expect, describe } from 'vitest'
import { runMigrations, GameRepository, type MoveRow } from '../src/do/storage'
import { serializeState } from '../src/do/state-codec'
import { applyMovePayload } from '../src/do/moves'
import { replay, assertRevertedContiguousSuffix } from '../src/do/replay'
import { buildScriptedGame } from './helpers'

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

/** Fold the script into (persisted move rows, live snapshot), like the pipeline. */
function foldScript(repo: GameRepository) {
  const { initialState, script } = buildScriptedGame()
  repo.putInitialState(initialState)
  repo.putSnapshot(initialState)

  let state = initialState
  let completedTurns = 0
  script.forEach((step, i) => {
    const applied = applyMovePayload(state, step.seatIndex, step.move)
    if ('error' in applied) throw new Error(`scripted move ${i} illegal: ${applied.error}`)
    const turnNumber = completedTurns + 1
    if (step.move.type !== 'wild_recycle') completedTurns++
    repo.insertMove({
      move_index: i + 1,
      turn_number: turnNumber,
      seat_index: step.seatIndex,
      type: step.move.type,
      payload: JSON.stringify(step.move),
      score_delta: applied.scoreDelta,
      score_after: applied.newState.scores[step.seatIndex] ?? 0,
      by_ai: false,
      ai_difficulty: null,
      controlling_account_id: step.accountId,
      client_move_id: `cm-${i}`,
      reverted: false,
      created_at: 1000 + i,
    })
    state = applied.newState
    repo.putSnapshot(state)
  })
  return { initialState, liveSnapshot: state }
}

describe('replay determinism (flagship)', () => {
  it('replay(initial_state, moves) byte-equals the live snapshot incl. hidden hands + drawPile order', async () => {
    await runInDurableObject(stubFor('replay-flagship'), (_i, state: any) => {
      const sql = state.storage.sql
      runMigrations(sql)
      const repo = new GameRepository(sql)

      const { liveSnapshot } = foldScript(repo)

      // Rehydrate PURELY from storage: initial_state + moves, then replay.
      const storedInitial = repo.getInitialState()!
      const storedMoves = repo.getMovesSince(0)
      const replayed = replay(storedInitial, storedMoves)

      // Codec-level equality proves every hidden hand + the exact drawPile order
      // were reconstructed byte-for-byte.
      expect(serializeState(replayed)).toBe(serializeState(liveSnapshot))
      expect(serializeState(replayed)).toBe(serializeState(repo.getSnapshot()!))

      // Concretely: the deal's drawPile order and both seats' hidden hands match.
      expect(JSON.stringify(replayed.drawPile)).toBe(JSON.stringify(liveSnapshot.drawPile))
      expect(replayed.hands).toEqual(liveSnapshot.hands)
      expect([...replayed.grid.entries()]).toEqual([...liveSnapshot.grid.entries()])
    })
  })

  it('models wild_recycle in replay: it commits a board change but does NOT advance the turn', async () => {
    await runInDurableObject(stubFor('replay-recycle'), (_i, state: any) => {
      const sql = state.storage.sql
      runMigrations(sql)
      const repo = new GameRepository(sql)
      const { initialState } = buildScriptedGame()
      foldScript(repo)

      const moves = repo.getMovesSince(0)
      // Replay only up to and including the wild_recycle (move_index 2).
      const throughRecycle = replay(initialState, moves.filter((m) => m.move_index <= 2))
      // The recycle happened (wild @ (0,0) replaced) but turn is still seat 1.
      expect(throughRecycle.grid.get('0,0')).toEqual({ kind: 'regular', color: 'red', shape: 'triangle', number: 4 })
      expect(throughRecycle.turnIndex).toBe(1)

      // The recycle row carries the same turn_number as the pass that follows it.
      const recycle = moves.find((m) => m.type === 'wild_recycle')!
      const pass = moves.find((m) => m.type === 'pass')!
      expect(recycle.turn_number).toBe(pass.turn_number)
    })
  })
})

describe('replay skips reverted rows + enforces the contiguous-suffix invariant', () => {
  const row = (i: number, seat: number, reverted: boolean): MoveRow => ({
    move_index: i,
    turn_number: i,
    seat_index: seat,
    type: 'pass',
    payload: JSON.stringify({ type: 'pass', trades: [], tradeOrder: [] }),
    score_delta: 0,
    score_after: 0,
    by_ai: true,
    ai_difficulty: 'medium',
    controlling_account_id: null,
    client_move_id: `x-${i}`,
    reverted,
    created_at: i,
  })

  it('accepts reverted rows that form a trailing run per seat', () => {
    // seat 1's reverted rows (5,6) are a suffix of seat 1's moves (3,5,6).
    const moves = [row(1, 0, false), row(2, 0, false), row(3, 1, false), row(5, 1, true), row(6, 1, true)]
    expect(() => assertRevertedContiguousSuffix(moves)).not.toThrow()
  })

  it('throws when a non-reverted row follows a reverted row for the same seat', () => {
    const moves = [row(1, 1, false), row(2, 1, true), row(3, 1, false)]
    expect(() => assertRevertedContiguousSuffix(moves)).toThrow(/contiguous suffix/i)
    expect(() => replay(buildScriptedGame().initialState, moves)).toThrow(/contiguous suffix/i)
  })

  it('folds only non-reverted moves through the engine', async () => {
    await runInDurableObject(stubFor('replay-skip'), (_i, state: any) => {
      const sql = state.storage.sql
      runMigrations(sql)
      const repo = new GameRepository(sql)
      const { initialState } = buildScriptedGame()
      foldScript(repo)

      // Mark the final play (move_index 4, seat 0) reverted; replaying without it
      // must equal replaying the first three moves.
      const all = repo.getMovesSince(0)
      const withLastReverted = all.map((m) => (m.move_index === 4 ? { ...m, reverted: true } : m))
      const firstThree = all.filter((m) => m.move_index <= 3)

      expect(serializeState(replay(initialState, withLastReverted)))
        .toBe(serializeState(replay(initialState, firstThree)))
    })
  })
})
