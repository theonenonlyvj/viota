import { SELF, env, runInDurableObject } from 'cloudflare:test'
import { it, expect, beforeAll } from 'vitest'
import { authHeaders, createActiveGame } from './helpers'
import { applyD1Schema } from '../src/d1/schema'
import { GameRepository } from '../src/do/storage'

const DB = () => (env as unknown as { DB: D1Database }).DB
function stubFor(name: string) { return env.GAME_DO.get(env.GAME_DO.idFromName(name)) }
beforeAll(async () => { await applyD1Schema(DB()) })

async function createActive() {
  return createActiveGame(['p0', 'p1'])
}

async function leave(gameId: string, accountId: string) {
  return SELF.fetch(`https://example.com/games/${gameId}/leave`, { method: 'POST', headers: await authHeaders(accountId) })
}

it('POST /leave AI-covers the caller own seat immediately (instant cover, seat still owned)', async () => {
  const gameId = await createActive()
  const res = await leave(gameId, 'p1')
  expect(res.status).toBe(200)
  expect(((await res.json()) as any).seat).toBe(1)

  const seat = await runInDurableObject(stubFor(gameId), (_i, state: any) => {
    const repo = new GameRepository(state.storage.sql)
    return repo.getSeats()[1]
  })
  expect(seat.controlled_by_ai).toBe(true)
  expect(seat.owner_account_id).toBe('p1') // still owns it -> reclaimable
})

it('POST /leave 403s for a non-seated account', async () => {
  const gameId = await createActive()
  expect((await leave(gameId, 'stranger')).status).toBe(403)
})

it('POST /leave requires auth', async () => {
  const gameId = await createActive()
  expect((await SELF.fetch(`https://example.com/games/${gameId}/leave`, { method: 'POST' })).status).toBe(401)
})
