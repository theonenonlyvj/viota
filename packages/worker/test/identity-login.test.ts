import { SELF, env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyD1Schema } from '../src/d1/schema'

const DB = () => (env as unknown as { DB: D1Database }).DB

function q(path: string, body: unknown): Promise<Response> {
  return SELF.fetch('https://example.com' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/auth/login', () => {
  beforeAll(async () => {
    await applyD1Schema(DB())
    const tok = ((await (await q('/auth/quick', { deviceCredential: 'cred-login-000000000', displayName: 'Log' })).json()) as {
      token: string
    }).token
    await SELF.fetch('https://example.com/auth/set-credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
      body: JSON.stringify({ username: 'logger', password: 'hunter2' }),
    })
  })

  it('logs in with correct credentials on a fresh device and binds it', async () => {
    const r = await q('/auth/login', { username: 'logger', password: 'hunter2', deviceCredential: 'cred-newdevice-11111' })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { token: string; accountId: string; mustChangePassword: boolean }
    expect(body.token).toBeTruthy()
    expect(body.mustChangePassword).toBe(false)
    const dev = await DB().prepare(`SELECT account_id FROM device_credentials WHERE account_id=?`).bind(body.accountId).all()
    expect(dev.results.length).toBeGreaterThanOrEqual(2) // original + newly bound
  })

  it('returns generic 401 on wrong password', async () => {
    const r = await q('/auth/login', { username: 'logger', password: 'nope', deviceCredential: 'd-wrong-pw-000000000' })
    expect(r.status).toBe(401)
    expect((await r.json()) as { error: string }).toMatchObject({ error: 'invalid_credentials' })
  })

  it('returns the SAME generic 401 on unknown user (anti-enumeration)', async () => {
    const r = await q('/auth/login', { username: 'ghostuser', password: 'whatever', deviceCredential: 'd-unknown-user-00000' })
    expect(r.status).toBe(401)
    expect((await r.json()) as { error: string }).toMatchObject({ error: 'invalid_credentials' })
  })

  it('does not scale failure latency with login_fail_count (no existence-correlated delay)', async () => {
    // A REAL (existing) username, driven through several failed attempts so
    // login_fail_count climbs — under the old bug this scaled a setTimeout
    // delay (fails*100ms, capped 1500ms). An unknown username's fail count
    // never exists/grows, so it always got 0ms extra delay: the growing-vs-flat
    // pattern was an existence oracle. There must be no such branch anymore —
    // a known user with a high fail count and an unknown user must take
    // comparably bounded time on the SAME failing request.
    for (let i = 0; i < 5; i++) {
      await q('/auth/login', { username: 'logger', password: 'still-wrong-' + i, deviceCredential: 'd-timing-fail-' + i })
    }
    const t0 = Date.now()
    await q('/auth/login', { username: 'logger', password: 'still-wrong-final', deviceCredential: 'd-timing-fail-final' })
    const knownElapsedMs = Date.now() - t0

    const t1 = Date.now()
    await q('/auth/login', { username: 'never-existed-timing-user', password: 'whatever', deviceCredential: 'd-timing-unknown' })
    const unknownElapsedMs = Date.now() - t1

    // No account-state-dependent delay branch remains: the gap between a
    // fail-heavy known user and a fresh unknown user must stay small (PBKDF2
    // cost is the only shared, existence-independent latency floor). Under
    // the old bug this gap was >= 500ms (5 prior fails * 100ms).
    expect(Math.abs(knownElapsedMs - unknownElapsedMs)).toBeLessThan(300)
  })

  it('mints a token that verifies via requireCanonicalAccount (vgames token, not legacy)', async () => {
    const r = await q('/auth/login', { username: 'logger', password: 'hunter2', deviceCredential: 'cred-verify-device-1' })
    const { token, accountId } = (await r.json()) as { token: string; accountId: string }
    const acc = await DB().prepare(`SELECT status FROM accounts WHERE id=?`).bind(accountId).first<{ status: string }>()
    expect(acc!.status).toBe('claimed')
    // A vgames token carries claims a plain legacy `signToken` never would —
    // verified indirectly via a successful /auth/set-credentials-style authed call.
    const r2 = await SELF.fetch('https://example.com/auth/set-credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({ username: 'reclaim_attempt', password: 'abcdef' }),
    })
    expect(r2.status).toBe(409) // already claimed, not ghost -> proves the token authenticated correctly
  })
})

