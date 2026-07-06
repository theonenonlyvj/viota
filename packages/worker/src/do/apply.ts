import { GameRepository, type MetaRow, type SqlLike } from './storage'
import { applyMovePayload, type MovePayload } from './moves'
import { buildClientView, type ClientView } from './view'

/**
 * Inputs to a single authoritative move application. `accountId` is threaded
 * from Phase 1/2 (NOT retrofitted in Phase 4): the acting account. `byAi` marks
 * a server-minted AI/floor move, which bypasses the human-ownership check and
 * carries a deterministic server-minted `clientMoveId` so an alarm re-fire is a
 * benign no-op.
 */
export type ApplyParams = {
  seatIndex: number
  move: MovePayload
  clientMoveId: string | null
  accountId: string | null
  byAi?: boolean
  aiDifficulty?: string | null
  /**
   * Reclaim-race guard (must-fix #4): a server-minted AI/floor move must be for
   * `expectedSeat` AND — when `requireAiControlled` — that seat must STILL be
   * `controlled_by_ai` at the moment the txn reads storage. The check runs
   * INSIDE the synchronous write span (`transactionSync`), so a reclaim that
   * flips `controlled_by_ai` / advances the turn before this move commits makes
   * the AI move ABORT ('reclaimed') and write nothing. This is the level-
   * triggered guard: it re-reads the freshly-persisted seat/turn, never a stale
   * value captured earlier by the drive loop.
   */
  expectedSeat?: number
  requireAiControlled?: boolean
  /** created_at; injectable for deterministic tests. */
  now?: number
}

export type ApplyResult =
  | { ok: true; moveIndex: number; view: ClientView }
  | { duplicate: true; view: ClientView }
  | { error: string }

/**
 * The authoritative move pipeline — the ENTIRE read -> validate -> write span,
 * designed to run with ZERO awaits inside `ctx.storage.transactionSync(...)`.
 * The DO fetch handler parses the request body (the only await) BEFORE calling
 * this, so the input gate stays closed across the whole span and a move POST
 * can never interleave with an alarm onto the same move_index.
 *
 * `sql` is the synchronous SQL handle the repository is bound to (same cursor);
 * it is passed for interface stability + any future raw query needs.
 *
 * Commit-then-broadcast: this only WRITES. The caller calls `nudge(moveIndex)`
 * AFTER `transactionSync` returns (i.e. after the commit).
 */
export function applyAndPersist(_sql: SqlLike, repo: GameRepository, params: ApplyParams): ApplyResult {
  const now = params.now ?? Date.now()

  // (a) status gate
  const meta = repo.getMeta()
  if (!meta) return { error: 'game_not_found' }
  if (meta.status !== 'active') return { error: 'game_over' }

  const snapshot = repo.getSnapshot()
  if (!snapshot) return { error: 'no_snapshot' }

  // (b) authz — the acting account must own the seat, unless this is a
  // server-minted AI/floor move. This MUST precede idempotency: the duplicate
  // ack (step c) returns a per-seat ClientView, so an unauthorized caller has to
  // be rejected here — before any hand is built — or replaying a known
  // clientMoveId against a seat you don't own would leak that seat's full hand.
  // Ownership is stable across reconnects, so checking it first never
  // reintroduces a false rejection on a legitimate retry (only the TURN check,
  // step d, must stay after idempotency for that).
  const seats = repo.getSeats()
  const seat = seats[params.seatIndex]
  if (!seat) return { error: 'not_your_seat' }
  if (!params.byAi && (params.accountId == null || params.accountId !== seat.owner_account_id)) {
    return { error: 'not_your_seat' }
  }

  // (c) idempotency — a duplicate clientMoveId is a benign ack with the CURRENT
  // snapshot for the (now authz-verified) seat. Checked before the TURN check so
  // a reconnect retry never surfaces a false "not your turn". (SQLite permits
  // multiple NULL client_move_id.)
  if (params.clientMoveId != null && repo.moveExistsByClientId(params.clientMoveId)) {
    return { duplicate: true, view: buildClientView(snapshot, params.seatIndex) }
  }

  // (c2) reclaim-race guard (must-fix #4) — re-read turn + AI-control from the
  // freshly-persisted rows and ABORT if a reclaim beat this AI/floor move to the
  // commit. Runs inside the sync span so nothing is written when it fires.
  if (params.requireAiControlled) {
    if (params.expectedSeat == null || meta.current_seat !== params.expectedSeat) {
      return { error: 'reclaimed' }
    }
    const guardSeat = seats[params.expectedSeat]
    if (!guardSeat || !guardSeat.controlled_by_ai) return { error: 'reclaimed' }
  }

  // (d) turn — a play/pass must be on the current seat. A wild_recycle is
  // allowed on your turn before your main action and does NOT consume the turn,
  // so its turn enforcement is delegated to the engine (applyWildRecycle also
  // requires turnIndex === seat).
  if (params.move.type !== 'wild_recycle' && params.seatIndex !== meta.current_seat) {
    return { error: 'not_your_turn' }
  }

  // (e) apply via the engine (the sole legality gate)
  const applied = applyMovePayload(snapshot, params.seatIndex, params.move)
  if ('error' in applied) return { error: applied.error }
  const { newState, scoreDelta, gameOver } = applied

  // (f) derive server-owned columns
  const moveIndex = meta.move_index + 1
  const turnNumber = repo.countTurnCompletingMoves() + 1
  const scoreAfter = newState.scores[params.seatIndex] ?? 0
  const newStatus: MetaRow['status'] = gameOver
    ? params.move.type === 'pass'
      ? 'stalemate'
      : 'completed'
    : 'active'

  // (g) write — move row FIRST so a UNIQUE(move_index) violation (a should-be-
  // impossible backstop in a sync span) writes nothing else. On conflict return
  // a benign error so the caller re-syncs, never a 500.
  try {
    repo.insertMove({
      move_index: moveIndex,
      turn_number: turnNumber,
      seat_index: params.seatIndex,
      type: params.move.type,
      payload: JSON.stringify(params.move),
      score_delta: scoreDelta,
      score_after: scoreAfter,
      by_ai: params.byAi ?? false,
      ai_difficulty: params.aiDifficulty ?? null,
      controlling_account_id: seat.owner_account_id,
      client_move_id: params.clientMoveId,
      reverted: false,
      created_at: now,
    })
  } catch {
    return { error: 'conflict' }
  }

  repo.putSnapshot(newState)
  repo.putMeta({ ...meta, move_index: moveIndex, current_seat: newState.turnIndex, status: newStatus })

  return { ok: true, moveIndex, view: buildClientView(newState, params.seatIndex) }
}
