import express, { type Request, type Response } from 'express'
import type { Db } from './db'
import { createRoom, getRoomByCode, addPlayer, getPlayers } from './rooms'
import { signGuestToken, signAccountToken, hashPassword, comparePassword, verifyToken } from './auth'

export function createApp(db: Db, jwtSecret: string) {
  const app = express()
  app.use(express.json())

  // POST /rooms — create a new room
  app.post('/rooms', (_req: Request, res: Response) => {
    const code = createRoom(db)
    res.status(201).json({ code })
  })

  // POST /rooms/:code/join — join as guest or re-join a disconnected slot
  app.post('/rooms/:code/join', (req: Request, res: Response) => {
    const { code } = req.params as { code: string }
    const { name } = req.body as { name?: string }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'name is required' })
      return
    }

    const trimmedName = name.trim()
    const room = getRoomByCode(db, code)

    if (!room) {
      res.status(404).json({ error: 'Room not found' })
      return
    }

    // Allow re-join for disconnected players within 30-minute window
    if (room.status !== 'waiting') {
      const existing = getPlayers(db, code).find(p => p.name === trimmedName)
      if (existing && existing.disconnected_at !== null) {
        const thirtyMin = 30 * 60 * 1000
        if (Date.now() - existing.disconnected_at <= thirtyMin) {
          const token = signGuestToken(
            { roomCode: code, playerIndex: existing.player_index, playerName: trimmedName, guestSecret: existing.guest_secret! },
            jwtSecret
          )
          res.json({ token, playerIndex: existing.player_index })
          return
        }
      }
      res.status(409).json({ error: 'Room is not accepting new players' })
      return
    }

    const result = addPlayer(db, code, trimmedName)
    if (!result) {
      res.status(409).json({ error: 'Room is full or name is already taken' })
      return
    }

    const token = signGuestToken(
      { roomCode: code, playerIndex: result.playerIndex, playerName: trimmedName, guestSecret: result.guestSecret },
      jwtSecret
    )
    res.json({ token, playerIndex: result.playerIndex })
  })

  // POST /auth/register
  app.post('/auth/register', async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string }
    if (!email || !password) {
      res.status(400).json({ error: 'email and password required' })
      return
    }
    const hash = await hashPassword(password)
    try {
      const result = db.prepare(
        'INSERT INTO accounts (email, password_hash, created_at) VALUES (?, ?, ?)'
      ).run(email.toLowerCase(), hash, Date.now())
      const accountId = result.lastInsertRowid as number
      const token = signAccountToken({ accountId, email: email.toLowerCase() }, jwtSecret)
      res.status(201).json({ token })
    } catch {
      res.status(409).json({ error: 'Email already registered' })
    }
  })

  // POST /auth/login
  app.post('/auth/login', async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string }
    if (!email || !password) {
      res.status(400).json({ error: 'email and password required' })
      return
    }
    const account = db.prepare('SELECT * FROM accounts WHERE email = ?').get(email.toLowerCase()) as
      | { id: number; email: string; password_hash: string }
      | undefined
    if (!account || !(await comparePassword(password, account.password_hash))) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }
    const token = signAccountToken({ accountId: account.id, email: account.email }, jwtSecret)
    res.json({ token })
  })

  // GET /rooms/:code/state — HTTP polling fallback (requires valid JWT)
  app.get('/rooms/:code/state', (req: Request, res: Response) => {
    const { code } = req.params as { code: string }
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    const payload = verifyToken(authHeader.slice(7), jwtSecret)
    if (!payload) {
      res.status(401).json({ error: 'Invalid token' })
      return
    }
    const row = db.prepare('SELECT * FROM game_states WHERE room_code = ?').get(code) as
      | { grid_json: string; draw_pile_json: string; hands_json: string; scores_json: string; turn_index: number; played_cards_json: string }
      | undefined
    if (!row) {
      res.status(404).json({ error: 'Game not started' })
      return
    }
    res.json(row)
  })

  return app
}
