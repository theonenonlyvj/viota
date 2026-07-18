import { SELF, env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyGameSchema, applyIdentitySchema } from '../src/d1/schema'
import { authHeaders } from './helpers'

/**
 * Task 9 — GET /leaderboard. The shared test D1 is NOT isolated per file
 * (vitest.config.ts: singleWorker+isolatedStorage:false) and other suites
 * leave their own accounts/games behind. So every assertion here looks up
 * THIS test's own (crypto.randomUUID()-scoped) account ids within `rows`
 * rather than asserting the full array or an exact rank number — the
 * endpoint is a GLOBAL ranking, so "is my row correct / in the right
 * relative order / present-or-absent" is the robust, meaningful thing to
 * check regardless of what else is in the shared database.
 *
 * Identity code/data split (A8): game rows live on `DB`, accounts on
 * `IDENTITY_DB` — `mkAccount` seeds the latter (the leaderboard route
 * batch-resolves names from there), `seedGame` the former.
 */

const DB = () => (env as unknown as { DB: D1Database }).DB
const IDENTITY_DB = () => (env as unknown as { IDENTITY_DB: D1Database }).IDENTITY_DB

beforeAll(async () => {
  await applyGameSchema(DB())
  await applyIdentitySchema(IDENTITY_DB())
})

async function mkAccount(id: string, opts: { username?: string; displayName: string }): Promise<void> {
  const now = Date.now()
  await IDENTITY_DB()
    .prepare(
      `INSERT INTO accounts (id,credential_hash,username,display_name,created_at,status,token_epoch,origin_game,must_change_pw,login_fail_count,last_seen_at)
       VALUES (?,?,?,?,?,?,0,'iota',0,0,?)`,
    )
    .bind(id, 'c' + id, opts.username ?? null, opts.displayName, now, opts.username ? 'claimed' : 'ghost', now)
    .run()
}

/** One single-seat "game" attributed to `accountId` with the EXACT
 *  result/opponent_kind/stats/final_score the board queries read — the write
 *  path (archive/backfill) is covered elsewhere; this file tests the read
 *  side directly and precisely. */
