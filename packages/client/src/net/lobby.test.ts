import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createOnlineGame, joinOnlineGame } from './lobby'

function okJson(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

test('createOnlineGame quick-auths then POSTs /games with seat0=human + AI seats', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(okJson({ token: 'jwt-1', accountId: 'acc-1' })) // /auth/quick
    .mockResolvedValueOnce(okJson({ gameId: 'game-9', code: 'ABCDEF' }, 201)) // /games
  vi.stubGlobal('fetch', fetchMock)

  const created = await createOnlineGame('http://sv', { displayName: 'Alice', opponents: 2 })

  expect(created).toEqual({
    gameId: 'game-9',
    code: 'ABCDEF',
    mySeat: 0,
    players: ['Alice', 'AI 2', 'AI 3'],
  })

  expect(fetchMock.mock.calls[0]![0]).toBe('http://sv/auth/quick')
  const [gamesUrl, gamesInit] = fetchMock.mock.calls[1]!
  expect(gamesUrl).toBe('http://sv/games')
  const body = JSON.parse((gamesInit as RequestInit).body as string)
  expect(body.playerCount).toBe(3)
  expect(body.seatOwners).toHaveLength(3)
  expect(body.seatOwners[0]).toMatchObject({ ownerType: 'human', accountId: 'acc-1' })
  expect(body.seatOwners[1]).toMatchObject({ ownerType: 'ai' })
  expect(body.seatOwners[2]).toMatchObject({ ownerType: 'ai' })
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

test('joinOnlineGame is a documented deferred stub', async () => {
  await expect(joinOnlineGame('http://sv', { code: 'ABCDEF', displayName: 'Bob' })).rejects.toThrow(/not available yet/)
})
