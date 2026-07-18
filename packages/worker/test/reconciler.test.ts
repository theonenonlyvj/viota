import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyGameSchema, applyIdentitySchema } from '../src/d1/schema'
import { reconcileMerges, reconcileOneMerge, readActiveMerges } from '../src/do/reconcile'
import worker from '../src/index'

/**
 * Identity code/data split (A1/deliverable 3) — the merge reconciler. Every
 * viota cron sweep re-tags `game_players` for EVERY currently-active
 * `account_merges` row in IDENTITY_DB, idempotently, with no watermark (see
 * src/do/reconcile.ts's docstring for why). Self-play (from/into occupying
 * different seats of the SAME game) is detected inline and recorded in
 * viota's own `merge_selfplay_flags` table.
 */

const DB = () => (env as unknown as { DB: D1Database }).DB
const IDENTITY_DB = () => (env as unknown as { IDENTITY_DB: D1Database }).IDENTITY_DB

beforeAll(async () => {
  await applyGameSchema(DB())
  await applyIdentitySchema(IDENTITY_DB())
})

async function mkAcct(id: string): Promise<void> {
  const now = Date.now()
  await IDENTITY_DB()
    .prepare(
      `INSERT INTO accounts (id,credential_hash,display_name,created_at,status,token_epoch,origin_game,must_change_pw,login_fail_count,last_seen_at) VALUES (?,?,?,?,'ghost',0,'iota',0,0,?)`,
    )
    .bind(id, 'ch_' + id, id, now, now)
    .run()
}

async function mkMerge(fromId: string, intoId: string): Promise<void> {
  await IDENTITY_DB()
    .prepare(`INSERT INTO account_merges (id, from_account_id, into_account_id, merged_by, reason, merged_at) VALUES (?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), fromId, intoId, 'test', 'test', Date.now())
    .run()
}

async function mkGame(gameUuid: string): Promise<void> {
  await DB()
    .prepare(`INSERT INTO games (game_uuid, mode, status, player_count, created_at, game_type) VALUES (?,'online','completed',2,?,'iota')`)
    .bind(gameUuid, Date.now())
    .run()
}

async function mkSeat(gameUuid: string, seatIndex: number, accountId: string): Promise<void> {
  await DB()
    .prepare(`INSERT INTO game_players (game_uuid, seat_index, account_id, owner_type) VALUES (?,?,?,'human')`)
    .bind(gameUuid, seatIndex, accountId)
    .run()
}

async function seatAccountId(gameUuid: string, seatIndex: number): Promise<string | null> {
  const row = await DB()
    .prepare(`SELECT account_id FROM game_players WHERE game_uuid=? AND seat_index=?`)
    .bind(gameUuid, seatIndex)
    .first<{ account_id: string | null }>()
  return row?.account_id ?? null
}

describe('readActiveMerges', () => {
  it('reads only ACTIVE (superseded_by IS NULL) merges from IDENTITY_DB', async () => {
    await mkAcct('ram-from')
    await mkAcct('ram-into')
    await mkAcct('ram-superseded-from')
    await mkAcct('ram-superseded-into')
    await mkMerge('ram-from', 'ram-into')
    // A superseded edge must never surface (it already resolved elsewhere).
    await IDENTITY_DB()
      .prepare(`INSERT INTO account_merges (id, from_account_id, into_account_id, merged_by, reason, merged_at, superseded_by) VALUES (?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), 'ram-superseded-from', 'ram-superseded-into', 'test', 'test', Date.now(), 'some-other-merge-id')
      .run()

    const merges = await readActiveMerges(IDENTITY_DB())
    expect(merges).toContainEqual({ fromAccountId: 'ram-from', intoAccountId: 'ram-into' })
    expect(merges.some((m) => m.fromAccountId === 'ram-superseded-from')).toBe(false)
  })
})

