import { SELF, env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyGameSchema, applyIdentitySchema } from '../src/d1/schema'
import { mintQuickAccount } from './helpers'

/**
 * Task 10 — GET /me/stats (Bearer). Scoped to `ctx.accountId` (via
 * requireCanonicalAccount), so — unlike the leaderboard's global rankings —
 * this is naturally immune to the shared/unisolated test D1's cross-file
 * residue: every account here is a fresh `/auth/quick` mint with a unique
 * credential, and the query is `WHERE gp.account_id = ?`.
 */

const DB = () => (env as unknown as { DB: D1Database }).DB
const IDENTITY_DB = () => (env as unknown as { IDENTITY_DB: D1Database }).IDENTITY_DB

beforeAll(async () => {
  await applyGameSchema(DB())
  await applyIdentitySchema(IDENTITY_DB())
})

// Identity code/data split (Step 3): `/auth/quick` is now a network proxy on
// viota-worker (see src/index.ts) — seed the account directly instead. See
// `mintQuickAccount`'s doc comment in ./helpers.
async function quickAccount(displayName: string): Promise<{ token: string; accountId: string }> {
  return mintQuickAccount(IDENTITY_DB(), displayName)
}

async function seedGame(
  accountId: string,
  opts: {
    opponentKind: 'human' | 'ai'
    result: 'win' | 'loss' | 'draw'
    finalScore: number
    bestPlay: number
    durationMs: number
    playerCount: number
    createdAt: number
    endedAt: number
    status?: 'completed' | 'stalemate'
    /** Defaults to 0/0 (schema default) — a normal, fully-human-played seat. */
    totalMoves?: number
    aiMoveCount?: number
  },
): Promise<void> {
  const gameUuid = `ms-${crypto.randomUUID()}`
  await DB()
    .prepare(`INSERT INTO games (game_uuid, status, player_count, created_at, ended_at, game_type) VALUES (?, ?, ?, ?, ?, 'iota')`)
    .bind(gameUuid, opts.status ?? 'completed', opts.playerCount, opts.createdAt, opts.endedAt)
    .run()
  const stats = JSON.stringify({
    points: opts.finalScore,
    bestPlay: opts.bestPlay,
    plays: 1,
    passes: 0,
    wildsRecycled: 0,
    cardsPlayed: 1,
    moves: 1,
    durationMs: opts.durationMs,
  })
  await DB()
    .prepare(
      `INSERT INTO game_players (game_uuid, seat_index, account_id, owner_type, opponent_kind, result, final_score, stats, total_moves, ai_move_count)
       VALUES (?, 0, ?, 'human', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(gameUuid, accountId, opts.opponentKind, opts.result, opts.finalScore, stats, opts.totalMoves ?? 0, opts.aiMoveCount ?? 0)
    .run()
}

async function meStats(token: string): Promise<{ status: number; body: any }> {
  const res = await SELF.fetch('https://example.com/me/stats', { headers: { Authorization: `Bearer ${token}` } })
  return { status: res.status, body: await res.json() }
}

describe('GET /me/stats', () => {
  it('401s without a bearer token', async () => {
    const res = await SELF.fetch('https://example.com/me/stats')
    expect(res.status).toBe(401)
  })

  it('a fresh account with no games gets sane zero/null defaults, not a crash', async () => {
    const { token } = await quickAccount('Freshling')
    const { status, body } = await meStats(token)
    expect(status).toBe(200)
    expect(body).toEqual({
      games: 0,
      vsFriends: { games: 0, wins: 0, winRate: 0, streak: 0 },
      vsAI: { games: 0, wins: 0, winRate: 0 },
      bestPlay: 0,
      bestGame: 0,
      playerSince: null,
      lastPlayed: null,
      byPlayerCount: { '2': 0, '3': 0, '4': 0 },
      totalTimeMs: 0,
    })
  })

  it('aggregates vsFriends/vsAI/bestPlay/bestGame/playerSince/lastPlayed/byPlayerCount/totalTimeMs across the caller\'s games', async () => {
    const { token, accountId } = await quickAccount('Aggregator')
    const t0 = Date.now()

    // vs-human: win, win, loss (chronological by ended_at) -> streak 2, winRate 2/3
    await seedGame(accountId, { opponentKind: 'human', result: 'win', finalScore: 12, bestPlay: 10, durationMs: 1_000, playerCount: 2, createdAt: t0 + 1 - 100_000, endedAt: t0 + 1 })
    await seedGame(accountId, { opponentKind: 'human', result: 'win', finalScore: 30, bestPlay: 25, durationMs: 2_000, playerCount: 3, createdAt: t0 + 2 - 100_000, endedAt: t0 + 2 })
    await seedGame(accountId, { opponentKind: 'human', result: 'loss', finalScore: 7, bestPlay: 5, durationMs: 1_500, playerCount: 2, createdAt: t0 + 3 - 100_000, endedAt: t0 + 3 })
    // vs-AI: win, win
    await seedGame(accountId, { opponentKind: 'ai', result: 'win', finalScore: 50, bestPlay: 40, durationMs: 3_000, playerCount: 4, createdAt: t0 + 4 - 100_000, endedAt: t0 + 4 })
    await seedGame(accountId, { opponentKind: 'ai', result: 'win', finalScore: 20, bestPlay: 15, durationMs: 500, playerCount: 3, createdAt: t0 + 5 - 100_000, endedAt: t0 + 5 })

    const { status, body } = await meStats(token)
    expect(status).toBe(200)
    expect(body).toEqual({
      games: 5,
      vsFriends: { games: 3, wins: 2, winRate: 0.6667, streak: 2 },
      vsAI: { games: 2, wins: 2, winRate: 1 },
      bestPlay: 40,
      bestGame: 50,
      playerSince: t0 + 1 - 100_000,
      lastPlayed: t0 + 5,
      byPlayerCount: { '2': 2, '3': 2, '4': 1 },
      totalTimeMs: 8_000,
    })
  })

  it('a stalemate-status game counts too, and a different account\'s games never leak in', async () => {
    const me = await quickAccount('Scoped Me')
    const other = await quickAccount('Someone Else')
    const t0 = Date.now()
    await seedGame(me.accountId, { opponentKind: 'human', result: 'win', finalScore: 9, bestPlay: 9, durationMs: 100, playerCount: 2, createdAt: t0, endedAt: t0, status: 'stalemate' })
    await seedGame(other.accountId, { opponentKind: 'human', result: 'win', finalScore: 999, bestPlay: 999, durationMs: 999, playerCount: 4, createdAt: t0, endedAt: t0 })

    const { body } = await meStats(me.token)
    expect(body.games).toBe(1)
    expect(body.bestGame).toBe(9) // NOT other's 999
  })

  it('excludes a game where the AI played the majority of the seat\'s moves (owner stepped away, ai_move_count*2 > total_moves)', async () => {
    const { token, accountId } = await quickAccount('Takeover Victim')
    const t0 = Date.now()
    // Normal win: human played every move.
    await seedGame(accountId, {
      opponentKind: 'human',
      result: 'win',
      finalScore: 10,
      bestPlay: 8,
      durationMs: 1_000,
      playerCount: 2,
      createdAt: t0,
      endedAt: t0,
      totalMoves: 4,
      aiMoveCount: 1,
    })
    // AI-takeover win: AI played 3 of 4 moves (ai_move_count*2=6 > total_moves=4)
    // while the owner was away -> must not count on the account's stats.
    await seedGame(accountId, {
      opponentKind: 'human',
      result: 'win',
      finalScore: 99,
      bestPlay: 99,
      durationMs: 5_000,
      playerCount: 2,
      createdAt: t0 + 1,
      endedAt: t0 + 1,
      totalMoves: 4,
      aiMoveCount: 3,
    })

    const { body } = await meStats(token)
    expect(body.games).toBe(1) // NOT 2
    expect(body.vsFriends).toMatchObject({ games: 1, wins: 1 }) // NOT games:2, wins:2
    expect(body.bestGame).toBe(10) // NOT the takeover game's 99
  })
})
