import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyD1Schema } from '../src/d1/schema'
import { backfillStats } from '../src/stats/backfill'
import { SignJWT } from 'jose'
import worker from '../src/index'

/**
 * Task 6 — backfill (Phase 3). The shared test D1 is NOT isolated per file
 * (vitest.config.ts: singleWorker+isolatedStorage:false), and other suites
 * (e.g. my-games.test.ts) deliberately leave 'completed'-status game_players
 * rows with a NULL result sitting in the SAME database. So every assertion
 * here is scoped to THIS test's own game_uuid — never a global/exact count of
 * backfillStats's return value, which can legitimately include unrelated
 * leftover rows from other suites.
 */

const ADMIN_SECRET = 'admin-secret-0123456789-abcdefghijklmnop'
const DB = () => (env as unknown as { DB: D1Database }).DB

async function adminTok(secret = ADMIN_SECRET, aud = 'vgames-admin', iss = 'vgames'): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('vijay')
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(secret))
}

async function mkAccount(id: string): Promise<void> {
  const now = Date.now()
  await DB()
    .prepare(
      `INSERT INTO accounts (id,credential_hash,display_name,created_at,status,token_epoch,origin_game,must_change_pw,login_fail_count,last_seen_at) VALUES (?,?,?,?,'ghost',0,'iota',0,0,?)`,
    )
    .bind(id, 'c' + id, id, now, now)
    .run()
}

type SeedSeat = { seat: number; accountId: string | null; ownerType: 'human' | 'ai'; finalScore: number }

/** Seed a games row + its game_players seats + a couple of 'play' moves per
 *  human seat (so computeSeatStats has real input), all under one game_uuid. */
async function seedGame(
  gameUuid: string,
  status: string,
  seats: SeedSeat[],
  opts: { winnerSeat: number | null; endedAt: number },
): Promise<void> {
  await DB()
    .prepare(`INSERT INTO games (game_uuid, status, player_count, winner_seat, ended_at, created_at, game_type) VALUES (?, ?, ?, ?, ?, ?, 'iota')`)
    .bind(gameUuid, status, seats.length, opts.winnerSeat, opts.endedAt, opts.endedAt - 10_000)
    .run()
  for (const s of seats) {
    await DB()
      .prepare(`INSERT INTO game_players (game_uuid, seat_index, account_id, owner_type, final_score) VALUES (?, ?, ?, ?, ?)`)
      .bind(gameUuid, s.seat, s.accountId, s.ownerType, s.finalScore)
      .run()
  }
  let moveIndex = 0
  for (const s of seats) {
    if (s.ownerType !== 'human') continue
    moveIndex++
    await DB()
      .prepare(
        `INSERT INTO moves (game_uuid, move_index, turn_number, seat_index, type, payload, score_delta, score_after, by_ai, reverted, created_at)
         VALUES (?, ?, ?, ?, 'play', ?, ?, ?, 0, 0, ?)`,
      )
      .bind(
        gameUuid,
        moveIndex,
        moveIndex,
        s.seat,
        JSON.stringify({ type: 'play', placements: [{ card: { kind: 'wild' }, position: { x: moveIndex, y: 0 } }] }),
        5,
        5,
        opts.endedAt - 5_000,
      )
      .run()
  }
}

/** This test's own scoped read-back — never a global scan. */
async function seatRow(gameUuid: string, seat: number) {
  return DB()
    .prepare('SELECT seat_index, result, opponent_kind, stats, total_moves, ai_move_count FROM game_players WHERE game_uuid = ? AND seat_index = ?')
    .bind(gameUuid, seat)
    .first<{ seat_index: number; result: string | null; opponent_kind: string | null; stats: string | null; total_moves: number | null; ai_move_count: number | null }>()
}

