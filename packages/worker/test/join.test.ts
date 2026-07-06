import { SELF, env, runInDurableObject } from 'cloudflare:test'
import { it, expect, beforeAll } from 'vitest'
import { authHeaders, createSoloGame } from './helpers'
import { applyD1Schema } from '../src/d1/schema'
import { runMigrations, GameRepository } from '../src/do/storage'
import { createWaitingRoom } from '../src/do/init'

const DB = () => (env as unknown as { DB: D1Database }).DB
function stubFor(name: string) { return env.GAME_DO.get(env.GAME_DO.idFromName(name)) }

beforeAll(async () => { await applyD1Schema(DB()) })

async function seedRoom(gameId: string, playerCount: number, host = 'host') {
  await runInDurableObject(stubFor(gameId), (_i, state: any) => {
    const sql = state.storage.sql
    runMigrations(sql)
    const repo = new GameRepository(sql)
    createWaitingRoom(repo, {
      playerCount, hostAccountId: host, hostDisplayName: 'Host',
      gameUuid: gameId, engineVersion: 'e', code: 'ROOM01',
    })
  })
}

async function join(gameId: string, accountId: string, body: object = {}) {
  return SELF.fetch(`https://example.com/games/${gameId}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders(accountId)) },
    body: JSON.stringify(body),
  })
}

it('POST /join claims the lowest open seat and returns the roster', async () => {
  const gameId = crypto.randomUUID()
  await seedRoom(gameId, 3)
  const res = await join(gameId, 'joiner-1', { displayName: 'Bob' })
  expect(res.status).toBe(200)
  const b = (await res.json()) as any
  expect(b.seatIndex).toBe(1)
  expect(b.room.status).toBe('waiting')
  expect(b.room.playerCount).toBe(3)
  expect(b.room.code).toBe('ROOM01')
  const seat1 = b.room.seats.find((s: any) => s.seatIndex === 1)
  expect(seat1).toMatchObject({ ownerType: 'human', displayName: 'Bob' })
})

it('POST /join sanitizes the display name', async () => {
  const gameId = crypto.randomUUID()
  await seedRoom(gameId, 3)
  const b = (await (await join(gameId, 'joiner-x', { displayName: '<b>Eve</b>' })).json()) as any
  const seat = b.room.seats.find((s: any) => s.seatIndex === b.seatIndex)
  expect(seat.displayName).toBe('bEve/b') // metachars stripped
})

it('POST /join is idempotent for an account that already holds a seat', async () => {
  const gameId = crypto.randomUUID()
  await seedRoom(gameId, 3)
  const first = (await (await join(gameId, 'joiner-1')).json()) as any
  const second = (await (await join(gameId, 'joiner-1')).json()) as any
  expect(second.seatIndex).toBe(first.seatIndex)
})

it('POST /join honors an explicit open seatIndex', async () => {
  const gameId = crypto.randomUUID()
  await seedRoom(gameId, 4)
  const b = (await (await join(gameId, 'joiner-2', { seatIndex: 2 })).json()) as any
  expect(b.seatIndex).toBe(2)
})

it('POST /join 409s on a taken explicit seatIndex', async () => {
  const gameId = crypto.randomUUID()
  await seedRoom(gameId, 4)
  const res = await join(gameId, 'joiner-h', { seatIndex: 0 }) // seat 0 = host
  expect(res.status).toBe(409)
})

it('POST /join 409s when the room is full', async () => {
  const gameId = crypto.randomUUID()
  await seedRoom(gameId, 2) // seat0 host + seat1 open
  await join(gameId, 'j1') // takes seat 1
  const res = await join(gameId, 'j2') // no open seat
  expect(res.status).toBe(409)
})

it('POST /join 409s when the game is not waiting', async () => {
  // A solo create is dealt immediately (active, not waiting) -> not joinable.
  const gameId = await createSoloGame('a0')
  const res = await join(gameId, 'stranger')
  expect(res.status).toBe(409)
})

it('POST /join requires auth', async () => {
  const gameId = crypto.randomUUID()
  await seedRoom(gameId, 3)
  const res = await SELF.fetch(`https://example.com/games/${gameId}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  expect(res.status).toBe(401)
})
