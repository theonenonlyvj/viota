import { env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyD1Schema } from '../src/d1/schema'
import { mergeAccounts } from '../src/identity/merge'
import { canonical } from '../src/identity/canonical'

const DB = () => (env as unknown as { DB: D1Database }).DB

async function mkAcct(id: string): Promise<void> {
  const now = Date.now()
  await DB()
    .prepare(
      `INSERT INTO accounts (id,credential_hash,display_name,created_at,status,token_epoch,origin_game,must_change_pw,login_fail_count,last_seen_at) VALUES (?,?,?,?,'ghost',0,'iota',0,0,?)`,
    )
    .bind(id, 'ch_' + id, id, now, now)
    .run()
}
async function mkDevice(h: string, acc: string): Promise<void> {
  const now = Date.now()
  await DB()
    .prepare(`INSERT INTO device_credentials (credential_hash,account_id,created_at,last_seen_at) VALUES (?,?,?,?)`)
    .bind(h, acc, now, now)
    .run()
}

describe('mergeAccounts', () => {
  beforeAll(async () => {
    await applyD1Schema(DB())
  })

  it('re-tags devices/game_players/external_identities and marks from merged, epoch bumped, path-compressed', async () => {
    await mkAcct('into')
    await mkAcct('from')
    await mkAcct('child')
    await mkDevice('dh1', 'from')
    await DB().prepare(`UPDATE accounts SET merged_into='from', status='merged' WHERE id='child'`).run() // child points at from

    const res = await mergeAccounts(DB(), 'from', 'into', 'system:login', 'test')
    expect(res.ok).toBe(true)

    const fromRow = await DB()
      .prepare(`SELECT status, merged_into, token_epoch FROM accounts WHERE id='from'`)
      .first<{ status: string; merged_into: string; token_epoch: number }>()
    expect(fromRow).toMatchObject({ status: 'merged', merged_into: 'into' })
    expect(fromRow!.token_epoch).toBeGreaterThan(0)

    const dev = await DB()
      .prepare(`SELECT account_id FROM device_credentials WHERE credential_hash='dh1'`)
      .first<{ account_id: string }>()
    expect(dev!.account_id).toBe('into')

    expect((await canonical(DB(), 'child'))!.id).toBe('into') // path-compressed
  })

  it('is idempotent (second identical merge is a no-op)', async () => {
    await mkAcct('into2')
    await mkAcct('from2')
    await mergeAccounts(DB(), 'from2', 'into2', 'system:login', 't')
    const again = await mergeAccounts(DB(), 'from2', 'into2', 'system:login', 't')
    expect(again.noop).toBe(true)
  })

  it('dryRun returns counts + flags without writing', async () => {
    await mkAcct('into3')
    await mkAcct('from3')
    await mkDevice('dh3', 'from3')
    const res = await mergeAccounts(DB(), 'from3', 'into3', 'admin:vijay', 't', {
      dryRun: true,
      includeAudit: false,
    })
    expect(res.dryRun).toBe(true)
    const row = await DB().prepare(`SELECT status FROM accounts WHERE id='from3'`).first<{ status: string }>()
    expect(row!.status).toBe('ghost') // unchanged
    expect(res.retagCounts.device_credentials).toBe(1)
  })

  it('can skip audit-only reads for an automatic login fold without skipping writes', async () => {
    await mkAcct('into-fast')
    await mkAcct('from-fast')
    await mkDevice('dh-fast', 'from-fast')

    const res = await mergeAccounts(DB(), 'from-fast', 'into-fast', 'system:login', 'login-fold', {
      includeAudit: false,
    })

    expect(res).toMatchObject({ ok: true, dryRun: false })
    expect(res.retagCounts).toEqual({})
    expect(res.selfPlayFlags).toEqual([])
    const fromRow = await DB()
      .prepare(`SELECT status, merged_into FROM accounts WHERE id='from-fast'`)
      .first<{ status: string; merged_into: string }>()
    expect(fromRow).toMatchObject({ status: 'merged', merged_into: 'into-fast' })
    const device = await DB()
      .prepare(`SELECT account_id FROM device_credentials WHERE credential_hash='dh-fast'`)
      .first<{ account_id: string }>()
    expect(device!.account_id).toBe('into-fast')
  })

  it('flags self-play when both occupy different seats of one game', async () => {
    await mkAcct('sa')
    await mkAcct('sb')
    await DB()
      .prepare(`INSERT INTO games (game_uuid, mode, status, player_count, created_at, game_type) VALUES ('g1','online','completed',2,?, 'iota')`)
      .bind(Date.now())
      .run()
    await DB()
      .prepare(`INSERT INTO game_players (game_uuid, seat_index, account_id, owner_type) VALUES ('g1',0,'sa','human'),('g1',1,'sb','human')`)
      .run()
    const res = await mergeAccounts(DB(), 'sa', 'sb', 'admin:vijay', 't', { dryRun: true })
    expect(res.selfPlayFlags).toContain('g1')
  })

  it('is cycle-safe and returns ok:false/noop for a merge into itself (after canonicalization)', async () => {
    await mkAcct('self1')
    const res = await mergeAccounts(DB(), 'self1', 'self1', 'system:login', 't')
    expect(res.noop).toBe(true)
  })

  it('two near-simultaneous identical merges race the idempotency check gracefully (no unhandled UNIQUE 500)', async () => {
    // Both calls can pass the pre-batch idempotency SELECT (neither sees an
    // active account_merges row yet) before either's db.batch INSERT lands —
    // the uidx_merge_active UNIQUE index then rejects the loser. That must
    // resolve to a graceful noop result, never an unhandled/thrown error.
    await mkAcct('into5')
    await mkAcct('from5')
    const results = await Promise.all([
      mergeAccounts(DB(), 'from5', 'into5', 'system:login', 'race'),
      mergeAccounts(DB(), 'from5', 'into5', 'system:login', 'race'),
    ])
    for (const res of results) {
      expect(res.ok).toBe(true)
    }
    const row = await DB()
      .prepare(`SELECT status, merged_into FROM accounts WHERE id='from5'`)
      .first<{ status: string; merged_into: string }>()
    expect(row).toMatchObject({ status: 'merged', merged_into: 'into5' })
  })
})
