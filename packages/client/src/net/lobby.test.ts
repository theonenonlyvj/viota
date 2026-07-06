import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createOnlineGame, createOnlineRoom, joinOnlineGame, fetchRoom, startRoom, leaveGame } from './lobby'

function okJson(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const waitingSeats = [
  { seatIndex: 0, ownerType: 'human', displayName: 'Alice' },
  { seatIndex: 1, ownerType: 'human', displayName: 'Bob' },
  { seatIndex: 2, ownerType: 'open', displayName: null },
]

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

test('createOnlineGame quick-auths then POSTs authed /games mode=solo', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(okJson({ token: 'jwt-1', accountId: 'acc-1' })) // /auth/quick
    .mockResolvedValueOnce(okJson({ gameId: 'game-9', code: 'ABCDEF' }, 201)) // /games
  vi.stubGlobal('fetch', fetchMock)

  const created = await createOnlineGame('http://sv', { displayName: 'Alice', opponents: 2 })

  expect(created).toEqual({ gameId: 'game-9', code: 'ABCDEF', mySeat: 0, players: ['Alice', 'AI 2', 'AI 3'] })
  expect(fetchMock.mock.calls[0]![0]).toBe('http://sv/auth/quick')
  const [gamesUrl, gamesInit] = fetchMock.mock.calls[1]!
  expect(gamesUrl).toBe('http://sv/games')
  const body = JSON.parse((gamesInit as RequestInit).body as string)
  expect(body).toMatchObject({ playerCount: 3, mode: 'solo', displayName: 'Alice' })
  expect(body.seatOwners).toBeUndefined() // legacy unauthed shape is gone
  // Authed create: the Bearer token from quickAuth rides the header.
  const headers = new Headers((gamesInit as RequestInit).headers)
  expect(headers.get('Authorization')).toBe('Bearer jwt-1')
})

test('createOnlineGame throws on a failed create', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(okJson({ token: 'jwt-1', accountId: 'acc-1' }))
      .mockResolvedValueOnce(okJson({ error: 'nope' }, 500)),
  )
  await expect(createOnlineGame('http://sv', { displayName: 'Bob', opponents: 1 })).rejects.toThrow(/create game failed/)
})

test('createOnlineRoom POSTs mode=multiplayer and returns host seat 0 + open slots', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(okJson({ token: 'jwt-1', accountId: 'acc-1' })) // /auth/quick
    .mockResolvedValueOnce(okJson({ gameId: 'g-room', code: 'ROOMED' }, 201)) // /games
  vi.stubGlobal('fetch', fetchMock)

  const created = await createOnlineRoom('http://sv', { displayName: 'Alice', playerCount: 3 })

  expect(created).toEqual({ gameId: 'g-room', code: 'ROOMED', mySeat: 0, players: ['Alice', 'Open', 'Open'] })
  const [url, init] = fetchMock.mock.calls[1]!
  expect(url).toBe('http://sv/games')
  const body = JSON.parse((init as RequestInit).body as string)
  expect(body).toMatchObject({ playerCount: 3, mode: 'multiplayer', displayName: 'Alice' })
})

test('createOnlineRoom forwards the chosen aiTakeoverMs (incl. 0 = wait-for-me)', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(okJson({ token: 'jwt-1', accountId: 'acc-1' }))
    .mockResolvedValueOnce(okJson({ gameId: 'g-room', code: 'ROOMED' }, 201))
  vi.stubGlobal('fetch', fetchMock)

  await createOnlineRoom('http://sv', { displayName: 'Alice', playerCount: 2, aiTakeoverMs: 0 })

  const body = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string)
  expect(body.aiTakeoverMs).toBe(0)
})

test('joinOnlineGame quick-auths, resolves the code, joins, and returns the seat + roster', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(okJson({ token: 'jwt-1', accountId: 'acc-1' })) // /auth/quick
    .mockResolvedValueOnce(okJson({ gameId: 'game-7' })) // /games/resolve
    .mockResolvedValueOnce(okJson({ seatIndex: 1, room: { code: 'ABCDEF', seats: waitingSeats } })) // /join
  vi.stubGlobal('fetch', fetchMock)

  const joined = await joinOnlineGame('http://sv', { code: 'abcdef', displayName: 'Bob' })

  expect(joined).toEqual({ gameId: 'game-7', code: 'ABCDEF', mySeat: 1, players: ['Alice', 'Bob', 'Open'] })
  expect(fetchMock.mock.calls[1]![0]).toBe('http://sv/games/resolve?code=ABCDEF') // uppercased
  expect(fetchMock.mock.calls[2]![0]).toBe('http://sv/games/game-7/join')
})

test('joinOnlineGame throws a friendly error on an unknown code (404)', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(okJson({ token: 'jwt-1', accountId: 'acc-1' }))
      .mockResolvedValueOnce(okJson({ error: 'not_found' }, 404)),
  )
  await expect(joinOnlineGame('http://sv', { code: 'ZZZZZZ', displayName: 'Bob' })).rejects.toThrow(/No open game/)
})

test('joinOnlineGame throws when the room is full (409)', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(okJson({ token: 'jwt-1', accountId: 'acc-1' }))
      .mockResolvedValueOnce(okJson({ gameId: 'game-7' }))
      .mockResolvedValueOnce(okJson({ error: 'room_full' }, 409)),
  )
  await expect(joinOnlineGame('http://sv', { code: 'ABCDEF', displayName: 'Bob' })).rejects.toThrow(/full or already started/)
})

test('fetchRoom returns the waiting roster (incl. hostSeat/openSeats/aiTakeoverMs), and reports started once active', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okJson({
    status: 'waiting', playerCount: 3, code: 'ABCDEF', hostSeat: 1, openSeats: 1, aiTakeoverMs: 0, seats: waitingSeats,
  })))
  const waiting = await fetchRoom('http://sv', 'g1')
  expect(waiting).toMatchObject({ status: 'waiting', playerCount: 3, code: 'ABCDEF', hostSeat: 1, openSeats: 1, aiTakeoverMs: 0 })

  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okJson({ moveIndex: 0, snapshot: {}, moves: [] })))
  const started = await fetchRoom('http://sv', 'g1')
  expect(started.status).toBe('started')
})

test('startRoom POSTs /start and leaveGame POSTs /leave', async () => {
  const startMock = vi.fn().mockResolvedValueOnce(okJson({ moveIndex: 0, snapshot: {} }))
  vi.stubGlobal('fetch', startMock)
  await startRoom('http://sv', 'g1')
  expect(startMock.mock.calls[0]![0]).toBe('http://sv/games/g1/start')

  const leaveMock = vi.fn().mockResolvedValueOnce(okJson({ ok: true }))
  vi.stubGlobal('fetch', leaveMock)
  await leaveGame('http://sv', 'g1')
  expect(leaveMock.mock.calls[0]![0]).toBe('http://sv/games/g1/leave')
})

test('startRoom surfaces a not_host error on 403', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ error: 'not_host' }, 403)))
  await expect(startRoom('http://sv', 'g1')).rejects.toThrow(/not_host/)
})
