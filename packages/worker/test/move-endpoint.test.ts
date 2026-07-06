import { SELF } from 'cloudflare:test'
import { it, expect, describe } from 'vitest'
import type { Card } from '@viota/engine'
import { authHeaders, mintToken } from './helpers'

async function createGame(): Promise<string> {
  const seatOwners = [
    { ownerType: 'human' as const, accountId: 'acct-0', displayName: 'P0' },
    { ownerType: 'human' as const, accountId: 'acct-1', displayName: 'P1' },
  ]
  const res = await SELF.fetch('https://example.com/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerCount: 2, seatOwners }),
  })
  return ((await res.json()) as { gameId: string }).gameId
}

/** Read a seat's own hand by authing as that seat's owner (acct-<seat>). */
async function myHand(gameId: string, seat: number): Promise<Card[]> {
  const res = await SELF.fetch(`https://example.com/games/${gameId}/sync?since=0`, {
    headers: await authHeaders(`acct-${seat}`),
  })
  const body = (await res.json()) as { snapshot: { myHand: Card[] } }
  return body.snapshot.myHand
}

/** POST /move authed as `acct-<seat>` unless an explicit account is given. */
async function postMove(gameId: string, body: unknown, account?: string): Promise<Response> {
  const accountId = account ?? `acct-${(body as { seatIndex: number }).seatIndex}`
  return SELF.fetch(`https://example.com/games/${gameId}/move`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders(accountId)) },
    body: JSON.stringify(body),
  })
}

// The very first move is always legal: any single card adjacent to the starter
// (0,0) forms a 2-card line, which is always valid. accountId is JWT-derived now.
async function firstMoveBody(gameId: string, seat: number, pos: { x: number; y: number }, clientMoveId: string) {
  const hand = await myHand(gameId, seat)
  return {
    seatIndex: seat,
    move: { type: 'play', placements: [{ card: hand[0], position: pos }] },
    clientMoveId,
  }
}

const uuid = () => crypto.randomUUID()

