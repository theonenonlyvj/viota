import { SELF } from 'cloudflare:test'
import { it, expect } from 'vitest'

async function createGame(playerCount = 2) {
  const seatOwners = Array.from({ length: playerCount }, (_, i) => ({
    ownerType: 'human' as const, accountId: `a${i}`, displayName: `P${i}`,
  }))
  const res = await SELF.fetch('https://example.com/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerCount, seatOwners }),
  })
  return res
}

it('POST /games creates a game and returns { gameId } with NO leaked state', async () => {
  const res = await createGame(2)
  expect(res.status).toBe(201)
  const text = await res.text()
  const body = JSON.parse(text)
  expect(typeof body.gameId).toBe('string')
  expect(body.gameId.length).toBeGreaterThan(0)
  // create response must not leak the deal
  expect(text).not.toContain('initial_state')
  expect(text).not.toContain('drawPile')
  expect(body.snapshot).toBeUndefined()
})

it('GET /sync returns own hand FULL, others + draw pile as COUNTS only', async () => {
  const { gameId } = await (await createGame(2)).json() as { gameId: string }

  const res = await SELF.fetch(`https://example.com/games/${gameId}/sync?since=0&seat=0`)
  expect(res.status).toBe(200)
  const text = await res.text()
  const body = JSON.parse(text)

  expect(body.moveIndex).toBe(0)
  expect(Array.isArray(body.moves)).toBe(true)
  expect(body.moves.length).toBe(0)

  const snap = body.snapshot
  // own hand is FULL (4 dealt cards)
  expect(Array.isArray(snap.myHand)).toBe(true)
  expect(snap.myHand.length).toBe(4)
  expect(snap.mySeat).toBe(0)
  // every seat as a COUNT
  expect(snap.handCounts).toEqual([4, 4])
  // draw pile as a COUNT only (2 players -> 57)
  expect(snap.drawPileCount).toBe(57)

  // HARD redaction guarantees:
  expect('drawPile' in snap).toBe(false) // never the ordered array
  expect('hands' in snap).toBe(false) // never other seats' cards
  expect('initial_state' in snap).toBe(false)
  expect('initialState' in snap).toBe(false)
  // the raw wire bytes contain no ordered drawPile array nor initial_state
  expect(text).not.toContain('"drawPile":[')
  expect(text).not.toContain('initial_state')
  expect(text).not.toContain('initialState')
})

it('each seat sees only its OWN hand', async () => {
  const { gameId } = await (await createGame(2)).json() as { gameId: string }

  const s0 = await (await SELF.fetch(`https://example.com/games/${gameId}/sync?since=0&seat=0`)).json() as any
  const s1 = await (await SELF.fetch(`https://example.com/games/${gameId}/sync?since=0&seat=1`)).json() as any

  expect(s0.snapshot.mySeat).toBe(0)
  expect(s1.snapshot.mySeat).toBe(1)
  // Same board, same counts, but the private hands differ by seat.
  expect(s0.snapshot.handCounts).toEqual([4, 4])
  expect(s1.snapshot.handCounts).toEqual([4, 4])
  expect(JSON.stringify(s0.snapshot.grid)).toBe(JSON.stringify(s1.snapshot.grid))
  // The two hands are (with overwhelming probability) different dealt cards;
  // regardless, seat 1 never receives seat 0's hand array and vice versa.
  expect('hands' in s0.snapshot).toBe(false)
  expect('hands' in s1.snapshot).toBe(false)
})

it('rejects an out-of-range or missing seat with 400', async () => {
  const { gameId } = await (await createGame(2)).json() as { gameId: string }
  expect((await SELF.fetch(`https://example.com/games/${gameId}/sync?since=0&seat=2`)).status).toBe(400)
  expect((await SELF.fetch(`https://example.com/games/${gameId}/sync?since=0&seat=-1`)).status).toBe(400)
  expect((await SELF.fetch(`https://example.com/games/${gameId}/sync?since=0`)).status).toBe(400)
})

it('rejects an invalid player count at create', async () => {
  const res = await SELF.fetch('https://example.com/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerCount: 5, seatOwners: [] }),
  })
  expect(res.status).toBe(400)
})
