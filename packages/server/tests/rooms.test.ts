import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { createDb } from '../src/db'
import { createApp } from '../src/app'
import { createRoom, getRoomByCode } from '../src/rooms'
import type { Db } from '../src/db'

const SECRET = 'test-secret'
let db: Db
let app: ReturnType<typeof createApp>

beforeEach(() => {
  db = createDb(':memory:')
  app = createApp(db, SECRET)
})

afterEach(() => { db.close() })

describe('POST /rooms', () => {
  it('returns 201 with a 6-char code', async () => {
    const res = await request(app).post('/rooms').expect(201)
    expect(res.body.code).toMatch(/^[A-Z0-9]{6}$/)
  })

  it('returns a different code on each call', async () => {
    const r1 = await request(app).post('/rooms').expect(201)
    const r2 = await request(app).post('/rooms').expect(201)
    expect(r1.body.code).not.toBe(r2.body.code)
  })
})

describe('createRoom disconnect_timeout', () => {
  it('createRoom accepts custom disconnectTimeout', () => {
    const code = createRoom(db, { disconnectTimeout: 60 })
    const room = getRoomByCode(db, code)
    expect(room).not.toBeNull()
    expect(room!.disconnect_timeout).toBe(60)
  })

  it('createRoom defaults disconnectTimeout to 120', () => {
    const code = createRoom(db)
    const room = getRoomByCode(db, code)
    expect(room!.disconnect_timeout).toBe(120)
  })
})

describe('POST /rooms/:code/join', () => {
  it('adds a guest player and returns a JWT + playerIndex 0', async () => {
    const { body: { code } } = await request(app).post('/rooms').expect(201)
    const res = await request(app)
      .post(`/rooms/${code}/join`)
      .send({ name: 'Alice' })
      .expect(200)
    expect(typeof res.body.token).toBe('string')
    expect(res.body.playerIndex).toBe(0)
  })

  it('assigns sequential playerIndex to each joiner', async () => {
    const { body: { code } } = await request(app).post('/rooms').expect(201)
    const r1 = await request(app).post(`/rooms/${code}/join`).send({ name: 'Alice' }).expect(200)
    const r2 = await request(app).post(`/rooms/${code}/join`).send({ name: 'Bob' }).expect(200)
    expect(r1.body.playerIndex).toBe(0)
    expect(r2.body.playerIndex).toBe(1)
  })

  it('returns 404 for unknown room', async () => {
    await request(app).post('/rooms/XXXXXX/join').send({ name: 'Alice' }).expect(404)
  })

  it('returns 400 if name is missing', async () => {
    const { body: { code } } = await request(app).post('/rooms').expect(201)
    await request(app).post(`/rooms/${code}/join`).send({}).expect(400)
  })

  it('returns 409 if name already taken', async () => {
    const { body: { code } } = await request(app).post('/rooms').expect(201)
    await request(app).post(`/rooms/${code}/join`).send({ name: 'Alice' }).expect(200)
    await request(app).post(`/rooms/${code}/join`).send({ name: 'Alice' }).expect(409)
  })

  it('returns 409 if room already has 4 players', async () => {
    const { body: { code } } = await request(app).post('/rooms').expect(201)
    for (const name of ['A', 'B', 'C', 'D']) {
      await request(app).post(`/rooms/${code}/join`).send({ name }).expect(200)
    }
    await request(app).post(`/rooms/${code}/join`).send({ name: 'E' }).expect(409)
  })
})
