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

  // A reverted move is never deleted (audit + fidelity); it is SKIPPED on replay.
  //
  // Reverted rows are NOT required to be a contiguous suffix. The bounded veto
  // reverts the AI's most-recent turn on the reclaiming seat, then the returning
  // human plays their real move at the NEXT move_index — a non-reverted row that
  // legitimately FOLLOWS the reverted ones for that same seat. Any per-seat
  // "reverted must be a suffix" rule would false-positive on exactly that flow.
  //
  // The real safety net is legality: every non-reverted move was validated at
  // apply-time against the state produced by the non-reverted moves before it,
  // so replaying them in order reproduces that exact state. If a row was wrongly
  // reverted, a later move that depended on its effect fails to apply here and we
  // throw (below); a row wrongly NOT reverted is caught by the background
  // snapshot-vs-replay integrity check. The veto endpoint enforces its own
  // "revert only the current trailing AI run on this seat" precondition at veto
  // time — that is where trailing-ness is checked, not here.
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
