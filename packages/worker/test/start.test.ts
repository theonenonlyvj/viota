import { SELF, env, runInDurableObject } from 'cloudflare:test'
import { it, expect, beforeAll } from 'vitest'
import { authHeaders, mintToken } from './helpers'
import { applyD1Schema } from '../src/d1/schema'
import { runMigrations, GameRepository } from '../src/do/storage'
import { createWaitingRoom } from '../src/do/init'
import { buildWaitingRoomView } from '../src/do/view'

const DB = () => (env as unknown as { DB: D1Database }).DB
function stubFor(name: string) { return env.GAME_DO.get(env.GAME_DO.idFromName(name)) }
beforeAll(async () => { await applyD1Schema(DB()) })

async function seedRoom(gameId: string, playerCount: number, opts: { humans?: number[]; code?: string } = {}) {
  const humans = opts.humans ?? [0]
  const code = opts.code ?? 'ROOMST'
  await runInDurableObject(stubFor(gameId), (_i, state: any) => {
    const sql = state.storage.sql
    runMigrations(sql)
    const repo = new GameRepository(sql)
    createWaitingRoom(repo, {
      playerCount, hostAccountId: 'host', hostDisplayName: 'Host',
      gameUuid: gameId, engineVersion: 'e', code,
    })
    for (const seat of humans) {
      if (seat === 0) continue
      const s = repo.getSeats()[seat]!
      repo.putSeat({ ...s, owner_type: 'human', owner_account_id: `human-${seat}`, display_name: `H${seat}` })
    }
  })
  // Register the D1 waiting-room registry row so the status flip is observable.
  await runInDurableObject(stubFor(gameId), (i: any) => i.archiveGameCreate(Date.now(), code))
}

async function start(gameId: string, accountId: string) {
  return SELF.fetch(`https://example.com/games/${gameId}/start`, { method: 'POST', headers: await authHeaders(accountId) })
}

it('POST /start deals a 2-human room, returns the redacted view, fills AI, flips D1 active', async () => {
  const gameId = crypto.randomUUID()
  await seedRoom(gameId, 4, { humans: [0, 1], code: 'START1' }) // 4 seats: 2 human, 2 open

  const res = await start(gameId, 'host')
  expect(res.status).toBe(200)
  const b = (await res.json()) as any
  expect(b.moveIndex).toBe(0)
  expect(b.snapshot.mySeat).toBe(0)
  expect(b.snapshot.myHand.length).toBe(4)
  expect(b.snapshot.handCounts.length).toBe(4)
  // No leaked deal secrets.
  expect('drawPile' in b.snapshot).toBe(false)
  expect('hands' in b.snapshot).toBe(false)

  const inspected = await runInDurableObject(stubFor(gameId), (_i, state: any) => {
    const repo = new GameRepository(state.storage.sql)
    return {
      status: repo.getMeta()!.status,
      seats: repo.getSeats().map((s) => ({ i: s.seat_index, t: s.owner_type, ai: s.controlled_by_ai })),
      hasSnapshot: repo.getSnapshot() != null,
    }
  })
  expect(inspected.status).toBe('active')
  expect(inspected.hasSnapshot).toBe(true)
  expect(inspected.seats[0]).toMatchObject({ t: 'human' })
  expect(inspected.seats[1]).toMatchObject({ t: 'human' })
  expect(inspected.seats[2]).toMatchObject({ t: 'ai', ai: true })
  expect(inspected.seats[3]).toMatchObject({ t: 'ai', ai: true })

  // Force the (idempotent) registry sync deterministically, then assert the flip.
  await runInDurableObject(stubFor(gameId), (i: any) => i.archiveGameStart(Date.now()))
  const row = await DB().prepare('SELECT status FROM games WHERE game_uuid = ?').bind(gameId).first<any>()
  expect(row.status).toBe('active')
})

it('only the HOST can start: a non-host seated joiner gets 403 not_host', async () => {
  const gameId = crypto.randomUUID()
  await seedRoom(gameId, 3, { humans: [0, 1] })
  const res = await start(gameId, 'human-1') // a joiner (seat 1, not host) tries to start
  expect(res.status).toBe(403)
  expect(((await res.json()) as any).error).toBe('not_host')
  // the host (seat 0) can still start it
  expect((await start(gameId, 'host')).status).toBe(200)
})

