import { env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyGameSchema, applyIdentitySchema } from '../src/d1/schema'
import { handleLeaderboard } from '../src/stats/leaderboard'
import { handleMeStats } from '../src/stats/me-stats'
import { handleGamesReport } from '../src/stats/report'
import { reconcileMerges } from '../src/do/reconcile'
import { requireCanonicalAccount } from '../src/identity/authctx'
import { signToken } from '../src/jwt'
import { TEST_JWT_SECRET } from './helpers'

/**
 * A9 write-discipline invariant — "viota-worker must never execute
 * INSERT/UPDATE/DELETE against IDENTITY_DB (reconciler writes go to DB
 * only)." A real, dynamic proof: every IDENTITY_DB reference the stats
 * routes (leaderboard/me-stats/report, via requireCanonicalAccount +
 * lookupAccountNames) and the merge reconciler are handed is a Proxy that
 * THROWS the moment `.prepare()` is called with a mutating (INSERT/UPDATE/
 * DELETE/REPLACE/DROP/ALTER) statement — not a wrapper that silently
 * records and moves on, so a violation surfaces as a hard, unmissable test
 * failure exactly where it happened. Every scenario below is exercised with
 * REAL data (an authed account, seeded games, an active merge) so the guard
 * is proven against genuine code paths, not vacuous no-op calls.
 */

const DB = () => (env as unknown as { DB: D1Database }).DB
const IDENTITY_DB = () => (env as unknown as { IDENTITY_DB: D1Database }).IDENTITY_DB

beforeAll(async () => {
  await applyGameSchema(DB())
  await applyIdentitySchema(IDENTITY_DB())
})

const MUTATING_RE = /^\s*(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|TRUNCATE)\b/i

/** Wrap a REAL D1Database so every `.prepare(sql)` call is inspected: a
 *  mutating statement throws immediately (before it can execute); a
 *  read-only one (SELECT/PRAGMA/WITH) is passed straight through to the real
 *  binding, so legitimate reads still work and the wrapped functions behave
 *  normally when the invariant holds. */
