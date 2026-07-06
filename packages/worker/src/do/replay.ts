import type { GameState } from '@viota/engine'
import type { MoveRow } from './storage'
import { applyMovePayload, type MovePayload } from './moves'

/**
 * Deterministic replay: fold the NON-`reverted` moves, in `move_index` order,
 * through the pure engine — reconstructing every hidden hand and the exact
 * drawPile order byte-for-byte. Because `initial_state` captured the post-deal
 * state (the deal uses Math.random and is NOT seed-reproducible) and draws come
 * off the persisted pile, nothing nondeterministic is recomputed.
 *
 * This is the source of truth's proof: the append-only log + the immutable deal
 * fully determine the snapshot, so a corrupted/lost snapshot is always
 * rebuildable, and analytics can reconstruct any board post-hoc.
 */
export function replay(initialState: GameState, moves: MoveRow[]): GameState {
  const sorted = [...moves].sort((a, b) => a.move_index - b.move_index)

  // A reverted move is never deleted (audit + fidelity); it is skipped on
  // replay. The veto only ever reverts a contiguous TRAILING run per seat, so a
  // non-reverted move must never follow a reverted one for the same seat —
  // violating that means the log is corrupt and replay would silently diverge.
  assertRevertedContiguousSuffix(sorted)

  let state = initialState
  for (const m of sorted) {
    if (m.reverted) continue
    const payload = JSON.parse(m.payload) as MovePayload
    const applied = applyMovePayload(state, m.seat_index, payload)
    if ('error' in applied) {
      throw new Error(`replay diverged at move_index ${m.move_index}: ${applied.error}`)
    }
    state = applied.newState
  }
  return state
}

/**
 * Throw if the `reverted` rows do not form a contiguous suffix per affected
 * seat — i.e. once a seat has a reverted move, every later move for that seat
 * must also be reverted. (Order-independent: sorts by move_index internally.)
 */
export function assertRevertedContiguousSuffix(moves: MoveRow[]): void {
  const sorted = [...moves].sort((a, b) => a.move_index - b.move_index)
  const seatSawReverted = new Set<number>()
  for (const m of sorted) {
    if (seatSawReverted.has(m.seat_index) && !m.reverted) {
      throw new Error(
        `reverted rows must form a contiguous suffix per seat: non-reverted move_index ${m.move_index} follows a reverted move for seat ${m.seat_index}`,
      )
    }
    if (m.reverted) seatSawReverted.add(m.seat_index)
  }
}
