import { AIAgent, type Move } from '@viota/engine'
import type { GameRepository, SqlLike } from './storage'
import { applyAndPersist } from './apply'
import type { MovePayload } from './moves'
import { setTimer, clearTimer, hasTimer } from './timers'
import { isAnyHumanPresent, isSeatPresent } from './presence'
import { AI_STEP_MS, SOFT_TURN_MS } from './constants'

/**
 * The drive loop — the ONLY code path that produces AI moves.
 *
 * `driveIfAI` runs after every applied move, on heartbeat, on every alarm fire
 * (ai_step/heal), and on DO wake. It applies AT MOST ONE medium AI move per
 * call and paces the next one with a chained durable `ai_step` alarm — never a
 * synchronous loop — so humans see each play land and a reclaim mid-chain makes
 * the next iteration a no-op that hands control straight back.
 *
 * Freeze invariant (spec §3.6): when NO human is present the loop does not
 * drive (saves compute); the first heartbeat re-triggers it and re-drives.
 *
 * Never a second write path: the AI move goes through `applyAndPersist` inside
 * `transactionSync`, exactly like a human move, with `byAi:true` + a
 * deterministic `clientMoveId` (`ai:seat:targetMoveIndex`) so an alarm re-fire
 * is a benign idempotent no-op, and with the reclaim-race guard armed
 * (`requireAiControlled`) so a returning human aborts the AI move at commit.
 */
export interface DriveDeps {
  ctx: { storage: { transactionSync<T>(fn: () => T): T } }
  nudge(moveIndex: number): void
}

/** Engine `Move` (play|pass) → the persisted `MovePayload` shape. The medium AI
 *  never emits a wild_recycle, so this total mapping is exhaustive. */
export function toMovePayload(m: Move): MovePayload {
  if (m.type === 'play') return { type: 'play', placements: m.placements }
  return { type: 'pass', trades: m.trades, tradeOrder: m.tradeOrder }
}

export function driveIfAI(deps: DriveDeps, repo: GameRepository, sql: SqlLike, now: number): void {
  const meta = repo.getMeta()
  if (!meta || meta.status !== 'active') {
    if (meta) clearTimer(sql, 'ai_step', meta.current_seat)
    return
  }

  // FREEZE: zero humans present → do not drive; drop the current drive tick.
  if (!isAnyHumanPresent(repo, now)) {
    clearTimer(sql, 'ai_step', meta.current_seat)
    return
  }

  const currentSeat = meta.current_seat
  const seat = repo.getSeats()[currentSeat]
  if (!seat) return

  if (!seat.controlled_by_ai) {
    // A human's turn — nothing to drive. Drop any stale ai_step and arm a soft
    // AFK deadline ONCE per turn (guarded by hasTimer so repeated heartbeats
    // don't keep pushing it out) so a present idler can't freeze the table.
    clearTimer(sql, 'ai_step', currentSeat)
    if (isSeatPresent(seat, now) && !hasTimer(sql, 'soft', currentSeat)) {
      setTimer(sql, 'soft', currentSeat, now + SOFT_TURN_MS)
    }
    return
  }

  // Current seat is AI-controlled and a human is watching → drive ONE move.
  const snapshot = repo.getSnapshot()
  if (!snapshot) return
  const move = toMovePayload(AIAgent('medium')(snapshot, currentSeat))
  const targetMoveIndex = meta.move_index + 1

  const result = deps.ctx.storage.transactionSync(() =>
    applyAndPersist(sql, repo, {
      seatIndex: currentSeat,
      move,
      clientMoveId: `ai:${currentSeat}:${targetMoveIndex}`,
      accountId: null,
      byAi: true,
      aiDifficulty: 'medium',
      expectedSeat: currentSeat,
      requireAiControlled: true,
      now,
    }),
  )

  // The ai_step that scheduled this drive (if any) is now consumed.
  clearTimer(sql, 'ai_step', currentSeat)

  if ('ok' in result && result.ok) {
    deps.nudge(result.moveIndex)
    // Chain across consecutive AI seats: arm the next paced step ONLY if the new
    // current seat is itself AI-controlled. If the turn advanced to a human,
    // arm nothing (the loop hands control straight back).
    const after = repo.getMeta()
    if (after && after.status === 'active') {
      const nextRow = repo.getSeats()[after.current_seat]
      if (nextRow && nextRow.controlled_by_ai) {
        setTimer(sql, 'ai_step', after.current_seat, now + AI_STEP_MS)
      }
    }
  }
  // A 'reclaimed' abort (a human returned before commit) writes nothing and arms
  // no further tick — the drive stops and control is already back with the human.
}