describe('/auth/login session-bound ghost-fold', () => {
  it('folds the ghost mapped to the presented deviceCredential into the logged-in account', async () => {
    // 1) A ghost plays a game on this device (deviceCredential = the fold cred).
    const foldCred = 'cred-fold-ghost-11111'
    const ghostTok = (await (await q('/auth/quick', { deviceCredential: foldCred, displayName: 'GhostToFold' })).json()) as {
      accountId: string
    }
    const ghostId = ghostTok.accountId
    await DB()
      .prepare(`INSERT INTO games (game_uuid, mode, status, player_count, created_at, game_type) VALUES ('fold-g1','online','completed',2,?,'iota')`)
      .bind(Date.now())
      .run()
    await DB()
      .prepare(`INSERT INTO game_players (game_uuid, seat_index, account_id, owner_type) VALUES ('fold-g1', 0, ?, 'human')`)
      .bind(ghostId)
      .run()

    // 2) A separate, already-claimed account exists (a different device).
    const targetTok = (await (await q('/auth/quick', { deviceCredential: 'cred-fold-target-00000', displayName: 'FoldTarget' })).json()) as {
      token: string
    }
    await SELF.fetch('https://example.com/auth/set-credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + targetTok.token },
      body: JSON.stringify({ username: 'foldtarget', password: 'hunter2' }),
    })

    // 3) Now log into that claimed account FROM the ghost's device (same credential).
    const r = await q('/auth/login', { username: 'foldtarget', password: 'hunter2', deviceCredential: foldCred })
    expect(r.status).toBe(200)
    const { accountId: targetId } = (await r.json()) as { accountId: string }

    // The ghost is now merged into the just-logged-in account...
    const ghostRow = await DB().prepare(`SELECT status, merged_into FROM accounts WHERE id=?`).bind(ghostId).first<{
      status: string
      merged_into: string
    }>()
    expect(ghostRow).toMatchObject({ status: 'merged', merged_into: targetId })

    // ...and its game folds along with it.
    const gp = await DB().prepare(`SELECT account_id FROM game_players WHERE game_uuid='fold-g1' AND seat_index=0`).first<{
      account_id: string
    }>()
    expect(gp!.account_id).toBe(targetId)
  })

  it('does NOT fold when the presented device maps to an already-CLAIMED account', async () => {
    // Two distinct claimed accounts must never silently merge just because a
    // browser happens to log into account B from a device that was A's.
    const aTok = (await (await q('/auth/quick', { deviceCredential: 'cred-fold-claimedA-1', displayName: 'A' })).json()) as {
      token: string
      accountId: string
    }
    await SELF.fetch('https://example.com/auth/set-credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + aTok.token },
      body: JSON.stringify({ username: 'foldclaimeda', password: 'hunter2' }),
    })
    const bTok = (await (await q('/auth/quick', { deviceCredential: 'cred-fold-claimedB-1', displayName: 'B' })).json()) as {
      token: string
    }
    await SELF.fetch('https://example.com/auth/set-credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + bTok.token },
      body: JSON.stringify({ username: 'foldclaimedb', password: 'hunter2' }),
    })

    // Log into B's account, presenting A's device credential.
    const r = await q('/auth/login', { username: 'foldclaimedb', password: 'hunter2', deviceCredential: 'cred-fold-claimedA-1' })
    expect(r.status).toBe(200)

    const aRow = await DB().prepare(`SELECT status FROM accounts WHERE id=?`).bind(aTok.accountId).first<{ status: string }>()
    expect(aRow!.status).toBe('claimed') // untouched — NOT folded/merged
  })
})
