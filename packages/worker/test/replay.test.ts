import { env, runInDurableObject } from 'cloudflare:test'
import { it, expect, describe } from 'vitest'
import { runMigrations, GameRepository, type MoveRow } from '../src/do/storage'
import { serializeState } from '../src/do/state-codec'
import { applyMovePayload } from '../src/do/moves'
import { replay } from '../src/do/replay'
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

describe('replay handles the veto pattern (reverted row followed by a non-reverted replacement)', () => {
  it('skips a reverted tail move and applies the same-seat non-reverted replacement — the veto+play flow', async () => {
    await runInDurableObject(stubFor('replay-veto'), (_i, state: any) => {
      const sql = state.storage.sql
      runMigrations(sql)
      const repo = new GameRepository(sql)

      const { initialState, liveSnapshot } = foldScript(repo)
      const rows = repo.getMovesSince(0)
      const last = rows[rows.length - 1]!

      // Simulate a bounded veto of the last move, then the returning player
      // replaying the IDENTICAL move at the next index (non-reverted). The
      // reverted row is now FOLLOWED by a non-reverted row for the SAME seat —
      // the exact pattern a per-seat contiguity rule would wrongly reject.
      const revertedLast: MoveRow = { ...last, reverted: true }
      const replacement: MoveRow = {
        ...last,
        move_index: last.move_index + 1,
        reverted: false,
        client_move_id: `replay-${last.move_index + 1}`,
      }
      const modified = [...rows.slice(0, -1), revertedLast, replacement]

      // Must NOT throw, and must reproduce the same state (replacement == original,
      // applied after the same prefix because the reverted row is skipped).
      const out = replay(initialState, modified)
      expect(serializeState(out)).toBe(serializeState(liveSnapshot))
    })
  })

  it('throws when skipping a reverted row makes a later non-reverted move illegal (the real safety net)', async () => {
    await runInDurableObject(stubFor('replay-corrupt'), (_i, state: any) => {
      const sql = state.storage.sql
      runMigrations(sql)
      const repo = new GameRepository(sql)

      const { initialState } = foldScript(repo)
      const rows = repo.getMovesSince(0)
      // Wrongly mark move 1 reverted while leaving the rest non-reverted: a later
      // move that depended on move 1's board change now fails engine legality.
      const corrupt = rows.map((r) => (r.move_index === 1 ? { ...r, reverted: true } : r))
      expect(() => replay(initialState, corrupt)).toThrow(/diverged/i)
    })
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
