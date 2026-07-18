import { SELF } from 'cloudflare:test'
import type { Card, GameState, RegularCard } from '@viota/engine'
import { posKey, initGame } from '@viota/engine'
import type { MovePayload } from '../src/do/moves'
import type { SeatOwner } from '../src/do/init'
import { runMigrations, GameRepository, type SqlLike } from '../src/do/storage'
import { signToken } from '../src/jwt'
import { hashCredential, sanitizeDisplayName } from '../src/d1/accounts'

// The vitest miniflare binding (vitest.config.ts) injects exactly this secret.
export const TEST_JWT_SECRET = 'test-jwt-secret-0123456789-abcdefghijklmnop'

/** Mint a valid Bearer token for an account (24h HS256). */
export function mintToken(accountId: string): Promise<string> {
  return signToken(accountId, TEST_JWT_SECRET)
}

/** `{ Authorization: 'Bearer <token>' }` for an account — the auth header. */
export async function authHeaders(accountId: string): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await mintToken(accountId)}` }
}

/**
 * TEST-ONLY: mint an account row directly in IDENTITY_DB + a legacy Bearer
 * token for it — mirrors what `POST /auth/quick` used to do locally, before
 * the identity code/data split (Step 3) turned that route into a
 * network proxy to `vgames-identity` (which the sandboxed vitest-pool-workers
 * runtime can't reach). Behavior-level coverage of `/auth/quick` itself now
 * lives in the hub package (`vgames-platform/services/identity/`); game-domain
 * tests here only need a valid canonical account + token to authenticate as.
 */
export async function mintQuickAccount(
  identityDb: D1Database,
  displayName: string,
  opts: { credential?: string } = {},
): Promise<{ token: string; accountId: string; credential: string }> {
  const credential = opts.credential ?? `${crypto.randomUUID()}${crypto.randomUUID()}`
  const credentialHash = await hashCredential(credential)
  const accountId = crypto.randomUUID()
  const now = Date.now()
  await identityDb
    .prepare(
      `INSERT INTO accounts (id, credential_hash, username, display_name, created_at, status, token_epoch, origin_game, must_change_pw, login_fail_count, last_seen_at)
       VALUES (?, ?, NULL, ?, ?, 'ghost', 0, 'iota', 0, 0, ?)`,
    )
    .bind(accountId, credentialHash, sanitizeDisplayName(displayName), now, now)
    .run()
  const token = await mintToken(accountId)
  return { token, accountId, credential }
}

/**
 * Create an ACTIVE multi-human game via the REAL authed flow (the legacy
 * unauthed seatOwners create was removed): the host (`accounts[0]`, seat 0)
 * opens a `mode:'multiplayer'` waiting room, each other account joins the next
 * open seat in order, then the host starts. Seat i is owned by `accounts[i]`;
 * any seats beyond `accounts.length` fill with medium AI at /start. Returns the
 * gameId. `initGame` always opens on seat 0, so seat 0 (the host) moves first.
 */
export async function createActiveGame(accounts: string[], playerCount: number = accounts.length): Promise<string> {
  const [host, ...joiners] = accounts
  const createRes = await SELF.fetch('https://example.com/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders(host!)) },
    body: JSON.stringify({ playerCount, mode: 'multiplayer', displayName: 'P0' }),
  })
  const { gameId } = (await createRes.json()) as { gameId: string }
  for (let i = 0; i < joiners.length; i++) {
    await SELF.fetch(`https://example.com/games/${gameId}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeaders(joiners[i]!)) },
      body: JSON.stringify({ displayName: `P${i + 1}` }),
    })
  }
  await SELF.fetch(`https://example.com/games/${gameId}/start`, {
    method: 'POST',
    headers: await authHeaders(host!),
  })
  return gameId
}

/** Create an ACTIVE solo game (seat 0 = `host`, the rest medium AI) via the
 *  authed `mode:'solo'` create. Returns the gameId. */
export async function createSoloGame(host: string, playerCount = 2): Promise<string> {
  const res = await SELF.fetch('https://example.com/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders(host)) },
    body: JSON.stringify({ playerCount, mode: 'solo', displayName: 'Solo' }),
  })
  return ((await res.json()) as { gameId: string }).gameId
}

// --- Deterministic card fixtures --------------------------------------------
export const WILD: Card = { kind: 'wild' }
const RT = (n: 1 | 2 | 3 | 4): RegularCard => ({ kind: 'regular', color: 'red', shape: 'triangle', number: n })
const BS = (n: 1 | 2 | 3 | 4): RegularCard => ({ kind: 'regular', color: 'blue', shape: 'square', number: n })
const GC = (n: 1 | 2 | 3 | 4): RegularCard => ({ kind: 'regular', color: 'green', shape: 'circle', number: n })
const YP = (n: 1 | 2 | 3 | 4): RegularCard => ({ kind: 'regular', color: 'yellow', shape: 'plus', number: n })
const BC1: RegularCard = { kind: 'regular', color: 'blue', shape: 'circle', number: 1 }

/** One scripted move: who plays it, under which account, and the payload. */
export type ScriptStep = { seatIndex: number; accountId: string; move: MovePayload }

export type ScriptedGame = {
  initialState: GameState
  seatOwners: SeatOwner[]
  script: ScriptStep[]
}

