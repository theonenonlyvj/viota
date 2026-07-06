import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { recordGhostGame, listGhostGames, claimGhostGames } from './ghost'
import { getGhostId, getDeviceCredential } from './identity'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  localStorage.setItem('viota_token', 'jwt-1')
})
afterEach(() => vi.unstubAllGlobals())

test('a completed local game is stored under the device ghostId', async () => {
  const rec = await recordGhostGame({ playerCount: 2, mySeat: 0, scores: [30, 12], winnerSeat: 0 })
  const ghostId = await getGhostId()
  expect(rec.ghostId).toBe(ghostId)

  const games = await listGhostGames(ghostId)
  expect(games).toHaveLength(1)
  expect(games[0]!.scores).toEqual([30, 12])
  expect(games[0]!.winnerSeat).toBe(0)
})

test('claimGhostGames POSTs { ghostId, deviceCredential } with the Bearer token', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, claimed: 3 }) })
  vi.stubGlobal('fetch', fetchMock)

  const { claimed } = await claimGhostGames('http://sv')
  expect(claimed).toBe(3)

  const [url, init] = fetchMock.mock.calls[0]!
  expect(url).toBe('http://sv/claim')
  const body = JSON.parse((init as RequestInit).body as string)
  expect(body.ghostId).toBe(await getGhostId())
  expect(body.deviceCredential).toBe(getDeviceCredential())
  const headers = new Headers((init as RequestInit).headers)
  expect(headers.get('Authorization')).toBe('Bearer jwt-1')
})

test('claimGhostGames returns 0 (non-fatal) on a network error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  expect(await claimGhostGames('http://sv')).toEqual({ claimed: 0 })
})
