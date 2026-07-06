import { initGame } from '@viota/engine'
import type { GameState } from '@viota/engine'
import type { GameRepository, MetaRow, SeatRow } from './storage'

/** Describes who sits in each seat at game creation. Index == seat_index. */
export type SeatOwner = {
  ownerType: SeatRow['owner_type']
  accountId?: string | null
  ghostId?: string | null
  displayName?: string | null
  aiDifficulty?: string | null
  /** Defaults to true iff ownerType === 'ai'. */
  controlledByAi?: boolean
}

export type InitOptions = {
  engineVersion?: string
  gameUuid?: string
}

export type InitResult = { initialState: GameState; meta: MetaRow }

/** Fallback engine tag until the engine package exports a version. */
const DEFAULT_ENGINE_VERSION = 'viota-engine@0'

/**
 * Create a game for online play.
 *
 * Calls the pure engine `initGame(playerCount)` (the engine is NEVER modified)
 * and captures the POST-DEAL GameState as the immutable `initial_state` — this
 * is mandatory for replay because `initGame` uses `Math.random` (shuffle +
 * wild-starter reinsert), so the deal is not seed-reproducible; the exact
 * drawPile order is the only source of truth.
 *
 * Idempotent: if the game was already initialized (initial_state present), this
 * is a no-op that returns the existing state + meta — a re-create can never
 * clobber the immutable deal or the seat assignments.
 *
 * GameState index == seat_index throughout.
 */
export function initGameForOnline(
  repo: GameRepository,
  playerCount: number,
  seatOwners: SeatOwner[],
  opts: InitOptions = {},
): InitResult {
  // Already initialized -> return existing (immutable) truth.
  const existing = repo.getInitialState()
  if (existing) {
    const meta = repo.getMeta()
    if (meta) return { initialState: existing, meta }
  }

  const initialState = initGame(playerCount)

  const meta: MetaRow = {
    move_index: 0,
    status: 'active',
    current_seat: initialState.turnIndex,
    player_count: playerCount,
    engine_version: opts.engineVersion ?? DEFAULT_ENGINE_VERSION,
    game_uuid: opts.gameUuid ?? crypto.randomUUID(),
  }

  // Write-once immutable deal + the initial rebuildable snapshot + meta.
  repo.putInitialState(initialState) // ON CONFLICT DO NOTHING -> immutable
  repo.putSnapshot(initialState)
  repo.putMeta(meta)

  // Seat table: GameState index == seat_index.
  for (let i = 0; i < playerCount; i++) {
    const o = seatOwners[i] ?? { ownerType: 'open' as const }
    repo.putSeat({
      seat_index: i,
      owner_account_id: o.accountId ?? null,
      ghost_id: o.ghostId ?? null,
      owner_type: o.ownerType,
      display_name: o.displayName ?? null,
      ai_difficulty: o.aiDifficulty ?? null,
      controlled_by_ai: o.controlledByAi ?? o.ownerType === 'ai',
      disconnected_at: null,
      last_seen_at: null,
      final_score: null,
    })
  }

  return { initialState, meta }
}
