import { SELF, env, runInDurableObject } from 'cloudflare:test'
import { it, expect, describe } from 'vitest'
import type { SqlLike } from '../src/do/storage'
import {
  isSeatPresent,
  isAnyHumanPresent,
  seatIndexPresent,
  markDisconnected,
  autoCover,
} from '../src/do/presence'
import { hasTimer, minFireAt } from '../src/do/timers'
import { GRACE_MS, AWAY_TURN_MS, PRESENCE_MS } from '../src/do/constants'
import { seedLiveGame, authHeaders, mintToken } from './helpers'

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

const NOW = 5_000_000

describe('presence predicates (heartbeat is the sole authority)', () => {
  it('a seat is present iff last_seen_at is within PRESENCE_MS', async () => {
    await runInDurableObject(stubFor('presence-pred'), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const { repo } = seedLiveGame(sql, { playerCount: 3, aiSeats: [], presentSeats: [1], now: NOW })
      expect(seatIndexPresent(repo, 1, NOW)).toBe(true)
      expect(seatIndexPresent(repo, 0, NOW)).toBe(false) // never heartbeated
      expect(isAnyHumanPresent(repo, NOW)).toBe(true)
      // just past the window -> stale
      expect(seatIndexPresent(repo, 1, NOW + PRESENCE_MS + 1)).toBe(false)
      expect(isAnyHumanPresent(repo, NOW + PRESENCE_MS + 1)).toBe(false)
      const seat1 = repo.getSeats()[1]!
      expect(isSeatPresent(seat1, NOW + PRESENCE_MS)).toBe(true) // boundary inclusive
    })
  })
})

describe('markDisconnected', () => {
  it('arms the grace clock for an OFF-turn seat', async () => {
    await runInDurableObject(stubFor('presence-grace'), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      // current_seat is 0; disconnect seat 1 (off turn)
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [0], now: NOW })
      markDisconnected(repo, sql, 1, NOW)
      expect(hasTimer(sql, 'grace', 1)).toBe(true)
      expect(hasTimer(sql, 'turn', 1)).toBe(false)
      expect(minFireAt(sql)).toBe(NOW + GRACE_MS)
      expect(repo.getSeats()[1]!.disconnected_at).toBe(NOW)
    })
  })

  it('arms the fast-track turn clock for an ON-turn seat', async () => {
    await runInDurableObject(stubFor('presence-turn'), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [0], now: NOW })
      // current_seat is 0; disconnect seat 0 (ON turn)
      markDisconnected(repo, sql, 0, NOW)
      expect(hasTimer(sql, 'turn', 0)).toBe(true)
      expect(hasTimer(sql, 'grace', 0)).toBe(false)
      expect(minFireAt(sql)).toBe(NOW + AWAY_TURN_MS) // faster than grace
    })
  })
})

describe('autoCover', () => {
  it('flips control, clears absence deadlines, kicks the drive loop, and toasts', async () => {
    await runInDurableObject(stubFor('presence-cover'), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [1], now: NOW })
      markDisconnected(repo, sql, 0, NOW) // arms a deadline for seat 0

      const toasts: unknown[] = []
      autoCover({ broadcast: (p) => toasts.push(p) }, repo, sql, 0, NOW)

      expect(repo.getSeats()[0]!.controlled_by_ai).toBe(true)
      expect(hasTimer(sql, 'grace', 0)).toBe(false)
      expect(hasTimer(sql, 'turn', 0)).toBe(false)
      expect(hasTimer(sql, 'ai_step', 0)).toBe(true) // drive loop kicked
      expect(toasts).toEqual([{ type: 'ai_cover', seat: 0 }])
    })
  })
})

describe('POST /heartbeat', () => {
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

  it('refreshes presence and acks the seat resolved from the token account', async () => {
    const gameId = await createGame()
    const res = await SELF.fetch(`https://example.com/games/${gameId}/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeaders('acct-0')) },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, seat: 0 })

    // last_seen_at is now set for seat 0 (inspect the DO directly).
    const stub = env.GAME_DO.get(env.GAME_DO.idFromName(gameId))
    const lastSeen = await runInDurableObject(stub, (i: any, state: any) => {
      const seat = [...state.storage.sql.exec('SELECT last_seen_at FROM seats WHERE seat_index=0')][0]
      return seat.last_seen_at
    })
    expect(typeof lastSeen).toBe('number')
  })

  it('rejects an unauthenticated heartbeat (401)', async () => {
    const gameId = await createGame()
    const res = await SELF.fetch(`https://example.com/games/${gameId}/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })

  it('rejects a heartbeat from an account that owns no seat (403)', async () => {
    const gameId = await createGame()
    const res = await SELF.fetch(`https://example.com/games/${gameId}/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${await mintToken('acct-nobody')}` },
    })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('not_your_seat')
  })
})
