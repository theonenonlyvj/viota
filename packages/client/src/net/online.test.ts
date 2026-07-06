import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createOnlineClient } from './online'
import { listQueued } from './outbox'
import type { ClientView, MovePayload } from './protocol'

const view: ClientView = {
  grid: [],
  mySeat: 0,
  myHand: [],
  handCounts: [4, 4],
  drawPileCount: 50,
  scores: [0, 0],
  turnIndex: 0,
  playedCards: [],
  consecutivePasses: 0,
  finished: false,
}

const move: MovePayload = { type: 'pass', trades: [], tradeOrder: [] }

function okJson(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  localStorage.setItem('viota_token', 'jwt-1')
})
afterEach(() => {
  vi.unstubAllGlobals()
})

test('postMove enqueues, POSTs with seatIndex, and marks done on success', async () => {
  const fetchMock = vi.fn().mockResolvedValue(okJson({ ok: true, moveIndex: 7, view }))
  vi.stubGlobal('fetch', fetchMock)

  const client = createOnlineClient('http://sv', 'g1', 0)
  const res = await client.postMove(move, 'mv-1')

  expect(res).toEqual({ status: 'ok', moveIndex: 7, view })
  const [url, init] = fetchMock.mock.calls[0]!
  expect(url).toBe('http://sv/games/g1/move')
  const body = JSON.parse((init as RequestInit).body as string)
  expect(body).toEqual({ seatIndex: 0, move, clientMoveId: 'mv-1' })
  expect((init as RequestInit).headers).toBeDefined()
  // no longer queued
  expect(await listQueued('g1')).toHaveLength(0)
})

test('a network-failed postMove stays queued', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

  const client = createOnlineClient('http://sv', 'g1', 0)
  const res = await client.postMove(move, 'mv-2')

  expect(res).toEqual({ status: 'queued' })
  const q = await listQueued('g1')
  expect(q.map((e) => e.clientMoveId)).toEqual(['mv-2'])
})

test('drainOutbox replays queued moves idempotently and clears them', async () => {
  // First: two moves fail (offline) and stay queued.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  const client = createOnlineClient('http://sv', 'g1', 0)
  await client.postMove(move, 'mv-a')
  await client.postMove(move, 'mv-b')
  expect((await listQueued('g1')).length).toBe(2)

  // Now online: drain POSTs each once, server dedupes, both are marked done.
  const fetchMock = vi.fn().mockResolvedValue(okJson({ ok: true, moveIndex: 1, view }))
  vi.stubGlobal('fetch', fetchMock)
  await client.drainOutbox()

  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(await listQueued('g1')).toHaveLength(0)

  // A second drain sends nothing (idempotent).
  fetchMock.mockClear()
  await client.drainOutbox()
  expect(fetchMock).not.toHaveBeenCalled()
})

test('a permanent 4xx move error resolves (not left queued)', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ error: 'not_your_turn' }, 409)))
  const client = createOnlineClient('http://sv', 'g1', 0)
  const res = await client.postMove(move, 'mv-x')
  expect(res).toEqual({ status: 'error', http: 409, error: 'not_your_turn' })
  expect(await listQueued('g1')).toHaveLength(0)
})

test.each([500, 502, 503, 429, 408])(
  'a transient %i response leaves the move queued (retried later, not marked done)',
  async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ error: 'transient' }, status)))
    const client = createOnlineClient('http://sv', 'g1', 0)
    const res = await client.postMove(move, `mv-${status}`)
    expect(res).toEqual({ status: 'queued' })
    // still in the outbox so the next reconcile replays it with the SAME id
    expect((await listQueued('g1')).map((e) => e.clientMoveId)).toEqual([`mv-${status}`])
  },
)

test('drainOutbox leaves a move queued on a transient 5xx (does not mark done)', async () => {
  // Enqueue offline first so there is a queued move to drain.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  const client = createOnlineClient('http://sv', 'g1', 0)
  await client.postMove(move, 'mv-drain')
  expect((await listQueued('g1')).length).toBe(1)

  // The server is briefly overloaded → 503: the move must NOT be marked done.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ error: 'overloaded' }, 503)))
  await client.drainOutbox()
  expect((await listQueued('g1')).map((e) => e.clientMoveId)).toEqual(['mv-drain'])
})

test('sync GETs with the since cursor and Bearer token', async () => {
  const fetchMock = vi.fn().mockResolvedValue(okJson({ moveIndex: 3, snapshot: view, moves: [] }))
  vi.stubGlobal('fetch', fetchMock)
  const client = createOnlineClient('http://sv', 'g1', 0)
  const res = await client.sync(3)
  expect(res.moveIndex).toBe(3)
  const [url, init] = fetchMock.mock.calls[0]!
  expect(url).toBe('http://sv/games/g1/sync?since=3')
  const headers = new Headers((init as RequestInit).headers)
  expect(headers.get('Authorization')).toBe('Bearer jwt-1')
})

test('a 401 triggers a silent re-auth then retries the request', async () => {
  const fetchMock = vi
    .fn()
    // 1: original sync → 401
    .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
    // 2: /auth/quick re-auth → new token
    .mockResolvedValueOnce(okJson({ token: 'jwt-2', accountId: 'acc-1' }))
    // 3: retried sync with the new token → ok
    .mockResolvedValueOnce(okJson({ moveIndex: 5, snapshot: view, moves: [] }))
  vi.stubGlobal('fetch', fetchMock)

  const client = createOnlineClient('http://sv', 'g1', 0)
  const res = await client.sync(0)

  expect(res.moveIndex).toBe(5)
  expect(fetchMock).toHaveBeenCalledTimes(3)
  expect(fetchMock.mock.calls[1]![0]).toBe('http://sv/auth/quick')
  // the retry carried the refreshed token
  const retryHeaders = new Headers((fetchMock.mock.calls[2]![1] as RequestInit).headers)
  expect(retryHeaders.get('Authorization')).toBe('Bearer jwt-2')
})

test('reclaim returns null on a non-ok response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }))
  const client = createOnlineClient('http://sv', 'g1', 0)
  expect(await client.reclaim()).toBeNull()
})

test('veto maps a 409 to { vetoable:false }', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ vetoable: false }) }))
  const client = createOnlineClient('http://sv', 'g1', 0)
  expect(await client.veto()).toEqual({ vetoable: false })
})
