import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { createDb } from '../src/db'
import { createApp } from '../src/app'
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
  it('POST /rooms accepts custom disconnectTimeout', async () => {
    const res = await request(app).post('/rooms').send({ disconnectTimeout: 60 })
    expect(res.status).toBe(201)
    expect(res.body.code).toBeDefined()
  })
})

describe('POST /auth/register', () => {
  it('creates account and returns JWT', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'alice@example.com', password: 'secret123' })
      .expect(201)
    expect(typeof res.body.token).toBe('string')
  })

  it('returns 400 if email or password missing', async () => {
    await request(app).post('/auth/register').send({ email: 'a@b.com' }).expect(400)
    await request(app).post('/auth/register').send({ password: 'x' }).expect(400)
  })

  it('returns 409 on duplicate email', async () => {
    await request(app).post('/auth/register').send({ email: 'a@b.com', password: 'x' }).expect(201)
    await request(app).post('/auth/register').send({ email: 'a@b.com', password: 'y' }).expect(409)
  })

  it('normalizes email to lowercase', async () => {
    await request(app).post('/auth/register').send({ email: 'Alice@B.COM', password: 'x' }).expect(201)
    await request(app).post('/auth/login').send({ email: 'alice@b.com', password: 'x' }).expect(200)
  })
})

describe('POST /auth/login', () => {
  it('returns JWT for valid credentials', async () => {
    await request(app).post('/auth/register').send({ email: 'a@b.com', password: 'pass' }).expect(201)
    const res = await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'pass' }).expect(200)
    expect(typeof res.body.token).toBe('string')
  })

  it('returns 401 for wrong password', async () => {
    await request(app).post('/auth/register').send({ email: 'a@b.com', password: 'pass' })
    await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'wrong' }).expect(401)
  })

  it('returns 401 for unknown email', async () => {
    await request(app).post('/auth/login').send({ email: 'nobody@b.com', password: 'pass' }).expect(401)
  })
})