describe('POST /games/:id/move', () => {
  it('applies a legal move exactly once and echoes a server-derived, redacted result', async () => {
    const gameId = await createGame()
    const res = await postMove(gameId, await firstMoveBody(gameId, 0, { x: 1, y: 0 }, uuid()))
    expect(res.status).toBe(200)
    const text = await res.text()
    const body = JSON.parse(text)

    expect(body.ok).toBe(true)
    expect(body.moveIndex).toBe(1) // server-derived
    // echo is per-seat redacted, never a raw snapshot
    expect(body.view.mySeat).toBe(0)
    expect(Array.isArray(body.view.myHand)).toBe(true)
    expect(body.view.handCounts).toEqual([4, 4])
    expect('drawPile' in body.view).toBe(false)
    expect(text).not.toContain('"drawPile":[')

    // /sync now reports moveIndex 1 with one move in the log
    const sync = await (await SELF.fetch(`https://example.com/games/${gameId}/sync?since=0`, {
      headers: await authHeaders('acct-1'),
    })).json() as any
    expect(sync.moveIndex).toBe(1)
    expect(sync.moves.length).toBe(1)
    expect(sync.moves[0].type).toBe('play')
  })

  it('requires a bearer token: an unauthenticated move is 401', async () => {
    const gameId = await createGame()
    const b = await firstMoveBody(gameId, 0, { x: 1, y: 0 }, uuid())
    const res = await SELF.fetch(`https://example.com/games/${gameId}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' }, // no Authorization
      body: JSON.stringify(b),
    })
    expect(res.status).toBe(401)
  })

  it('is idempotent: replaying the same clientMoveId is a benign 200 ack, not a second row', async () => {
    const gameId = await createGame()
    const cm = uuid()
    const b = await firstMoveBody(gameId, 0, { x: 1, y: 0 }, cm)

    const first = await postMove(gameId, b)
    expect(first.status).toBe(200)
    expect((await first.json()).moveIndex).toBe(1)

    // Same clientMoveId (it is now seat 1's turn) -> benign duplicate, NOT a
    // false not-your-turn, and no second row.
    const second = await postMove(gameId, b)
    expect(second.status).toBe(200)
    const sbody = await second.json()
    expect(sbody.duplicate).toBe(true)

    const sync = await (await SELF.fetch(`https://example.com/games/${gameId}/sync?since=0`, {
      headers: await authHeaders('acct-0'),
    })).json() as any
    expect(sync.moveIndex).toBe(1)
    expect(sync.moves.length).toBe(1)
  })

  it('derives the next move_index across two seats', async () => {
    const gameId = await createGame()
    const r1 = await postMove(gameId, await firstMoveBody(gameId, 0, { x: 1, y: 0 }, uuid()))
    expect((await r1.json()).moveIndex).toBe(1)
    // seat 1 plays adjacent to the starter on the column axis (always a valid 2-line)
    const r2 = await postMove(gameId, await firstMoveBody(gameId, 1, { x: 0, y: 1 }, uuid()))
    expect(r2.status).toBe(200)
    expect((await r2.json()).moveIndex).toBe(2)
  })

  it('rejects a move whose token account does not own the seat (403)', async () => {
    const gameId = await createGame()
    const b = await firstMoveBody(gameId, 0, { x: 1, y: 0 }, uuid())
    // A valid token for an account that owns no seat here.
    const res = await SELF.fetch(`https://example.com/games/${gameId}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${await mintToken('acct-imposter')}` },
      body: JSON.stringify(b),
    })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('not_your_seat')
  })

  it('rejects a token that owns a DIFFERENT seat trying to move seat 0 (403)', async () => {
    const gameId = await createGame()
    // seat 0's move body, but authed as acct-1 (owner of seat 1).
    const b = await firstMoveBody(gameId, 0, { x: 1, y: 0 }, uuid())
    const res = await postMove(gameId, b, 'acct-1')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('not_your_seat')
  })

  it('rejects an out-of-turn move (409 not_your_turn)', async () => {
    const gameId = await createGame()
    // seat 1 (authed as its owner acct-1) moves while it is seat 0's turn
    const b = await firstMoveBody(gameId, 1, { x: 0, y: 1 }, uuid())
    const res = await postMove(gameId, b)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('not_your_turn')
  })

  it('bounds-validates seatIndex, clientMoveId, and the move payload shape (400)', async () => {
    const gameId = await createGame()
    const hand = await myHand(gameId, 0)
    const good = { type: 'play', placements: [{ card: hand[0], position: { x: 1, y: 0 } }] }

    // out-of-range seat
    expect((await postMove(gameId, { seatIndex: 5, move: good, clientMoveId: uuid() }, 'acct-0')).status).toBe(400)
    // non-uuid clientMoveId
    expect((await postMove(gameId, { seatIndex: 0, move: good, clientMoveId: 'not-a-uuid' }, 'acct-0')).status).toBe(400)
    // malformed payload (5 placements)
    const five = Array.from({ length: 5 }, (_, i) => ({ card: hand[0], position: { x: i, y: 3 } }))
    expect((await postMove(gameId, { seatIndex: 0, move: { type: 'play', placements: five }, clientMoveId: uuid() }, 'acct-0')).status).toBe(400)
    // null clientMoveId is allowed (bounds-valid); this one should succeed
    expect((await postMove(gameId, { seatIndex: 0, move: good, clientMoveId: null }, 'acct-0')).status).toBe(200)
  })

  it('commit-then-broadcast: a connected socket receives the nudge only after the move commits', async () => {
    const gameId = await createGame()
    const upgrade = await SELF.fetch(`https://example.com/games/${gameId}/socket`, { headers: { Upgrade: 'websocket' } })
    const ws = upgrade.webSocket!
    ws.accept()

    const messages: any[] = []
    const waiters: ((v: any) => void)[] = []
    ws.addEventListener('message', (e) => {
      const v = JSON.parse(String((e as MessageEvent).data))
      const w = waiters.shift()
      if (w) w(v)
      else messages.push(v)
    })
    const next = () => new Promise<any>((resolve) => {
      const q = messages.shift()
      if (q !== undefined) resolve(q)
      else waiters.push(resolve)
    })

    // WS first-frame auth: a valid token whose account owns seat 0.
    ws.send(JSON.stringify({ type: 'auth', token: await mintToken('acct-0') }))
    expect((await next()).type).toBe('auth_ok')

    const nudgePromise = next()
    const res = await postMove(gameId, await firstMoveBody(gameId, 0, { x: 1, y: 0 }, uuid()))
    expect((await res.json()).moveIndex).toBe(1)

    const nudge = await nudgePromise
    expect(nudge).toEqual({ type: 'nudge', moveIndex: 1 })

    ws.close(1000, 'done')
  })
})
