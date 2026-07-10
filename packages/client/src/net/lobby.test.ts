import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createOnlineGame, createOnlineRoom, joinOnlineGame, fetchRoom, startRoom, leaveGame, myGames } from './lobby'

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

test('joinOnlineGame resumes into an already-active game (room: null) without throwing', async () => {
  // Fix #3: an account that already owns a seat in a STARTED game gets
  // { seatIndex, status:'active', room:null } back from /join (idempotent
  // resume) instead of the waiting-room roster. joinOnlineGame must not
  // blow up dereferencing `room` — it resolves a placeholder roster via
  // /my-games and flags `resumed: true` so the caller routes straight into
  // the live game instead of a waiting room that no longer exists.
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(okJson({ token: 'jwt-1', accountId: 'acc-1' })) // /auth/quick
    .mockResolvedValueOnce(okJson({ gameId: 'game-7' })) // /games/resolve
    .mockResolvedValueOnce(okJson({ seatIndex: 1, status: 'active', room: null })) // /join
    .mockResolvedValueOnce(okJson({ // /my-games
      games: [{ game_uuid: 'game-7', code: 'ABCDEF', status: 'active', player_count: 3, last_activity_at: 1, seat_index: 1 }],
    }))
  vi.stubGlobal('fetch', fetchMock)

  const joined = await joinOnlineGame('http://sv', { code: 'abcdef', displayName: 'Bob' })

  expect(joined).toEqual({
    gameId: 'game-7',
    code: 'ABCDEF',
    mySeat: 1,
    players: ['Player 1', 'Bob', 'Player 3'],
    resumed: true,
  })
})

test('joinOnlineGame resume falls back gracefully when /my-games has no matching row', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(okJson({ token: 'jwt-1', accountId: 'acc-1' }))
    .mockResolvedValueOnce(okJson({ gameId: 'game-7' }))
    .mockResolvedValueOnce(okJson({ seatIndex: 2, status: 'active', room: null }))
    .mockResolvedValueOnce(okJson({ games: [] })) // /my-games — race, nothing found yet
  vi.stubGlobal('fetch', fetchMock)

  const joined = await joinOnlineGame('http://sv', { code: 'abcdef', displayName: 'Bob' })

  expect(joined.resumed).toBe(true)
  expect(joined.gameId).toBe('game-7')
  expect(joined.mySeat).toBe(2)
  expect(joined.code).toBe('ABCDEF') // falls back to the caller-provided code
  expect(joined.players[2]).toBe('Bob') // at least my own seat is right
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

test('myGames maps the server rows to the resumable list (Bearer)', async () => {
  localStorage.setItem('viota_token', 'jwt-1')
  const fetchMock = vi.fn().mockResolvedValue(okJson({
    games: [
      { game_uuid: 'g-a', code: 'AAA', status: 'active', player_count: 2, last_activity_at: 111, seat_index: 1 },
      { game_uuid: 'g-w', code: 'WWW', status: 'waiting', player_count: 3, last_activity_at: 99, seat_index: 0 },
    ],
  }))
  vi.stubGlobal('fetch', fetchMock)

  const games = await myGames('http://sv')

  expect(fetchMock.mock.calls[0]![0]).toBe('http://sv/my-games')
  const headers = new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers)
  expect(headers.get('Authorization')).toBe('Bearer jwt-1')
  expect(games).toEqual([
    { gameId: 'g-a', code: 'AAA', status: 'active', playerCount: 2, seatIndex: 1, lastActivityAt: 111 },
    { gameId: 'g-w', code: 'WWW', status: 'waiting', playerCount: 3, seatIndex: 0, lastActivityAt: 99 },
  ])
})

test('myGames returns [] with no stored token (nothing to resume)', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  expect(await myGames('http://sv')).toEqual([])
  expect(fetchMock).not.toHaveBeenCalled()
})
