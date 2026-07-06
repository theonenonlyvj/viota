import { SELF, env } from 'cloudflare:test'
import { it, expect, beforeAll } from 'vitest'
import { applyD1Schema } from '../src/d1/schema'
import { flushGameCreate, flushGameEnd, type GameArchiveRow } from '../src/do/archive'

const DB = () => (env as unknown as { DB: D1Database }).DB
beforeAll(async () => { await applyD1Schema(DB()) })

async function seedGame(code: string, status: string, uuid: string, activity = 1000) {
  const game: GameArchiveRow = {
    gameUuid: uuid, mode: 'online', status, playerCount: 2,
    source: 'online_authoritative', engineVersion: 'e', createdAt: activity, lastActivityAt: activity, code,
  }
  await flushGameCreate(DB(), game, [])
}

it('GET /games/resolve?code= returns the gameId for a waiting room', async () => {
  const code = `R${crypto.randomUUID().slice(0, 5).toUpperCase()}`
  const uuid = `res-${crypto.randomUUID()}`
  await seedGame(code, 'waiting', uuid)
  const res = await SELF.fetch(`https://example.com/games/resolve?code=${code}`)
  expect(res.status).toBe(200)
  expect(((await res.json()) as any).gameId).toBe(uuid)
})

it('GET /games/resolve resolves an active game and 404s a terminal one', async () => {
  const code = `R${crypto.randomUUID().slice(0, 5).toUpperCase()}`
  const uuid = `res-${crypto.randomUUID()}`
  await seedGame(code, 'active', uuid)
  expect(((await (await SELF.fetch(`https://example.com/games/resolve?code=${code}`)).json()) as any).gameId).toBe(uuid)

  await flushGameEnd(DB(), uuid, {
    status: 'completed', outcome: 'completed', winnerSeat: 0, endedAt: 2000, lastActivityAt: 2000, finalScores: [5, 1],
  })
  expect((await SELF.fetch(`https://example.com/games/resolve?code=${code}`)).status).toBe(404)
})

it('GET /games/resolve 404s an unknown code and 400s a missing code', async () => {
  expect((await SELF.fetch(`https://example.com/games/resolve?code=NOPEXX`)).status).toBe(404)
  expect((await SELF.fetch(`https://example.com/games/resolve`)).status).toBe(400)
})

it('GET /games/resolve is case-insensitive on the code', async () => {
  const code = `RCASE${crypto.randomUUID().slice(0, 2).toUpperCase()}`
  const uuid = `res-${crypto.randomUUID()}`
  await seedGame(code, 'waiting', uuid)
  const res = await SELF.fetch(`https://example.com/games/resolve?code=${code.toLowerCase()}`)
  expect(((await res.json()) as any).gameId).toBe(uuid)
})

it('GET /games/resolve picks the most-recently-active game when a code repeats', async () => {
  const code = `R${crypto.randomUUID().slice(0, 5).toUpperCase()}`
  const older = `res-old-${crypto.randomUUID()}`
  const newer = `res-new-${crypto.randomUUID()}`
  await seedGame(code, 'active', older, 1000)
  await seedGame(code, 'active', newer, 5000)
  expect(((await (await SELF.fetch(`https://example.com/games/resolve?code=${code}`)).json()) as any).gameId).toBe(newer)
})
