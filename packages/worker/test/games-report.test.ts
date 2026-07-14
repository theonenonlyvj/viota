import { SELF, env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyD1Schema } from '../src/d1/schema'

/**
 * Task 7 — POST /games/report (Phase 4). Uploads a FINISHED local (client-only
 * vs-AI) game: the client sends the raw roster + final scores + full move log;
 * the server RE-DERIVES result/opponent_kind/stats via the same
 * deriveSeatArchiveFields/computeSeatStats/opponentKindFor helpers the live
 * online archive (archive-stats.test.ts) and the backfill (backfill.test.ts)
 * use — never trusting a client-sent stats blob (there isn't one in the body).
 */

const DB = () => (env as unknown as { DB: D1Database }).DB

beforeAll(async () => {
  await applyD1Schema(DB())
})

async function quickAccount(displayName: string): Promise<{ token: string; accountId: string }> {
  const r = await SELF.fetch('https://example.com/auth/quick', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceCredential: crypto.randomUUID() + crypto.randomUUID(), displayName }),
  })
  return (await r.json()) as { token: string; accountId: string }
}

/** A 2-seat local game: seat 0 = the reporting human (2 plays, best=20), seat 1
 *  = AI (1 pass). Deterministic enough to assert exact derived stats. */
function buildBody(clientGameId: string, reporterAccountId: string, overrides: Record<string, unknown> = {}) {
  const t0 = Date.now() - 60_000
  return {
    clientGameId,
    playerCount: 2,
    players: [
      { seat: 0, accountId: reporterAccountId, ownerType: 'human', displayName: 'Reporter' },
      { seat: 1, ownerType: 'ai', displayName: 'AI 2' },
    ],
    winnerSeat: 0,
    seats: [
      { seat: 0, finalScore: 28 },
      { seat: 1, finalScore: 5 },
    ],
    moves: [
      {
        seat_index: 0,
        type: 'play',
        payload: JSON.stringify({ type: 'play', placements: [{ card: { kind: 'wild' }, position: { x: 0, y: 0 } }] }),
        score_delta: 8,
        created_at: t0 + 1000,
      },
      {
        seat_index: 0,
        type: 'play',
        payload: JSON.stringify({ type: 'play', placements: [{ card: { kind: 'wild' }, position: { x: 1, y: 0 } }] }),
        score_delta: 20,
        created_at: t0 + 2000,
      },
      {
        seat_index: 1,
        type: 'pass',
        payload: JSON.stringify({ type: 'pass', trades: [], tradeOrder: [] }),
        score_delta: 0,
        created_at: t0 + 1500,
      },
    ],
    startedAt: t0,
    endedAt: t0 + 3000,
    ...overrides,
  }
}

async function report(body: unknown, token?: string): Promise<{ status: number; body: any }> {
  const res = await SELF.fetch('https://example.com/games/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

describe('POST /games/report', () => {
  it('401s without a bearer token', async () => {
    const { status } = await report(buildBody(`rep-${crypto.randomUUID()}`, 'someone'))
    expect(status).toBe(401)
  })

  it("403s when the caller doesn't own a human seat in the reported game", async () => {
    const { token } = await quickAccount('Reporter')
    const other = await quickAccount('SomeoneElse')
    const clientGameId = `rep-${crypto.randomUUID()}`
    // seat 0 (the only human seat) is attributed to `other`, not the caller.
    const body = buildBody(clientGameId, other.accountId)
    const { status } = await report(body, token)
    expect(status).toBe(403)
  })

  it('200s, writes a client_reported games row + server-derived game_players, and is idempotent on re-POST', async () => {
    const { token, accountId } = await quickAccount('Reporter')
    const clientGameId = `rep-${crypto.randomUUID()}`
    const body = buildBody(clientGameId, accountId)

    const first = await report(body, token)
    expect(first.status).toBe(200)

    const game = await DB().prepare('SELECT * FROM games WHERE game_uuid = ?').bind(clientGameId).first<any>()
    expect(game).toBeTruthy()
    expect(game.source).toBe('client_reported')
    expect(game.mode).toBe('local')
    expect(game.status).toBe('completed')
    expect(game.game_type).toBe('iota')
    expect(game.winner_seat).toBe(0)
    expect(game.player_count).toBe(2)

    const rows = (
      await DB().prepare('SELECT * FROM game_players WHERE game_uuid = ? ORDER BY seat_index').bind(clientGameId).all<any>()
    ).results
    expect(rows.length).toBe(2)

    const seat0 = rows.find((r: any) => r.seat_index === 0)
    const seat1 = rows.find((r: any) => r.seat_index === 1)

    // seat 0: human reporter, only opponent is AI -> opponent_kind 'ai', won.
    expect(seat0.account_id).toBe(accountId)
    expect(seat0.owner_type).toBe('human')
    expect(seat0.result).toBe('win')
    expect(seat0.opponent_kind).toBe('ai')
    expect(seat0.final_score).toBe(28)
    expect(seat0.total_moves).toBe(2)
    expect(seat0.ai_move_count).toBe(0)
    const stats0 = JSON.parse(seat0.stats)
    expect(stats0.points).toBe(28)
    expect(stats0.bestPlay).toBe(20)
    expect(stats0.plays).toBe(2)

    // seat 1: AI seat never gets result/opponent_kind/stats — only identity + score.
    expect(seat1.owner_type).toBe('ai')
    expect(seat1.final_score).toBe(5)
    expect(seat1.result).toBeNull()
    expect(seat1.opponent_kind).toBeNull()
    expect(seat1.stats).toBeNull()

    // Re-POST the SAME clientGameId — must not duplicate either table.
    const second = await report(body, token)
    expect(second.status).toBe(200)
    const gamesAfter = (await DB().prepare('SELECT * FROM games WHERE game_uuid = ?').bind(clientGameId).all<any>()).results
    expect(gamesAfter.length).toBe(1)
    const rowsAfter = (await DB().prepare('SELECT * FROM game_players WHERE game_uuid = ?').bind(clientGameId).all<any>()).results
    expect(rowsAfter.length).toBe(2)
  })
})
