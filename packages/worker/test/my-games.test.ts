import { SELF, env } from 'cloudflare:test'
import { it, expect, describe, beforeAll } from 'vitest'
import { authHeaders } from './helpers'
import { applyD1Schema } from '../src/d1/schema'

const DB = () => (env as unknown as { DB: D1Database }).DB

beforeAll(async () => {
  await applyD1Schema(DB())
})

/** Seed a games registry row + one game_players seat directly into D1. */
async function seedGame(
  gameUuid: string,
  status: string,
  accountId: string,
  seatIndex: number,
  lastActivityAt: number,
  code: string | null = null,
) {
  await DB()
    .prepare('INSERT INTO games (game_uuid, status, player_count, last_activity_at, code) VALUES (?, ?, 2, ?, ?)')
    .bind(gameUuid, status, lastActivityAt, code)
    .run()
  await DB()
    .prepare('INSERT INTO game_players (game_uuid, seat_index, account_id, owner_type) VALUES (?, ?, ?, ?)')
    .bind(gameUuid, seatIndex, accountId, 'human')
    .run()
}

async function myGames(accountId: string): Promise<Response> {
  return SELF.fetch('https://example.com/my-games', { headers: await authHeaders(accountId) })
}

describe('GET /my-games', () => {
  it('returns the account waiting + active games with their seat, newest activity first', async () => {
    const acct = `mg-${crypto.randomUUID()}`
    const waiting = `w-${crypto.randomUUID()}`
    const active = `a-${crypto.randomUUID()}`
    const done = `d-${crypto.randomUUID()}`
    const other = `o-${crypto.randomUUID()}`
    await seedGame(waiting, 'waiting', acct, 0, 1000, 'ROOMAA')
    await seedGame(active, 'active', acct, 1, 3000)
    await seedGame(done, 'completed', acct, 0, 5000) // terminal -> excluded
    await seedGame(other, 'active', `someone-else-${crypto.randomUUID()}`, 0, 9000) // not mine -> excluded

    const res = await myGames(acct)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { games: any[] }
    expect(body.games.map((g) => g.game_uuid)).toEqual([active, waiting]) // DESC by last_activity_at

    const activeRow = body.games.find((g) => g.game_uuid === active)
    expect(activeRow).toMatchObject({ status: 'active', seat_index: 1, player_count: 2 })
    const waitingRow = body.games.find((g) => g.game_uuid === waiting)
    expect(waitingRow).toMatchObject({ status: 'waiting', seat_index: 0, code: 'ROOMAA' })
  })

  it('returns an empty list for an account with no resumable games', async () => {
    const res = await myGames(`nobody-${crypto.randomUUID()}`)
    expect(res.status).toBe(200)
    expect((await res.json()).games).toEqual([])
  })

  it('requires auth (401 without a token)', async () => {
    const res = await SELF.fetch('https://example.com/my-games')
    expect(res.status).toBe(401)
  })
})