async function seedGame(
  accountId: string,
  opts: {
    opponentKind: 'human' | 'ai'
    result: 'win' | 'loss' | 'draw'
    finalScore: number
    bestPlay?: number
    endedAt: number
    status?: 'completed' | 'stalemate'
    /** Defaults to 0/0 (schema default) — a normal, fully-human-played seat. */
    totalMoves?: number
    aiMoveCount?: number
    /** Trust tier. Defaults to a verified online game (the common case); pass
     *  'client_reported' to model a self-reported local game. */
    source?: 'online_authoritative' | 'client_reported'
    /** The name recorded on `game_players.display_name` AT PLAY TIME — the A8
     *  fallback used when the batched IDENTITY_DB name lookup has no
     *  `accounts` row for this account_id. Defaults to null (the common case:
     *  a real account whose name resolves fine). */
    displayName?: string | null
  },
): Promise<void> {
  const gameUuid = `lb-${crypto.randomUUID()}`
  await DB()
    .prepare(`INSERT INTO games (game_uuid, status, player_count, source, ended_at, created_at, game_type) VALUES (?, ?, 2, ?, ?, ?, 'iota')`)
    .bind(gameUuid, opts.status ?? 'completed', opts.source ?? 'online_authoritative', opts.endedAt, opts.endedAt - 1_000)
    .run()
  const stats = JSON.stringify({
    points: opts.finalScore,
    bestPlay: opts.bestPlay ?? 0,
    plays: 1,
    passes: 0,
    wildsRecycled: 0,
    cardsPlayed: 1,
    moves: 1,
    durationMs: 1_000,
  })
  await DB()
    .prepare(
      `INSERT INTO game_players (game_uuid, seat_index, account_id, owner_type, display_name, opponent_kind, result, final_score, stats, total_moves, ai_move_count)
       VALUES (?, 0, ?, 'human', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(gameUuid, accountId, opts.displayName ?? null, opts.opponentKind, opts.result, opts.finalScore, stats, opts.totalMoves ?? 0, opts.aiMoveCount ?? 0)
    .run()
}

async function fetchBoard(board: string, extraHeaders: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const res = await SELF.fetch(`https://example.com/leaderboard?game=iota&board=${board}`, { headers: extraHeaders })
  return { status: res.status, body: await res.json() }
}

describe('GET /leaderboard', () => {
  it('400s an unknown board key', async () => {
    const { status } = await fetchBoard('not-a-real-board')
    expect(status).toBe(400)
  })

  it('400s an unsupported game', async () => {
    const res = await SELF.fetch('https://example.com/leaderboard?game=jaipur&board=wins-friends')
    expect(res.status).toBe(400)
  })

  it('winrate-friends: applies the min-5-games floor and ranks by win rate descending', async () => {
    const acctAbove = `lb-above-${crypto.randomUUID()}`
    const acctBelow = `lb-below-${crypto.randomUUID()}`
    const acctTop = `lb-top-${crypto.randomUUID()}`
    await mkAccount(acctAbove, { displayName: 'Above Floor' })
    await mkAccount(acctBelow, { displayName: 'Below Floor' })
    await mkAccount(acctTop, { displayName: 'Top' })

    let t0 = Date.now()
    // acctAbove: 5 vs-human games, 3 wins -> 0.6
    for (const result of ['win', 'win', 'win', 'loss', 'loss'] as const) {
      await seedGame(acctAbove, { opponentKind: 'human', result, finalScore: 10, endedAt: t0++ })
    }
    // acctBelow: 4 vs-human games, all wins -> 1.0 but BELOW the 5-game floor
    for (let i = 0; i < 4; i++) {
      await seedGame(acctBelow, { opponentKind: 'human', result: 'win', finalScore: 10, endedAt: t0++ })
    }
    // acctTop: 5 vs-human games, all wins -> 1.0, meets the floor
    for (let i = 0; i < 5; i++) {
      await seedGame(acctTop, { opponentKind: 'human', result: 'win', finalScore: 10, endedAt: t0++ })
    }

    const { status, body } = await fetchBoard('winrate-friends')
    expect(status).toBe(200)
    expect(body.board).toBe('winrate-friends')

    expect(body.rows.find((r: any) => r.accountId === acctBelow)).toBeUndefined() // excluded: below floor

    const rowAbove = body.rows.find((r: any) => r.accountId === acctAbove)
    const rowTop = body.rows.find((r: any) => r.accountId === acctTop)
    expect(rowAbove).toMatchObject({ value: 0.6, games: 5, displayName: 'Above Floor' })
    expect(rowTop).toMatchObject({ value: 1, games: 5, displayName: 'Top' })

    const idxAbove = body.rows.findIndex((r: any) => r.accountId === acctAbove)
    const idxTop = body.rows.findIndex((r: any) => r.accountId === acctTop)
    expect(idxTop).toBeLessThan(idxAbove) // higher win rate ranks first
  })

  it('wins-friends: no min-games floor, ranks by total wins', async () => {
    const acct = `lb-winsf-${crypto.randomUUID()}`
    await mkAccount(acct, { displayName: 'Wins Friends' })
    const t0 = Date.now()
    for (let i = 0; i < 3; i++) await seedGame(acct, { opponentKind: 'human', result: 'win', finalScore: 5, endedAt: t0 + i })
    await seedGame(acct, { opponentKind: 'human', result: 'loss', finalScore: 1, endedAt: t0 + 10 })

    const { body } = await fetchBoard('wins-friends')
    const row = body.rows.find((r: any) => r.accountId === acct)
    expect(row).toMatchObject({ value: 3, games: 4 })
  })

  it('streak-friends: longest consecutive win run (not the total, not just the trailing run)', async () => {
    const acct = `lb-streak-${crypto.randomUUID()}`
    await mkAccount(acct, { displayName: 'Streaker' })
    const t0 = Date.now()
    const sequence = ['win', 'win', 'loss', 'win', 'win', 'win'] as const // longest run = 3
    for (let i = 0; i < sequence.length; i++) {
      await seedGame(acct, { opponentKind: 'human', result: sequence[i]!, finalScore: 5, endedAt: t0 + i * 100 })
    }

    const { body } = await fetchBoard('streak-friends')
    const row = body.rows.find((r: any) => r.accountId === acct)
    expect(row).toMatchObject({ value: 3, games: 6 })
  })

  it('winrate-ai/wins-ai: scoped to opponent_kind=ai, vs-human games never leak in', async () => {
    const acct = `lb-ai-${crypto.randomUUID()}`
    await mkAccount(acct, { displayName: 'AI Grinder' })
    let t0 = Date.now()
    // 5 vs-AI games, 4 wins -> 0.8
    for (const result of ['win', 'win', 'win', 'win', 'loss'] as const) {
      await seedGame(acct, { opponentKind: 'ai', result, finalScore: 5, endedAt: t0++ })
    }
    // a vs-human win that must NOT count toward the vs-AI numbers
    await seedGame(acct, { opponentKind: 'human', result: 'win', finalScore: 99, endedAt: t0++ })

    const winrate = await fetchBoard('winrate-ai')
    const wins = await fetchBoard('wins-ai')
    expect(winrate.body.rows.find((r: any) => r.accountId === acct)).toMatchObject({ value: 0.8, games: 5 })
    expect(wins.body.rows.find((r: any) => r.accountId === acct)).toMatchObject({ value: 4, games: 5 })
  })

  it('excludes an AI-takeover-majority game (ai_move_count*2 > total_moves) from wins-friends/winrate-friends', async () => {
    const acct = `lb-takeover-${crypto.randomUUID()}`
    await mkAccount(acct, { displayName: 'Takeover Victim' })
    let t0 = Date.now()
    // 4 normal wins + 1 normal loss, human played every move -> meets the
    // 5-game winrate floor cleanly: wins-friends=4, winrate-friends=0.8.
    for (const result of ['win', 'win', 'win', 'win', 'loss'] as const) {
      await seedGame(acct, { opponentKind: 'human', result, finalScore: 10, endedAt: t0++, totalMoves: 4, aiMoveCount: 1 })
    }
    // A 6th game, also a "win", but the AI played the majority of the seat's
    // moves (ai_move_count*2 > total_moves) while the owner was away — must
    // be excluded, so it must NOT move wins-friends to 5 or winrate to 5/6.
    await seedGame(acct, { opponentKind: 'human', result: 'win', finalScore: 10, endedAt: t0++, totalMoves: 4, aiMoveCount: 3 })

    const wins = await fetchBoard('wins-friends')
    const winrate = await fetchBoard('winrate-friends')
    expect(wins.body.rows.find((r: any) => r.accountId === acct)).toMatchObject({ value: 4, games: 5 })
    expect(winrate.body.rows.find((r: any) => r.accountId === acct)).toMatchObject({ value: 0.8, games: 5 })
  })

  it('bestplay: max json_extract(stats, bestPlay) across ALL opponent kinds', async () => {
    const acct = `lb-bp-${crypto.randomUUID()}`
    await mkAccount(acct, { displayName: 'Big Play' })
    const t0 = Date.now()
    await seedGame(acct, { opponentKind: 'human', result: 'win', finalScore: 20, bestPlay: 12, endedAt: t0 })
    await seedGame(acct, { opponentKind: 'ai', result: 'loss', finalScore: 5, bestPlay: 45, endedAt: t0 + 1 })
    await seedGame(acct, { opponentKind: 'human', result: 'loss', finalScore: 8, bestPlay: 30, endedAt: t0 + 2 })

    const { body } = await fetchBoard('bestplay')
    expect(body.rows.find((r: any) => r.accountId === acct)).toMatchObject({ value: 45, games: 3 })
  })

  it('bestgame: max final_score across ALL opponent kinds', async () => {
    const acct = `lb-bg-${crypto.randomUUID()}`
    await mkAccount(acct, { displayName: 'High Score' })
    const t0 = Date.now()
    await seedGame(acct, { opponentKind: 'human', result: 'win', finalScore: 20, endedAt: t0 })
    await seedGame(acct, { opponentKind: 'ai', result: 'loss', finalScore: 55, endedAt: t0 + 1 })
    await seedGame(acct, { opponentKind: 'human', result: 'loss', finalScore: 8, endedAt: t0 + 2 })

    const { body } = await fetchBoard('bestgame')
    expect(body.rows.find((r: any) => r.accountId === acct)).toMatchObject({ value: 55, games: 3 })
  })

  it('score boards (bestplay/bestgame) rank verified ONLINE games only — a self-reported local high score is excluded, but still counts on participation boards', async () => {
    const mixed = `lb-verif-${crypto.randomUUID()}`
    await mkAccount(mixed, { displayName: 'Mixed Player' })
    const t0 = Date.now()
    // A modest ONLINE (server-verified) game — the legit high score.
    await seedGame(mixed, { opponentKind: 'ai', result: 'win', finalScore: 30, bestPlay: 20, endedAt: t0, source: 'online_authoritative' })
    // A HUGE LOCAL self-reported game — must NOT top the score boards.
    await seedGame(mixed, { opponentKind: 'ai', result: 'win', finalScore: 999, bestPlay: 999, endedAt: t0 + 1, source: 'client_reported' })

    // bestgame/bestplay: the local 999 is excluded — only the online game ranks (games=1).
    const bestgame = await fetchBoard('bestgame')
    expect(bestgame.body.rows.find((r: any) => r.accountId === mixed)).toMatchObject({ value: 30, games: 1 })
    const bestplay = await fetchBoard('bestplay')
    expect(bestplay.body.rows.find((r: any) => r.accountId === mixed)).toMatchObject({ value: 20, games: 1 })

    // Participation (wins-ai) still counts BOTH games — a local game is a real game played.
    const winsAi = await fetchBoard('wins-ai')
    expect(winsAi.body.rows.find((r: any) => r.accountId === mixed)).toMatchObject({ value: 2, games: 2 })

    // An account whose ONLY game is local never appears on a score board at all...
    const onlyLocal = `lb-onlylocal-${crypto.randomUUID()}`
    await mkAccount(onlyLocal, { displayName: 'Only Local' })
    await seedGame(onlyLocal, { opponentKind: 'ai', result: 'win', finalScore: 500, bestPlay: 500, endedAt: t0 + 2, source: 'client_reported' })
    const bestgame2 = await fetchBoard('bestgame')
    expect(bestgame2.body.rows.find((r: any) => r.accountId === onlyLocal)).toBeUndefined()
    // ...but it still shows up on the participation board.
    const winsAi2 = await fetchBoard('wins-ai')
    expect(winsAi2.body.rows.find((r: any) => r.accountId === onlyLocal)).toMatchObject({ value: 1, games: 1 })
  })

  it('ghosts (no username) appear by display_name; claimed accounts show their username', async () => {
    const ghostId = `lb-ghost-${crypto.randomUUID()}`
    const claimedId = `lb-claimed-${crypto.randomUUID()}`
    await mkAccount(ghostId, { displayName: 'Ghost Player' })
    await mkAccount(claimedId, { username: `vee${crypto.randomUUID().slice(0, 8)}`, displayName: 'Vee Claimed' })
    const t0 = Date.now()
    await seedGame(ghostId, { opponentKind: 'human', result: 'win', finalScore: 5, endedAt: t0 })
    await seedGame(claimedId, { opponentKind: 'human', result: 'win', finalScore: 5, endedAt: t0 + 1 })

    const { body } = await fetchBoard('wins-friends')
    const ghostRow = body.rows.find((r: any) => r.accountId === ghostId)
    const claimedRow = body.rows.find((r: any) => r.accountId === claimedId)
    expect(ghostRow.username == null).toBe(true)
    expect(ghostRow.displayName).toBe('Ghost Player')
    expect(claimedRow.username).toMatch(/^vee/)
  })

  it('includes me:{rank,value} for a valid Bearer, self-consistent with the row order; omits it with no Bearer', async () => {
    const acct = `lb-me-${crypto.randomUUID()}`
    await mkAccount(acct, { displayName: 'Me Baller' })
    const t0 = Date.now()
    for (let i = 0; i < 5; i++) await seedGame(acct, { opponentKind: 'human', result: 'win', finalScore: 5, endedAt: t0 + i })

    const authed = await fetchBoard('winrate-friends', await authHeaders(acct))
    const idx = authed.body.rows.findIndex((r: any) => r.accountId === acct)
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(authed.body.me).toEqual({ rank: idx + 1, value: authed.body.rows[idx].value })

    const anon = await fetchBoard('winrate-friends')
    expect(anon.body.me).toBeUndefined()
  })

  // A8: the two-step name lookup (game rows from DB, names batch-resolved
  // from IDENTITY_DB, merged in JS — D1 can't JOIN across two databases).
  describe('identity code/data split — two-step name lookup (A8)', () => {
    it('falls back to game_players.display_name when the accounts row is missing (never drops the row)', async () => {
      const orphanId = `lb-orphan-${crypto.randomUUID()}`
      // Deliberately NO mkAccount() call — this account_id has no row at all
      // in IDENTITY_DB (simulates a deleted account, or lookup drift).
      await seedGame(orphanId, { opponentKind: 'human', result: 'win', finalScore: 5, endedAt: Date.now(), displayName: 'Orphan Fallback Name' })

      const { body } = await fetchBoard('wins-friends')
      const row = body.rows.find((r: any) => r.accountId === orphanId)
      expect(row).toBeTruthy() // never dropped
      expect(row.displayName).toBe('Orphan Fallback Name') // the game-time name, not blank
      expect(row.username).toBeNull()
    })

    it('resolves names correctly across >90 distinct accounts (proves chunked IN(...) lookup, D1 caps bound params at 100)', async () => {
      const N = 92
      const ids = Array.from({ length: N }, () => `lb-chunk-${crypto.randomUUID()}`)
      await Promise.all(ids.map((id, i) => mkAccount(id, { displayName: `Chunk Player ${i}` })))
      const t0 = Date.now()
      await Promise.all(ids.map((id, i) => seedGame(id, { opponentKind: 'human', result: 'win', finalScore: 5, endedAt: t0 + i })))

      const { body } = await fetchBoard('wins-friends')
      // Every one of the 92 accounts resolves its OWN correct name — including
      // ones that only the second chunk (ids 90/91) would cover.
      for (let i = 0; i < N; i++) {
        const row = body.rows.find((r: any) => r.accountId === ids[i])
        expect(row, `row for account ${i}`).toBeTruthy()
        expect(row.displayName, `displayName for account ${i}`).toBe(`Chunk Player ${i}`)
      }
    })
  })
})