describe('backfillStats', () => {
  beforeAll(async () => {
    await applyD1Schema(DB())
  })

  it('fills result/opponent_kind/stats/total_moves/ai_move_count for a completed game with NULL game_players, then is a no-op on re-run', async () => {
    const gameUuid = `bf-${crypto.randomUUID()}`
    await mkAccount('bf-acct-0')
    await mkAccount('bf-acct-1')
    await seedGame(
      gameUuid,
      'completed',
      [
        { seat: 0, accountId: 'bf-acct-0', ownerType: 'human', finalScore: 20 },
        { seat: 1, accountId: 'bf-acct-1', ownerType: 'human', finalScore: 10 },
      ],
      { winnerSeat: 0, endedAt: Date.now() },
    )

    const first = await backfillStats(DB())
    expect(first.gamesProcessed).toBeGreaterThanOrEqual(1)
    expect(first.rowsFilled).toBeGreaterThanOrEqual(2)

    const seat0 = await seatRow(gameUuid, 0)
    const seat1 = await seatRow(gameUuid, 1)
    expect(seat0).toMatchObject({ result: 'win', opponent_kind: 'human', total_moves: 1, ai_move_count: 0 })
    expect(seat1).toMatchObject({ result: 'loss', opponent_kind: 'human', total_moves: 1, ai_move_count: 0 })
    expect(JSON.parse(seat0!.stats!).points).toBe(20)
    expect(JSON.parse(seat1!.stats!).points).toBe(10)

    // Re-run: MY rows must be byte-identical (never re-derived/overwritten) —
    // proven at the row level, since the global return-value counts are not
    // exact in a shared, un-isolated D1 (other suites leave their own NULL
    // rows behind; see the file banner).
    const before0 = JSON.stringify(seat0)
    const before1 = JSON.stringify(seat1)
    await backfillStats(DB())
    expect(JSON.stringify(await seatRow(gameUuid, 0))).toBe(before0)
    expect(JSON.stringify(await seatRow(gameUuid, 1))).toBe(before1)
  })

  it('backfills a stalemate-status game too (not just completed), resolving a genuine tie as a draw', async () => {
    const gameUuid = `bf-stale-${crypto.randomUUID()}`
    await mkAccount('bf-acct-s0')
    await mkAccount('bf-acct-s1')
    await seedGame(
      gameUuid,
      'stalemate',
      [
        { seat: 0, accountId: 'bf-acct-s0', ownerType: 'human', finalScore: 8 },
        { seat: 1, accountId: 'bf-acct-s1', ownerType: 'human', finalScore: 8 },
      ],
      { winnerSeat: null, endedAt: Date.now() }, // a genuine tie -> draw for BOTH seats
    )

    await backfillStats(DB())
    const seat0 = await seatRow(gameUuid, 0)
    const seat1 = await seatRow(gameUuid, 1)
    expect(seat0!.result).toBe('draw')
    expect(seat1!.result).toBe('draw')
  })

  it('classifies opponent_kind=ai for a human seat whose only opponent is AI, and never writes the AI seat itself', async () => {
    const gameUuid = `bf-ai-${crypto.randomUUID()}`
    await mkAccount('bf-acct-h')
    await seedGame(
      gameUuid,
      'completed',
      [
        { seat: 0, accountId: 'bf-acct-h', ownerType: 'human', finalScore: 15 },
        { seat: 1, accountId: null, ownerType: 'ai', finalScore: 3 },
      ],
      { winnerSeat: 0, endedAt: Date.now() },
    )
    await backfillStats(DB())
    const seat0 = await seatRow(gameUuid, 0)
    const seat1 = await seatRow(gameUuid, 1)
    expect(seat0).toMatchObject({ result: 'win', opponent_kind: 'ai' })
    expect(seat1?.result).toBeNull() // AI seat: never gets result/opponent_kind/stats
    expect(seat1?.opponent_kind).toBeNull()
  })

  it('only fills NULL rows — an already-filled seat in the same game is left untouched', async () => {
    const gameUuid = `bf-partial-${crypto.randomUUID()}`
    await mkAccount('bf-acct-p0')
    await mkAccount('bf-acct-p1')
    await seedGame(
      gameUuid,
      'completed',
      [
        { seat: 0, accountId: 'bf-acct-p0', ownerType: 'human', finalScore: 20 },
        { seat: 1, accountId: 'bf-acct-p1', ownerType: 'human', finalScore: 10 },
      ],
      { winnerSeat: 0, endedAt: Date.now() },
    )
    // Pre-fill seat 0 with a sentinel value backfill must never overwrite.
    await DB()
      .prepare(`UPDATE game_players SET result='win', opponent_kind='human', stats='{"sentinel":true}' WHERE game_uuid=? AND seat_index=0`)
      .bind(gameUuid)
      .run()

    await backfillStats(DB())

    const seat0 = await seatRow(gameUuid, 0)
    const seat1 = await seatRow(gameUuid, 1)
    expect(JSON.parse(seat0!.stats!)).toEqual({ sentinel: true }) // untouched
    expect(seat1!.result).toBe('loss') // the genuinely-NULL seat DID get filled
  })
})

describe('POST /admin/backfill-stats', () => {
  beforeAll(async () => {
    await applyD1Schema(DB())
  })

  async function call(tok: string | null, envOverrides: Record<string, unknown> = { ADMIN_JWT_SECRET: ADMIN_SECRET }): Promise<Response> {
    const ctx = createExecutionContext()
    const res = await worker.fetch(
      new Request('https://x/admin/backfill-stats', {
        method: 'POST',
        headers: tok ? { authorization: 'Bearer ' + tok } : {},
      }),
      { ...env, ...envOverrides } as any,
      ctx,
    )
    await waitOnExecutionContext(ctx)
    return res
  }

  it('401s without an admin token', async () => {
    expect((await call(null)).status).toBe(401)
  })

  it('401s when ADMIN_JWT_SECRET is unset (server misconfigured)', async () => {
    const tok = await adminTok()
    expect((await call(tok, { ADMIN_JWT_SECRET: undefined })).status).toBe(401)
  })

  it('401s a token with the wrong audience', async () => {
    const wrongAud = await adminTok(ADMIN_SECRET, 'vgames-web')
    expect((await call(wrongAud)).status).toBe(401)
  })

  it('runs the backfill under a valid admin token and actually fills rows', async () => {
    const gameUuid = `bf-route-${crypto.randomUUID()}`
    await mkAccount('bf-route-0')
    await mkAccount('bf-route-1')
    await seedGame(
      gameUuid,
      'completed',
      [
        { seat: 0, accountId: 'bf-route-0', ownerType: 'human', finalScore: 5 },
        { seat: 1, accountId: 'bf-route-1', ownerType: 'human', finalScore: 1 },
      ],
      { winnerSeat: 0, endedAt: Date.now() },
    )
    const r = await call(await adminTok())
    expect(r.status).toBe(200)
    const body = (await r.json()) as { gamesProcessed: number; rowsFilled: number }
    expect(body.gamesProcessed).toBeGreaterThanOrEqual(1)
    expect(body.rowsFilled).toBeGreaterThanOrEqual(2)

    const row = await seatRow(gameUuid, 0)
    expect(row!.result).toBe('win')
  })
})
