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
 * Deal into an already-seated game (the /start path for a waiting room) OR as
 * the deal step of a fresh solo create. Runs the pure engine `initGame` (never
 * modified), captures the POST-DEAL GameState as the immutable `initial_state`
 * (mandatory for replay — the shuffle is not seed-reproducible), writes the
 * initial snapshot, and flips `meta.status='active'` with `current_seat` =
 * the dealt `turnIndex`. It NEVER writes the `seats` table, so seat owners
 * claimed while the room was `'waiting'` are preserved exactly.
 *
 * Idempotent: if the deal already happened (`initial_state` present) it returns
 * the existing immutable state + meta — a double /start can never re-deal.
 * `game_uuid` / `engine_version` / `code` are taken from the existing meta when
 * present (the waiting room already minted them), else from `opts`.
 */
export function dealInto(repo: GameRepository, playerCount: number, opts: InitOptions = {}): InitResult {
  const existing = repo.getInitialState()
  if (existing) {
    const meta = repo.getMeta()
    if (meta) return { initialState: existing, meta }
  }

  const initialState = initGame(playerCount)
  const prior = repo.getMeta()

  const meta: MetaRow = {
    move_index: 0,
    status: 'active',
    current_seat: initialState.turnIndex,
    player_count: playerCount,
    engine_version: prior?.engine_version ?? opts.engineVersion ?? DEFAULT_ENGINE_VERSION,
    game_uuid: prior?.game_uuid ?? opts.gameUuid ?? crypto.randomUUID(),
    code: prior?.code ?? null,
  }

  repo.putInitialState(initialState) // ON CONFLICT DO NOTHING -> immutable
  repo.putSnapshot(initialState)
  repo.putMeta(meta)

  return { initialState, meta }
}

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

  // Seat table: GameState index == seat_index. Written before the deal so
  // `dealInto` (which reads meta but never touches seats) leaves them intact.
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

  // Deal immediately (the solo/legacy path): write-once immutable deal +
  // snapshot + active meta.
  return dealInto(repo, playerCount, opts)
}

export type CreateWaitingRoomOptions = {
  playerCount: number
  hostAccountId: string
  hostDisplayName: string | null
  gameUuid?: string
  engineVersion?: string
  code?: string | null
}

/**
 * Create a MULTIPLAYER waiting room (the join-by-code lobby entry point).
 *
 * Writes `meta` with `status='waiting'`, `move_index=0`, `current_seat=0`, and
 * the room `code`, plus the `seats` table: seat 0 = the host (human), seats
 * 1..playerCount-1 = `'open'` (claimable via POST /join). There is deliberately
 * NO deal here — no `initial_state`/`snapshot` — so nothing is dealt until a
 * player hits /start. Idempotent: a re-create returns the existing meta.
 */
export function createWaitingRoom(repo: GameRepository, opts: CreateWaitingRoomOptions): { meta: MetaRow } {
  const existing = repo.getMeta()
  if (existing) return { meta: existing }

  const meta: MetaRow = {
    move_index: 0,
    status: 'waiting',
    current_seat: 0,
    player_count: opts.playerCount,
    engine_version: opts.engineVersion ?? DEFAULT_ENGINE_VERSION,
    game_uuid: opts.gameUuid ?? crypto.randomUUID(),
    code: opts.code ?? null,
  }
  repo.putMeta(meta)

  // Seat 0 = the host.
  repo.putSeat({
    seat_index: 0,
    owner_account_id: opts.hostAccountId,
    ghost_id: null,
    owner_type: 'human',
    display_name: opts.hostDisplayName,
    ai_difficulty: null,
    controlled_by_ai: false,
    disconnected_at: null,
    last_seen_at: null,
    final_score: null,
  })
  // Remaining seats start open.
  for (let i = 1; i < opts.playerCount; i++) {
    repo.putSeat({
      seat_index: i,
      owner_account_id: null,
      ghost_id: null,
      owner_type: 'open',
      display_name: null,
      ai_difficulty: null,
      controlled_by_ai: false,
      disconnected_at: null,
      last_seen_at: null,
      final_score: null,
    })
  }

  return { meta }
}