describe('reconcileOneMerge', () => {
  it('re-tags every game_players row owned by fromAccountId onto intoAccountId', async () => {
    await mkAcct('rom-from')
    await mkAcct('rom-into')
    const g1 = `rom-g1-${crypto.randomUUID()}`
    const g2 = `rom-g2-${crypto.randomUUID()}`
    await mkGame(g1)
    await mkGame(g2)
    await mkSeat(g1, 0, 'rom-from')
    await mkSeat(g2, 0, 'rom-from')

    const result = await reconcileOneMerge(DB(), { fromAccountId: 'rom-from', intoAccountId: 'rom-into' }, Date.now())
    expect(result.retagged).toBe(2)
    expect(await seatAccountId(g1, 0)).toBe('rom-into')
    expect(await seatAccountId(g2, 0)).toBe('rom-into')
  })

  it('is idempotent — re-running the same merge retags 0 rows the second time', async () => {
    await mkAcct('rom-idem-from')
    await mkAcct('rom-idem-into')
    const g1 = `rom-idem-g1-${crypto.randomUUID()}`
    await mkGame(g1)
    await mkSeat(g1, 0, 'rom-idem-from')

    const merge = { fromAccountId: 'rom-idem-from', intoAccountId: 'rom-idem-into' }
    const first = await reconcileOneMerge(DB(), merge, Date.now())
    expect(first.retagged).toBe(1)
    const second = await reconcileOneMerge(DB(), merge, Date.now())
    expect(second.retagged).toBe(0) // no rows left tagged `from` — a true no-op
    expect(await seatAccountId(g1, 0)).toBe('rom-idem-into') // unchanged, still correct
  })

  it('flags self-play when from and into occupy DIFFERENT seats of the SAME game', async () => {
    await mkAcct('rom-sp-from')
    await mkAcct('rom-sp-into')
    const g1 = `rom-sp-g1-${crypto.randomUUID()}`
    await mkGame(g1)
    await mkSeat(g1, 0, 'rom-sp-from')
    await mkSeat(g1, 1, 'rom-sp-into') // a DIFFERENT seat, same game -> self-play evidence

    const result = await reconcileOneMerge(DB(), { fromAccountId: 'rom-sp-from', intoAccountId: 'rom-sp-into' }, Date.now())
    expect(result.selfPlayFlags).toContain(g1)

    const flagRow = await DB()
      .prepare(`SELECT from_id, into_id FROM merge_selfplay_flags WHERE game_uuid=?`)
      .bind(g1)
      .first<{ from_id: string; into_id: string }>()
    expect(flagRow).toMatchObject({ from_id: 'rom-sp-from', into_id: 'rom-sp-into' })

    // The retag still happens — self-play is flagged for review, never blocked on.
    expect(await seatAccountId(g1, 0)).toBe('rom-sp-into')
  })

  it('does NOT flag self-play for two seats of the SAME account (not different people)', async () => {
    await mkAcct('rom-nosp-from')
    await mkAcct('rom-nosp-into')
    const g1 = `rom-nosp-g1-${crypto.randomUUID()}`
    await mkGame(g1)
    await mkSeat(g1, 0, 'rom-nosp-from') // only `from` present; `into` never played this game

    const result = await reconcileOneMerge(DB(), { fromAccountId: 'rom-nosp-from', intoAccountId: 'rom-nosp-into' }, Date.now())
    expect(result.selfPlayFlags).toEqual([])
  })
})

describe('reconcileMerges (full sweep)', () => {
  it('applies ALL active merges in one sweep', async () => {
    await mkAcct('sweep-a-from')
    await mkAcct('sweep-a-into')
    await mkAcct('sweep-b-from')
    await mkAcct('sweep-b-into')
    const ga = `sweep-ga-${crypto.randomUUID()}`
    const gb = `sweep-gb-${crypto.randomUUID()}`
    await mkGame(ga)
    await mkGame(gb)
    await mkSeat(ga, 0, 'sweep-a-from')
    await mkSeat(gb, 0, 'sweep-b-from')
    await mkMerge('sweep-a-from', 'sweep-a-into')
    await mkMerge('sweep-b-from', 'sweep-b-into')

    const summary = await reconcileMerges(DB(), IDENTITY_DB())
    expect(summary.mergesSwept).toBeGreaterThanOrEqual(2) // >= : the shared test D1 may carry merges from other suites
    expect(await seatAccountId(ga, 0)).toBe('sweep-a-into')
    expect(await seatAccountId(gb, 0)).toBe('sweep-b-into')
  })

  it('a LATE row minted under the merged-away id is fixed by the NEXT sweep', async () => {
    await mkAcct('late-from')
    await mkAcct('late-into')
    await mkMerge('late-from', 'late-into')

    // Sweep BEFORE the late row exists — nothing to retag yet for this game.
    await reconcileMerges(DB(), IDENTITY_DB())

    // A late write lands under the ALREADY-merged-away id (e.g. a stale
    // legacy 24h token, or a DO seat write racing the merge).
    const gLate = `late-g1-${crypto.randomUUID()}`
    await mkGame(gLate)
    await mkSeat(gLate, 0, 'late-from')
    expect(await seatAccountId(gLate, 0)).toBe('late-from') // not yet fixed

    // The NEXT sweep (no watermark — it re-scans every active merge every
    // time) heals it within one pass.
    await reconcileMerges(DB(), IDENTITY_DB())
    expect(await seatAccountId(gLate, 0)).toBe('late-into')
  })

  it('is wired into the real 1-minute cron (worker.scheduled)', async () => {
    await mkAcct('wired-from')
    await mkAcct('wired-into')
    await mkMerge('wired-from', 'wired-into')
    const gWired = `wired-g1-${crypto.randomUUID()}`
    await mkGame(gWired)
    await mkSeat(gWired, 0, 'wired-from')

    const ctx = createExecutionContext()
    await worker.scheduled!({ cron: '* * * * *', scheduledTime: Date.now(), noRetry() {} } as unknown as ScheduledController, env as never, ctx)
    await waitOnExecutionContext(ctx)

    expect(await seatAccountId(gWired, 0)).toBe('wired-into')
  })
})