function guardedD1(real: D1Database): D1Database {
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'prepare') {
        return (sql: string) => {
          if (MUTATING_RE.test(sql)) {
            throw new Error(`A9 VIOLATION: mutating statement issued against IDENTITY_DB: ${sql}`)
          }
          return target.prepare(sql)
        }
      }
      if (prop === 'exec' || prop === 'batch') {
        return () => {
          throw new Error(`A9 VIOLATION: D1Database.${String(prop)}() called on IDENTITY_DB (batches/exec are never read-only)`)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}

async function mkAccount(id: string, opts: { username?: string; displayName: string }): Promise<void> {
  const now = Date.now()
  await IDENTITY_DB()
    .prepare(
      `INSERT INTO accounts (id,credential_hash,username,display_name,created_at,status,token_epoch,origin_game,must_change_pw,login_fail_count,last_seen_at)
       VALUES (?,?,?,?,?,?,0,'iota',0,0,?)`,
    )
    .bind(id, 'wd-' + id, opts.username ?? null, opts.displayName, now, opts.username ? 'claimed' : 'ghost', now)
    .run()
}

describe('A9 write-discipline: stats routes never mutate IDENTITY_DB', () => {
  it('GET /leaderboard (with a Bearer, exercising the `me` canonicalization lookup + the batched name lookup)', async () => {
    const acct = `wd-lb-${crypto.randomUUID()}`
    await mkAccount(acct, { displayName: 'Write Discipline' })
    const gameUuid = `wd-lb-g-${crypto.randomUUID()}`
    await DB()
      .prepare(`INSERT INTO games (game_uuid, status, player_count, source, ended_at, created_at, game_type) VALUES (?, 'completed', 2, 'online_authoritative', ?, ?, 'iota')`)
      .bind(gameUuid, Date.now(), Date.now() - 1000)
      .run()
    await DB()
      .prepare(`INSERT INTO game_players (game_uuid, seat_index, account_id, owner_type, opponent_kind, result, final_score) VALUES (?, 0, ?, 'human', 'human', 'win', 5)`)
      .bind(gameUuid, acct)
      .run()

    const token = await signToken(acct, TEST_JWT_SECRET)
    const request = new Request('https://x/leaderboard?game=iota&board=wins-friends', { headers: { Authorization: `Bearer ${token}` } })
    const guardedEnv = { DB: DB(), IDENTITY_DB: guardedD1(IDENTITY_DB()), JWT_SECRET: TEST_JWT_SECRET }

    const res = await handleLeaderboard(request, guardedEnv)
    expect(res.status).toBe(200) // never threw -> the guard never fired
    const body = (await res.json()) as { rows: unknown[] }
    expect(body.rows.length).toBeGreaterThan(0)
  })

  it('GET /me/stats (requireCanonicalAccount + the aggregate read)', async () => {
    const acct = `wd-ms-${crypto.randomUUID()}`
    await mkAccount(acct, { displayName: 'Write Discipline Stats' })
    const token = await signToken(acct, TEST_JWT_SECRET)
    const request = new Request('https://x/me/stats', { headers: { Authorization: `Bearer ${token}` } })
    const guardedEnv = { DB: DB(), IDENTITY_DB: guardedD1(IDENTITY_DB()), JWT_SECRET: TEST_JWT_SECRET }

    const res = await handleMeStats(request, guardedEnv)
    expect(res.status).toBe(200)
  })

  it('POST /games/report (requireCanonicalAccount on the reporting caller)', async () => {
    const acct = `wd-gr-${crypto.randomUUID()}`
    await mkAccount(acct, { displayName: 'Write Discipline Report' })
    const token = await signToken(acct, TEST_JWT_SECRET)
    const body = {
      clientGameId: `wd-report-${crypto.randomUUID()}`,
      playerCount: 2,
      players: [
        { seat: 0, accountId: acct, ownerType: 'human', displayName: 'Reporter' },
        { seat: 1, ownerType: 'ai', displayName: 'AI 2' },
      ],
      winnerSeat: 0,
      seats: [
        { seat: 0, finalScore: 10 },
        { seat: 1, finalScore: 2 },
      ],
      moves: [],
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
    }
    const request = new Request('https://x/games/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const guardedEnv = { DB: DB(), IDENTITY_DB: guardedD1(IDENTITY_DB()), JWT_SECRET: TEST_JWT_SECRET }

    const res = await handleGamesReport(request, guardedEnv)
    expect(res.status).toBe(200) // report itself WRITES — but only to DB, never IDENTITY_DB
  })

  it('requireCanonicalAccount directly (the shared canonicalization primitive every stats route calls)', async () => {
    const acct = `wd-rca-${crypto.randomUUID()}`
    await mkAccount(acct, { displayName: 'Write Discipline RCA' })
    const token = await signToken(acct, TEST_JWT_SECRET)
    const request = new Request('https://x/whatever', { headers: { Authorization: `Bearer ${token}` } })
    const guardedEnv = { DB: DB(), IDENTITY_DB: guardedD1(IDENTITY_DB()), JWT_SECRET: TEST_JWT_SECRET }

    const result = await requireCanonicalAccount(request, guardedEnv)
    expect(result).not.toBeInstanceOf(Response)
  })
})

describe('A9 write-discipline: the merge reconciler never mutates IDENTITY_DB (writes go to DB only)', () => {
  it('reconcileMerges: reads account_merges from IDENTITY_DB, writes game_players/merge_selfplay_flags to DB only', async () => {
    const fromId = `wd-recon-from-${crypto.randomUUID()}`
    const intoId = `wd-recon-into-${crypto.randomUUID()}`
    await mkAccount(fromId, { displayName: 'Recon From' })
    await mkAccount(intoId, { displayName: 'Recon Into' })
    await IDENTITY_DB()
      .prepare(`INSERT INTO account_merges (id, from_account_id, into_account_id, merged_by, reason, merged_at) VALUES (?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), fromId, intoId, 'test', 'test', Date.now())
      .run()
    const gameUuid = `wd-recon-g-${crypto.randomUUID()}`
    await DB()
      .prepare(`INSERT INTO games (game_uuid, mode, status, player_count, created_at, game_type) VALUES (?,'online','completed',2,?,'iota')`)
      .bind(gameUuid, Date.now())
      .run()
    await DB()
      .prepare(`INSERT INTO game_players (game_uuid, seat_index, account_id, owner_type) VALUES (?,0,?,'human')`)
      .bind(gameUuid, fromId)
      .run()

    // db (game data) is the REAL binding (the reconciler is SUPPOSED to write
    // there); identityDb is guarded — it must only ever be read.
    const summary = await reconcileMerges(DB(), guardedD1(IDENTITY_DB()))
    expect(summary.mergesSwept).toBeGreaterThanOrEqual(1) // never threw -> the guard never fired

    const row = await DB().prepare(`SELECT account_id FROM game_players WHERE game_uuid=? AND seat_index=0`).bind(gameUuid).first<{ account_id: string }>()
    expect(row?.account_id).toBe(intoId) // the retag actually happened, via DB, not IDENTITY_DB
  })
})

describe('A9 guard self-test (the guard itself actually fires on a real mutation)', () => {
  it('throws when a mutating statement IS issued against the guarded binding', () => {
    const guarded = guardedD1(IDENTITY_DB())
    expect(() => guarded.prepare(`UPDATE accounts SET status='merged' WHERE id='nope'`)).toThrow(/A9 VIOLATION/)
    expect(() => guarded.prepare(`INSERT INTO accounts (id) VALUES ('nope')`)).toThrow(/A9 VIOLATION/)
    expect(() => guarded.prepare(`DELETE FROM accounts WHERE id='nope'`)).toThrow(/A9 VIOLATION/)
  })

  it('does NOT throw for a read-only statement', () => {
    const guarded = guardedD1(IDENTITY_DB())
    expect(() => guarded.prepare(`SELECT id FROM accounts WHERE id='nope'`)).not.toThrow()
  })
})
