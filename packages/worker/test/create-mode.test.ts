import { SELF, env } from 'cloudflare:test'
import { it, expect, beforeAll } from 'vitest'
import { authHeaders } from './helpers'
import { applyD1Schema } from '../src/d1/schema'

const DB = () => (env as unknown as { DB: D1Database }).DB
beforeAll(async () => { await applyD1Schema(DB()) })

async function create(body: object, accountId?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (accountId) Object.assign(headers, await authHeaders(accountId))
  return SELF.fetch('https://example.com/games', { method: 'POST', headers, body: JSON.stringify(body) })
}

it('mode=multiplayer creates a waiting room that is immediately resolvable + syncs the roster', async () => {
  const res = await create({ playerCount: 3, mode: 'multiplayer', displayName: 'Alice' }, 'host-1')
  expect(res.status).toBe(201)
  const { gameId, code } = (await res.json()) as any
  expect(typeof gameId).toBe('string')
  expect(code.length).toBe(6)

  // Immediately resolvable — create-room AWAITED the D1 registry write.
  const rr = await SELF.fetch(`https://example.com/games/resolve?code=${code}`)
  expect(rr.status).toBe(200)
  expect(((await rr.json()) as any).gameId).toBe(gameId)

  // GET /sync returns the waiting roster (no board) for the host.
  const sync = await SELF.fetch(`https://example.com/games/${gameId}/sync`, { headers: await authHeaders('host-1') })
  expect(sync.status).toBe(200)
  const room = (await sync.json()) as any
  expect(room.status).toBe('waiting')
  expect(room.playerCount).toBe(3)
  expect(room.code).toBe(code)
  expect(room.seats.length).toBe(3)
  expect(room.seats[0]).toMatchObject({ seatIndex: 0, ownerType: 'human', displayName: 'Alice' })
  expect(room.seats[1]).toMatchObject({ ownerType: 'open' })
  expect('snapshot' in room).toBe(false)
})

it('mode=multiplayer requires auth', async () => {
  expect((await create({ playerCount: 2, mode: 'multiplayer', displayName: 'X' })).status).toBe(401)
})

it('mode=solo creates an active solo game (seat 0 = host + AI, immediate deal)', async () => {
  const res = await create({ playerCount: 2, mode: 'solo', displayName: 'Solo' }, 'solo-1')
  expect(res.status).toBe(201)
  const { gameId } = (await res.json()) as any
  const sync = await SELF.fetch(`https://example.com/games/${gameId}/sync`, { headers: await authHeaders('solo-1') })
  expect(sync.status).toBe(200)
  const b = (await sync.json()) as any
  expect(b.snapshot.mySeat).toBe(0)
  expect(b.snapshot.myHand.length).toBe(4)
})

it('mode=solo requires auth', async () => {
  expect((await create({ playerCount: 2, mode: 'solo', displayName: 'X' })).status).toBe(401)
})

it('the legacy seatOwners create (no mode) is rejected (path removed) -> 400 invalid_mode', async () => {
  const res = await create({
    playerCount: 2,
    seatOwners: [
      { ownerType: 'human', accountId: 'a0', displayName: 'P0' },
      { ownerType: 'ai', controlledByAi: true, displayName: 'Bot' },
    ],
  })
  expect(res.status).toBe(400)
  expect(((await res.json()) as any).error).toBe('invalid_mode')
})

it('full flow: create-room -> resolve -> join updates the polled roster', async () => {
  const created = (await (await create({ playerCount: 3, mode: 'multiplayer', displayName: 'Host' }, 'h1')).json()) as any
  const { gameId } = (await (await SELF.fetch(`https://example.com/games/resolve?code=${created.code}`)).json()) as any

  const joinRes = await SELF.fetch(`https://example.com/games/${gameId}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders('friend-1')) },
    body: JSON.stringify({ displayName: 'Friend' }),
  })
  expect(joinRes.status).toBe(200)
  expect(((await joinRes.json()) as any).seatIndex).toBe(1)

  // The host polls the waiting roster and sees the joiner.
  const room = (await (await SELF.fetch(`https://example.com/games/${gameId}/sync`, { headers: await authHeaders('h1') })).json()) as any
  expect(room.seats[1]).toMatchObject({ ownerType: 'human', displayName: 'Friend' })
})
