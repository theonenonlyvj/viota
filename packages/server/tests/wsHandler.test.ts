import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'http'
import { WebSocket } from 'ws'
import { createDb } from '../src/db'
import { createApp } from '../src/app'
import { setupWs } from '../src/wsHandler'
import { signGuestToken } from '../src/auth'
import { addPlayer, createRoom, setRoomStatus } from '../src/rooms'
import { saveState } from '../src/gameState'
import { initGame } from '../src/gameLoop'
import type { Db } from '../src/db'
import type { GameState } from '@viota/engine'

const SECRET = 'test-ws-secret'
let db: Db
let server: http.Server
let port: number

function wsUrl(roomCode: string, token: string) {
  return `ws://localhost:${port}/rooms/${roomCode}?token=${encodeURIComponent(token)}`
}

function wsMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    ws.once('message', data => resolve(JSON.parse(data.toString())))
    ws.once('error', reject)
  })
}

function wsClose(ws: WebSocket): Promise<void> {
  return new Promise(resolve => ws.once('close', resolve))
}

beforeAll(async () => {
  db = createDb(':memory:')
  const app = createApp(db, SECRET)
  server = http.createServer(app)
  setupWs(server, db, SECRET)
  await new Promise<void>(resolve => server.listen(0, resolve))
  port = (server.address() as { port: number }).port
})

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
  db.close()
})

describe('WS connection', () => {
  it('rejects connection with no token', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/rooms/ABC123`)
    await wsClose(ws)
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })

  it('rejects connection with invalid token', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/rooms/ABC123?token=bad.token`)
    await wsClose(ws)
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })

  it('accepts connection with valid token and sends welcome', async () => {
    const code = createRoom(db)
    const result = addPlayer(db, code, 'Alice')!
    const token = signGuestToken(
      { roomCode: code, playerIndex: result.playerIndex, playerName: 'Alice', guestSecret: result.guestSecret },
      SECRET
    )
    const ws = new WebSocket(wsUrl(code, token))
    const msg = await wsMessage(ws)
    expect(msg.type).toBe('welcome')
    expect(msg.playerIndex).toBe(0)
    ws.close()
    await wsClose(ws)
  })
})

describe('startGame', () => {
  it('starts game when host sends startGame with 2+ players', async () => {
    const code = createRoom(db)
    const r1 = addPlayer(db, code, 'Host')!
    const r2 = addPlayer(db, code, 'Guest')!
    const t1 = signGuestToken({ roomCode: code, playerIndex: r1.playerIndex, playerName: 'Host', guestSecret: r1.guestSecret }, SECRET)
    const t2 = signGuestToken({ roomCode: code, playerIndex: r2.playerIndex, playerName: 'Guest', guestSecret: r2.guestSecret }, SECRET)

    const ws1 = new WebSocket(wsUrl(code, t1))
    await wsMessage(ws1) // welcome

    const ws2 = new WebSocket(wsUrl(code, t2))
    await wsMessage(ws2) // welcome
    await wsMessage(ws1) // playerJoined notification for Guest

    // Host starts game
    ws1.send(JSON.stringify({ type: 'startGame' }))

    const msg1 = await wsMessage(ws1)
    expect(msg1.type).toBe('gameStarted')
    expect(msg1.view).toBeDefined()
    expect(msg1.view.myHand).toHaveLength(4)

    ws1.close()
    ws2.close()
    await Promise.all([wsClose(ws1), wsClose(ws2)])
  })
})

describe('play move', () => {
  it('validates and broadcasts state on valid play', async () => {
    const code = createRoom(db)
    const r1 = addPlayer(db, code, 'Player1')!
    const t1 = signGuestToken({ roomCode: code, playerIndex: 0, playerName: 'Player1', guestSecret: r1.guestSecret }, SECRET)

    // Set up a known game state where player 0 can make a valid move
    const hand0 = [
      { kind: 'regular' as const, color: 'blue' as const, shape: 'circle' as const, number: 2 as const },
      { kind: 'regular' as const, color: 'green' as const, shape: 'circle' as const, number: 3 as const },
      { kind: 'regular' as const, color: 'yellow' as const, shape: 'circle' as const, number: 4 as const },
      { kind: 'regular' as const, color: 'red' as const, shape: 'triangle' as const, number: 1 as const },
    ]
    const knownState = {
      grid: new Map([['0,0', { kind: 'regular' as const, color: 'red' as const, shape: 'circle' as const, number: 1 as const }]]),
      hands: [hand0],
      drawPile: [{ kind: 'regular' as const, color: 'red' as const, shape: 'plus' as const, number: 1 as const }],
      scores: [0],
      turnIndex: 0,
      playedCards: [],
    }
    setRoomStatus(db, code, 'playing')
    saveState(db, code, knownState)

    const ws1 = new WebSocket(wsUrl(code, t1))
    await wsMessage(ws1) // welcome

    ws1.send(JSON.stringify({
      type: 'play',
      placements: [{ card: hand0[0], position: { x: 1, y: 0 } }],
    }))

    const msg = await wsMessage(ws1)
    expect(msg.type).toBe('state')
    expect(msg.view).toBeDefined()

    ws1.close()
    await wsClose(ws1)
  })

  it('returns error on invalid play (out of turn)', async () => {
    const code = createRoom(db)
    const r1 = addPlayer(db, code, 'P1')!
    const r2 = addPlayer(db, code, 'P2')!
    const t2 = signGuestToken({ roomCode: code, playerIndex: 1, playerName: 'P2', guestSecret: r2.guestSecret }, SECRET)
    void r1 // suppress unused warning

    // Game started, it's P1's turn (index 0)
    const gameState = initGame(2)
    setRoomStatus(db, code, 'playing')
    saveState(db, code, gameState)

    const ws2 = new WebSocket(wsUrl(code, t2))
    await wsMessage(ws2) // welcome

    const someCard = gameState.hands[1]![0]!
    ws2.send(JSON.stringify({
      type: 'play',
      placements: [{ card: someCard, position: { x: 1, y: 0 } }],
    }))

    const msg = await wsMessage(ws2)
    expect(msg.type).toBe('error')

    ws2.close()
    await wsClose(ws2)
  })
})
