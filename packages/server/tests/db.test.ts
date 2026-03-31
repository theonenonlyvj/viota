import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb } from '../src/db'

let db: ReturnType<typeof createDb>

beforeEach(() => {
  db = createDb(':memory:')
})

afterEach(() => {
  db.close()
})

describe('createDb', () => {
  it('creates accounts table', () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'").get()
    expect(row).toBeDefined()
  })

  it('creates rooms table', () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rooms'").get()
    expect(row).toBeDefined()
  })

  it('creates players table', () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='players'").get()
    expect(row).toBeDefined()
  })

  it('creates game_states table', () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='game_states'").get()
    expect(row).toBeDefined()
  })

  it('can insert and retrieve a room', () => {
    db.prepare(`INSERT INTO rooms (code, status, created_at) VALUES ('ABC123', 'waiting', ?)`).run(Date.now())
    const row = db.prepare(`SELECT * FROM rooms WHERE code='ABC123'`).get() as { code: string; status: string }
    expect(row.code).toBe('ABC123')
    expect(row.status).toBe('waiting')
  })
})