/**
 * A fully deterministic, hand-crafted 2-seat game that exercises all three move
 * types (play, wild_recycle, pass, play) with every move legal against the pure
 * engine. The deal is NOT random — so replay-equality and the exact drawPile
 * order can be asserted byte-for-byte.
 *
 * Board starts: (0,0)=WILD, (1,0)=red-triangle-1. Sequence:
 *   A) seat 0 plays red-triangle-2 @ (2,0)      -> turn -> seat 1
 *   B) seat 1 recycles the wild @ (0,0) -> RT4  -> turn stays seat 1
 *   C) seat 1 passes, trading BS3+BS4           -> turn -> seat 0
 *   D) seat 0 plays red-triangle-3 @ (3,0)      -> turn -> seat 1  (a 4-card lot)
 */
export function buildScriptedGame(): ScriptedGame {
  const grid = new Map<string, Card>()
  grid.set(posKey({ x: 0, y: 0 }), WILD)
  grid.set(posKey({ x: 1, y: 0 }), RT(1))

  const initialState: GameState = {
    grid,
    hands: [
      [RT(2), RT(3), BS(1), BS(2)], // seat 0
      [RT(4), BS(3), BS(4), BC1],   // seat 1
    ],
    drawPile: [GC(1), GC(2), GC(3), GC(4), YP(1), YP(2)],
    scores: [0, 0],
    turnIndex: 0,
    playedCards: [RT(1)],
    consecutivePasses: 0,
    finished: false,
  }

  const seatOwners: SeatOwner[] = [
    { ownerType: 'human', accountId: 'acct-0', displayName: 'P0' },
    { ownerType: 'human', accountId: 'acct-1', displayName: 'P1' },
  ]

  const script: ScriptStep[] = [
    { seatIndex: 0, accountId: 'acct-0', move: { type: 'play', placements: [{ card: RT(2), position: { x: 2, y: 0 } }] } },
    { seatIndex: 1, accountId: 'acct-1', move: { type: 'wild_recycle', wildPosition: { x: 0, y: 0 }, replacement: RT(4) } },
    { seatIndex: 1, accountId: 'acct-1', move: { type: 'pass', trades: [BS(3), BS(4)], tradeOrder: [BS(4), BS(3)] } },
    { seatIndex: 0, accountId: 'acct-0', move: { type: 'play', placements: [{ card: RT(3), position: { x: 3, y: 0 } }] } },
  ]

  return { initialState, seatOwners, script }
}

/**
 * Seed the deterministic scripted game directly into a DO's SQLite: migrate,
 * write the immutable initial_state + snapshot + meta (current_seat = 0) + both
 * human seats. Returns the repo + the scripted game so a test can drive
 * applyAndPersist against known-legal moves.
 */
export function seedScriptedGame(sql: SqlLike): { repo: GameRepository; game: ScriptedGame } {
  runMigrations(sql)
  const repo = new GameRepository(sql)
  const game = buildScriptedGame()

  repo.putInitialState(game.initialState)
  repo.putSnapshot(game.initialState)
  repo.putMeta({
    move_index: 0,
    status: 'active',
    current_seat: game.initialState.turnIndex,
    player_count: game.seatOwners.length,
    engine_version: 'viota-engine@test',
    game_uuid: 'scripted-1',
    code: null,
  })
  game.seatOwners.forEach((o, i) => {
    repo.putSeat({
      seat_index: i,
      owner_account_id: o.accountId ?? null,
      ghost_id: null,
      owner_type: o.ownerType,
      display_name: o.displayName ?? null,
      ai_difficulty: o.aiDifficulty ?? null,
      controlled_by_ai: o.controlledByAi ?? o.ownerType === 'ai',
      disconnected_at: null,
      last_seen_at: null,
      final_score: null,
    })
  })

  return { repo, game }
}

/**
 * Seed a LIVE game from a real `initGame(playerCount)` deal into a DO's SQLite,
 * with per-seat AI-control + presence flags — the fixture for the Phase-3
 * drive/alarm/presence/eviction tests.
 *
 *  - `aiSeats`: seat indices whose `controlled_by_ai` starts true.
 *  - `presentSeats`: seat indices given a fresh `last_seen_at = now` (heartbeat).
 *  - all seats are human-owned (`acct-<i>`) so an AI-covered seat still has an
 *    owner to attribute moves to.
 */
export function seedLiveGame(
  sql: SqlLike,
  opts: { playerCount: number; aiSeats?: number[]; presentSeats?: number[]; now: number },
): { repo: GameRepository; initialState: GameState } {
  runMigrations(sql)
  const repo = new GameRepository(sql)
  const ai = new Set(opts.aiSeats ?? [])
  const present = new Set(opts.presentSeats ?? [])
  const initialState = initGame(opts.playerCount)

  repo.putInitialState(initialState)
  repo.putSnapshot(initialState)
  repo.putMeta({
    move_index: 0,
    status: 'active',
    current_seat: initialState.turnIndex,
    player_count: opts.playerCount,
    engine_version: 'viota-engine@test',
    game_uuid: `live-${opts.playerCount}`,
    code: null,
  })
  for (let i = 0; i < opts.playerCount; i++) {
    repo.putSeat({
      seat_index: i,
      owner_account_id: `acct-${i}`,
      ghost_id: null,
      owner_type: 'human',
      display_name: `P${i}`,
      ai_difficulty: ai.has(i) ? 'medium' : null,
      controlled_by_ai: ai.has(i),
      disconnected_at: null,
      last_seen_at: present.has(i) ? opts.now : null,
      final_score: null,
    })
  }
  return { repo, initialState }
}
