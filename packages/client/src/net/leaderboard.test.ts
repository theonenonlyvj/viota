import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fetchLeaderboard, fetchMyStats } from './leaderboard'

function okJson(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

test('fetchLeaderboard GETs /leaderboard?game=iota&board=<key> unauthenticated and returns the parsed body', async () => {
  const body = {
    board: 'winrate-friends',
    rows: [{ accountId: 'a1', displayName: 'Alice', username: 'alice', value: 0.75, games: 8 }],
  }
  const fetchMock = vi.fn().mockResolvedValueOnce(okJson(body))
  vi.stubGlobal('fetch', fetchMock)

  const res = await fetchLeaderboard('http://sv', 'winrate-friends')

  expect(res).toEqual(body)
  expect(fetchMock.mock.calls[0]![0]).toBe('http://sv/leaderboard?game=iota&board=winrate-friends')
  // plain public fetch — no init/Authorization attached
  expect(fetchMock.mock.calls[0]![1]).toBeUndefined()
})

test('fetchLeaderboard works for every board key', async () => {
  const keys = ['winrate-friends', 'wins-friends', 'streak-friends', 'winrate-ai', 'wins-ai', 'bestplay', 'bestgame'] as const
  for (const key of keys) {
    const fetchMock = vi.fn().mockResolvedValueOnce(okJson({ board: key, rows: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchLeaderboard('http://sv', key)
    expect(fetchMock.mock.calls[0]![0]).toBe(`http://sv/leaderboard?game=iota&board=${key}`)
  }
})

test('fetchLeaderboard surfaces the optional me field when present', async () => {
  const body = { board: 'bestplay', rows: [], me: { rank: 3, value: 12 } }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okJson(body)))
  const res = await fetchLeaderboard('http://sv', 'bestplay')
  expect(res.me).toEqual({ rank: 3, value: 12 })
})

test('fetchLeaderboard throws on a non-ok response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okJson({ error: 'invalid_board' }, 400)))
  await expect(fetchLeaderboard('http://sv', 'winrate-friends')).rejects.toThrow(/leaderboard fetch failed/)
})

test('fetchMyStats returns null with no stored token, without calling fetch', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  expect(await fetchMyStats('http://sv')).toBeNull()
  expect(fetchMock).not.toHaveBeenCalled()
})

test('fetchMyStats sends the Bearer token to GET /me/stats and returns the parsed body', async () => {
  localStorage.setItem('viota_token', 'jwt-1')
  const body = {
    games: 10,
    vsFriends: { games: 6, wins: 4, winRate: 0.6667, streak: 3 },
    vsAI: { games: 4, wins: 3, winRate: 0.75 },
    bestPlay: 20,
    bestGame: 55,
    playerSince: 1700000000000,
    lastPlayed: 1700500000000,
    byPlayerCount: { '2': 5, '3': 3, '4': 2 },
    totalTimeMs: 3600000,
  }
  const fetchMock = vi.fn().mockResolvedValueOnce(okJson(body))
  vi.stubGlobal('fetch', fetchMock)

  const res = await fetchMyStats('http://sv')

  expect(res).toEqual(body)
  expect(fetchMock.mock.calls[0]![0]).toBe('http://sv/me/stats')
  const headers = new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers)
  expect(headers.get('Authorization')).toBe('Bearer jwt-1')
})

test('fetchMyStats returns null on a non-ok response (e.g. 401)', async () => {
  localStorage.setItem('viota_token', 'jwt-1')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ error: 'unauthorized' }, 401)))
  expect(await fetchMyStats('http://sv')).toBeNull()
})

test('fetchMyStats returns null on a network error instead of throwing', async () => {
  localStorage.setItem('viota_token', 'jwt-1')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
  expect(await fetchMyStats('http://sv')).toBeNull()
})
