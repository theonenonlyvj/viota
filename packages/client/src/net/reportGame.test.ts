import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { reportLocalGame, type FinishedLocalGame } from './reportGame'
import { getDeviceCredential } from './identity'

/**
 * Task 8 — uploads a FINISHED local (client-only, vs-AI) game to
 * POST /games/report. Follows the same real-localStorage + stubbed-global-fetch
 * convention as lobby.test.ts/identity.test.ts (no module mocking needed —
 * quickAuth is exercised for real against the stubbed fetch).
 */

function okJson(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const baseGame: FinishedLocalGame = {
  clientGameId: 'local-abc',
  playerCount: 2,
  humanSeat: 0,
  scores: [28, 5],
  moves: [
    { seat_index: 0, type: 'play', payload: '{"type":"play","placements":[]}', score_delta: 8, created_at: 1000 },
    { seat_index: 0, type: 'play', payload: '{"type":"play","placements":[]}', score_delta: 20, created_at: 2000 },
    { seat_index: 1, type: 'pass', payload: '{"type":"pass","trades":[],"tradeOrder":[]}', score_delta: 0, created_at: 1500 },
  ],
  startedAt: 900,
  endedAt: 3000,
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

test('on local finish: quick-auths first (no stored token), then POSTs /games/report once with the derived shape', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(okJson({ token: 'jwt-1', accountId: 'acc-1' })) // /auth/quick
    .mockResolvedValueOnce(okJson({ ok: true, gameUuid: 'local-abc' })) // /games/report
  vi.stubGlobal('fetch', fetchMock)

  await reportLocalGame('http://sv', baseGame)

  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock.mock.calls[0]![0]).toBe('http://sv/auth/quick')

  const [url, init] = fetchMock.mock.calls[1]!
  expect(url).toBe('http://sv/games/report')
  const headers = new Headers((init as RequestInit).headers)
  expect(headers.get('Authorization')).toBe('Bearer jwt-1')

  const body = JSON.parse((init as RequestInit).body as string)
  expect(body).toEqual({
    clientGameId: 'local-abc',
    playerCount: 2,
    players: [
      { seat: 0, accountId: 'acc-1', ownerType: 'human', displayName: 'Player' },
      { seat: 1, ownerType: 'ai', displayName: 'AI 1' },
    ],
    winnerSeat: 0,
    seats: [
      { seat: 0, finalScore: 28 },
      { seat: 1, finalScore: 5 },
    ],
    moves: baseGame.moves,
    startedAt: 900,
    endedAt: 3000,
  })
})

test('skips quickAuth when a token is already stored, and sends a single request', async () => {
  localStorage.setItem('viota_token', 'jwt-existing')
  localStorage.setItem('viota_account_id', 'acc-existing')
  localStorage.setItem('viota_display_name', 'Reporter')
  const fetchMock = vi.fn().mockResolvedValueOnce(okJson({ ok: true }))
  vi.stubGlobal('fetch', fetchMock)

  await reportLocalGame('http://sv', baseGame)

  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0]!
  expect(url).toBe('http://sv/games/report')
  const headers = new Headers((init as RequestInit).headers)
  expect(headers.get('Authorization')).toBe('Bearer jwt-existing')
  const body = JSON.parse((init as RequestInit).body as string)
  expect(body.players[0]).toEqual({ seat: 0, accountId: 'acc-existing', ownerType: 'human', displayName: 'Reporter' })
})

test('winnerSeat is the argmax seat, or null on a tie', async () => {
  localStorage.setItem('viota_token', 'jwt-1')
  localStorage.setItem('viota_account_id', 'acc-1')

  const tiedFetch = vi.fn().mockResolvedValueOnce(okJson({ ok: true }))
  vi.stubGlobal('fetch', tiedFetch)
  await reportLocalGame('http://sv', { ...baseGame, scores: [10, 10] })
  const tiedBody = JSON.parse((tiedFetch.mock.calls[0]![1] as RequestInit).body as string)
  expect(tiedBody.winnerSeat).toBeNull()

  const seat1WinsFetch = vi.fn().mockResolvedValueOnce(okJson({ ok: true }))
  vi.stubGlobal('fetch', seat1WinsFetch)
  await reportLocalGame('http://sv', { ...baseGame, humanSeat: 0, scores: [3, 30] })
  const seat1Body = JSON.parse((seat1WinsFetch.mock.calls[0]![1] as RequestInit).body as string)
  expect(seat1Body.winnerSeat).toBe(1)
})

test('never throws when quickAuth fails (no stored token, auth request rejects) — and never attempts /games/report', async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline'))
  vi.stubGlobal('fetch', fetchMock)

  await expect(reportLocalGame('http://sv', baseGame)).resolves.toBeUndefined()
  expect(fetchMock).toHaveBeenCalledTimes(1) // only the failed /auth/quick attempt
})

test('never throws when the /games/report request itself fails (network error)', async () => {
  localStorage.setItem('viota_token', 'jwt-1')
  localStorage.setItem('viota_account_id', 'acc-1')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')))

  await expect(reportLocalGame('http://sv', baseGame)).resolves.toBeUndefined()
})

test('never throws on a non-ok /games/report response (e.g. 403)', async () => {
  localStorage.setItem('viota_token', 'jwt-1')
  localStorage.setItem('viota_account_id', 'acc-1')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okJson({ error: 'forbidden' }, 403)))

  await expect(reportLocalGame('http://sv', baseGame)).resolves.toBeUndefined()
})

test('quickAuth (when needed) mints from the same stable device credential identity.ts uses', async () => {
  const cred = getDeviceCredential()
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(okJson({ token: 'jwt-1', accountId: 'acc-1' }))
    .mockResolvedValueOnce(okJson({ ok: true }))
  vi.stubGlobal('fetch', fetchMock)

  await reportLocalGame('http://sv', baseGame)

  const authBody = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
  expect(authBody.deviceCredential).toBe(cred)
})
