import type { GameState } from '@viota/engine'
import type { GameRepository, MoveRow, SqlLike } from './storage'
import { replay } from './replay'
import { clearTimer } from './timers'

/**
 * Bounded reversible veto — the turn-theft cure (spec §4).
 *
 * The ONLY place in the system that touches committed history, and it is
 * strictly guarded: it reverts ONLY the maximal contiguous trailing run of AI
 * moves on the reclaiming seat, with nothing committed on top. It never
 * DELETES a row (audit + data fidelity) — it marks `reverted=1` and rebuilds
 * the snapshot by replaying the surviving rows through the pure engine.
 */

/**
 * The reversible tail: the maximal set of trailing NON-reverted move rows that
 * are ALL `by_ai`, ALL on `seatIndex`, and form the GLOBAL trailing run. If the
 * highest-move_index non-reverted row is not a `by_ai` row on `seatIndex`, the
 * tail is empty (someone else — or the human — committed on top → not vetoable).
 *
 * Spans WHOLE turns automatically: a turn's `wild_recycle` row(s) that precede
 * the `by_ai` play/pass are contiguous `by_ai` rows on the same seat, so they
 * are swept into the tail; a preceding row on ANY OTHER seat breaks the run.
 * Returned in ascending move_index order.
 */
export function computeReversibleTail(moves: MoveRow[], seatIndex: number): MoveRow[] {
  const live = moves.filter((m) => !m.reverted).sort((a, b) => a.move_index - b.move_index)
  const tail: MoveRow[] = []
  for (let i = live.length - 1; i >= 0; i--) {
    const m = live[i]!
    if (m.by_ai && m.seat_index === seatIndex) tail.push(m)
    else break
  }
  return tail.reverse()
}

export type VetoResult =
  | { ok: true; rebuilt: GameState; revertedIndices: number[]; moveIndex: number }
  | { ok: false }

/**
 * Perform the veto for `seatIndex` in ONE synchronous span (call this INSIDE
 * `ctx.storage.transactionSync`). If there is no reversible tail it writes
 * nothing and returns `{ok:false}`. Otherwise it:
 *   1. marks the tail rows `reverted` (NEVER deletes — audit);
 *   2. rebuilds the snapshot via replay(initialState, movesSince0) — which now
 *      skips the just-reverted rows — and persists it;
 *   3. sets `meta.current_seat = rebuilt.turnIndex` (which returns to
 *      `seatIndex`) but LEAVES `meta.move_index` at the current max, so indices
 *      stay unique + monotonic (the human's next /move gets max+1);
 *   4. reclaims the seat (controlled_by_ai=0, clear its timers, refresh presence).
 */
export function performVeto(
  repo: GameRepository,
  sql: SqlLike,
  seatIndex: number,
  now: number,
): VetoResult {
  const meta = repo.getMeta()
  if (!meta) return { ok: false }
  const initial = repo.getInitialState()
  if (!initial) return { ok: false }

  const tail = computeReversibleTail(repo.getMovesSince(0), seatIndex)
  if (tail.length === 0) return { ok: false }

  // 1. mark the trailing AI run reverted (audit-preserving).
  for (const m of tail) repo.markReverted(m.move_index)

  // 2. rebuild by replaying the surviving (non-reverted) rows through the engine.
  const rebuilt = replay(initial, repo.getMovesSince(0))
  repo.putSnapshot(rebuilt)

  // 3. current_seat returns to the reclaiming seat; move_index STAYS at max.
  repo.putMeta({
    ...meta,
    current_seat: rebuilt.turnIndex,
    status: rebuilt.finished ? meta.status : 'active',
  })

  // 4. reclaim the seat (the human plays their real move next via POST /move).
  clearTimer(sql, 'grace', seatIndex)
  clearTimer(sql, 'turn', seatIndex)
  clearTimer(sql, 'ai_step', seatIndex)
  clearTimer(sql, 'soft', seatIndex)
  repo.setControlledByAi(seatIndex, false)
  repo.setPresence(seatIndex, now)

  return { ok: true, rebuilt, revertedIndices: tail.map((m) => m.move_index), moveIndex: meta.move_index }
}
