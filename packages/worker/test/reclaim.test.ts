import { SELF, env, runInDurableObject } from 'cloudflare:test'
import { it, expect, describe } from 'vitest'
import { GameRepository, type SqlLike } from '../src/do/storage'
import { setTimer, hasTimer } from '../src/do/timers'
import { driveIfAI } from '../src/do/drive'
import { authHeaders, mintToken } from './helpers'

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

async function createGame(): Promise<string> {
  const seatOwners = [
    { ownerType: 'human' as const, accountId: 'acct-0', displayName: 'P0' },
    { ownerType: 'human' as const, accountId: 'acct-1', displayName: 'P1' },
  ]
  const res = await SELF.fetch('https://example.com/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerCount: 2, seatOwners }),
  })
  return ((await res.json()) as { gameId: string }).gameId
}

describe('POST /reclaim', () => {
  it('silently reclaims an AI-covered seat: clears control+timers, refreshes presence, returns a redacted snapshot, and a later drive does NOT play it', async () => {
    const gameId = await createGame()

    // Simulate an auto-cover of seat 0 (the current turn): AI control, a
    // disconnect mark, and a full set of this seat's timers armed.
    await runInDurableObject(stubFor(gameId), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const repo = new GameRepository(sql)
      repo.setControlledByAi(0, true)
      repo.setDisconnectedAt(0, 1000)
      setTimer(sql, 'grace', 0, 9_000_000)
      setTimer(sql, 'turn', 0, 9_000_000)
      setTimer(sql, 'ai_step', 0, 9_000_000)
      setTimer(sql, 'soft', 0, 9_000_000)
    })

    // The human for seat 0 reclaims.
    const res = await SELF.fetch(`https://example.com/games/${gameId}/reclaim`, {
      method: 'POST',
      headers: await authHeaders('acct-0'),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.moveIndex).toBe(0) // committed AI move never rolled back (none here)
    expect(body.snapshot.mySeat).toBe(0)
    expect(Array.isArray(body.snapshot.myHand)).toBe(true)
    expect('drawPile' in body.snapshot).toBe(false) // redacted

    await runInDurableObject(stubFor(gameId), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const repo = new GameRepository(sql)
      const seat0 = repo.getSeats()[0]!
      expect(seat0.controlled_by_ai).toBe(false)
      expect(seat0.disconnected_at).toBeNull()
      expect(typeof seat0.last_seen_at).toBe('number')
      expect(hasTimer(sql, 'grace', 0)).toBe(false)
      expect(hasTimer(sql, 'turn', 0)).toBe(false)
      expect(hasTimer(sql, 'ai_step', 0)).toBe(false)
      expect(hasTimer(sql, 'soft', 0)).toBe(false)

      // A subsequent drive tick must NOT play for the reclaimed (human) seat.
      const before = repo.getMeta()!.move_index
      driveIfAI({ ctx: state, nudge: () => {} }, repo, sql, Date.now())
      expect(repo.getMeta()!.move_index).toBe(before) // nothing committed
      expect(repo.getMovesSince(0).some((r) => r.seat_index === 0)).toBe(false)
    })
  })

  it('rejects an unauthenticated reclaim (401) and one from an account with no seat (403)', async () => {
    const gameId = await createGame()
    expect((await SELF.fetch(`https://example.com/games/${gameId}/reclaim`, { method: 'POST' })).status).toBe(401)
    const res = await SELF.fetch(`https://example.com/games/${gameId}/reclaim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await mintToken('acct-nobody')}` },
    })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('not_your_seat')
  })
})