it('the waiting-room view exposes hostSeat + the open-seat count', async () => {
  const gameId = crypto.randomUUID()
  await seedRoom(gameId, 4, { humans: [0, 1] }) // 2 human, 2 open
  const room = await runInDurableObject(stubFor(gameId), (_i, state: any) =>
    buildWaitingRoomView(new GameRepository(state.storage.sql)),
  )
  expect(room.hostSeat).toBe(0)
  expect(room.openSeats).toBe(2)
})

it('host promotion: when the host leaves the waiting room, host_seat moves to the next present human + host_changed broadcast', async () => {
  const gameId = crypto.randomUUID()
  await seedRoom(gameId, 3, { humans: [0, 1] })
  // seat 1 (human-1) heartbeats so it counts as a PRESENT human successor.
  await SELF.fetch(`https://example.com/games/${gameId}/heartbeat`, {
    method: 'POST',
    headers: await authHeaders('human-1'),
  })

  // Open a socket authed as seat 1 to observe the host_changed broadcast.
  const up = await SELF.fetch(`https://example.com/games/${gameId}/socket`, { headers: { Upgrade: 'websocket' } })
  const ws = up.webSocket!
  ws.accept()
  const frames: any[] = []
  const waiters: ((v: any) => void)[] = []
  ws.addEventListener('message', (e) => {
    const v = JSON.parse(String((e as MessageEvent).data))
    const w = waiters.shift()
    if (w) w(v)
    else frames.push(v)
  })
  const next = () => new Promise<any>((r) => { const q = frames.shift(); if (q !== undefined) r(q); else waiters.push(r) })
  ws.send(JSON.stringify({ type: 'auth', token: await mintToken('human-1') }))
  expect((await next()).type).toBe('auth_ok')

  // The host (seat 0) leaves.
  const res = await SELF.fetch(`https://example.com/games/${gameId}/leave`, {
    method: 'POST',
    headers: await authHeaders('host'),
  })
  expect(res.status).toBe(200)

  // The leave broadcasts an ai_cover toast (covered host seat) AND host_changed;
  // find the host_changed frame among them.
  let hc: any = null
  for (let i = 0; i < 3 && !hc; i++) {
    const f = await next()
    if (f.type === 'host_changed') hc = f
  }
  expect(hc).toEqual({ type: 'host_changed', hostSeat: 1 })

  // host_seat is now seat 1, and seat 1 (human-1) can start.
  const hostSeat = await runInDurableObject(stubFor(gameId), (_i, state: any) =>
    new GameRepository(state.storage.sql).getMeta()!.host_seat,
  )
  expect(hostSeat).toBe(1)
  expect((await start(gameId, 'human-1')).status).toBe(200)
  ws.close(1000, 'done')
})

it('host promotion: a joined human with NO lobby heartbeat is STILL promoted (lobbies never heartbeat)', async () => {
  const gameId = crypto.randomUUID()
  // Seat 1 is a real joined human but never heartbeated — the WaitingRoom client
  // only polls GET /sync, so NO lobby seat is ever "present". Promotion must not
  // require presence here, or every host-leave would strand the room (the joiners
  // could never obtain Start).
  await seedRoom(gameId, 3, { humans: [0, 1] })
  await SELF.fetch(`https://example.com/games/${gameId}/leave`, {
    method: 'POST',
    headers: await authHeaders('host'),
  })
  const hostSeat = await runInDurableObject(stubFor(gameId), (_i, state: any) =>
    new GameRepository(state.storage.sql).getMeta()!.host_seat,
  )
  expect(hostSeat).toBe(1) // promoted to the joined human despite no heartbeat
})

it('POST /start 409s with fewer than 2 humans', async () => {
  const gameId = crypto.randomUUID()
  await seedRoom(gameId, 3, { humans: [0] }) // only the host
  const res = await start(gameId, 'host')
  expect(res.status).toBe(409)
})

it('POST /start 403s for a non-seated account', async () => {
  const gameId = crypto.randomUUID()
  await seedRoom(gameId, 3, { humans: [0, 1] })
  const res = await start(gameId, 'stranger')
  expect(res.status).toBe(403)
})

it('POST /start 409s when the game already started (not waiting)', async () => {
  const gameId = crypto.randomUUID()
  await seedRoom(gameId, 3, { humans: [0, 1] })
  await start(gameId, 'host')
  const again = await start(gameId, 'host')
  expect(again.status).toBe(409)
})

it('POST /start requires auth', async () => {
  const gameId = crypto.randomUUID()
  await seedRoom(gameId, 3, { humans: [0, 1] })
  const res = await SELF.fetch(`https://example.com/games/${gameId}/start`, { method: 'POST' })
  expect(res.status).toBe(401)
})
