import { SELF, env, runInDurableObject } from 'cloudflare:test'
import { it, expect } from 'vitest'

async function createGame(playerCount = 2): Promise<string> {
  const seatOwners = Array.from({ length: playerCount }, (_, i) => ({
    ownerType: 'human' as const, accountId: `a${i}`, displayName: `P${i}`,
  }))
  const res = await SELF.fetch('https://example.com/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerCount, seatOwners }),
  })
  return ((await res.json()) as { gameId: string }).gameId
}

async function openSocket(gameId: string): Promise<WebSocket> {
  const res = await SELF.fetch(`https://example.com/games/${gameId}/socket`, {
    headers: { Upgrade: 'websocket' },
  })
  expect(res.status).toBe(101)
  const ws = res.webSocket!
  ws.accept()
  return ws
}

/** In-order message reader for a client WebSocket. */
function reader(ws: WebSocket) {
  const queue: string[] = []
  const waiters: ((v: string) => void)[] = []
  ws.addEventListener('message', (e) => {
    const data = String((e as MessageEvent).data)
    const w = waiters.shift()
    if (w) w(data)
    else queue.push(data)
  })
  return () =>
    new Promise<any>((resolve) => {
      const q = queue.shift()
      if (q !== undefined) resolve(JSON.parse(q))
      else waiters.push((v) => resolve(JSON.parse(v)))
    })
}

it('accepts a WS upgrade and handles frames via the hibernation methods', async () => {
  const gameId = await createGame()
  const ws = await openSocket(gameId)
  const next = reader(ws)

  // First-frame auth handshake (stub).
  ws.send(JSON.stringify({ type: 'auth', seatIndex: 0, accountId: 'a0' }))
  const authOk = await next()
  expect(authOk.type).toBe('auth_ok')
  expect(authOk.seat).toBe(0)

  // Post-auth app frame is handled by webSocketMessage (Phase 1: ack).
  ws.send(JSON.stringify({ type: 'hello' }))
  const ack = await next()
  expect(ack.type).toBe('ack')
  expect(ack.seat).toBe(0)

  ws.close(1000, 'done')
})

it('closes with 4001 when the first frame is not a valid auth frame', async () => {
  const gameId = await createGame()
  const ws = await openSocket(gameId)

  const closed = new Promise<CloseEvent>((resolve) =>
    ws.addEventListener('close', (e) => resolve(e as CloseEvent), { once: true }),
  )
  ws.send(JSON.stringify({ type: 'i-am-not-auth' }))
  const ev = await closed
  expect(ev.code).toBe(4001)
})

it('nudge fans out seat-agnostically via getWebSockets (news at index N, no hand data)', async () => {
  const gameId = await createGame()
  const ws = await openSocket(gameId)
  const next = reader(ws)
  ws.send(JSON.stringify({ type: 'auth', seatIndex: 1, accountId: 'a1' }))
  await next() // consume auth_ok

  const nudgeMsg = next()
  const stub = env.GAME_DO.get(env.GAME_DO.idFromName(gameId))
  const count = await runInDurableObject(stub, (i: any) => i.nudge(7))
  expect(count).toBeGreaterThanOrEqual(1)

  const nudge = await nudgeMsg
  expect(nudge).toEqual({ type: 'nudge', moveIndex: 7 })
  // Seat-agnostic: carries only the index, never hand/card data.
  const raw = JSON.stringify(nudge)
  expect(raw).not.toContain('hand')
  expect(raw).not.toContain('card')

  ws.close(1000, 'done')
})

it('DO reports the accepted socket via ctx.getWebSockets (no in-memory Map)', async () => {
  const gameId = await createGame()
  await openSocket(gameId)
  const stub = env.GAME_DO.get(env.GAME_DO.idFromName(gameId))
  const n = await runInDurableObject(stub, (_i: any, state: any) => state.getWebSockets().length)
  expect(n).toBeGreaterThanOrEqual(1)
})
