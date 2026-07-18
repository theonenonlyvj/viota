import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import {
  getDeviceCredential,
  getGhostId,
  getToken,
  getAccountId,
  getUsername,
  setUsername,
  quickAuth,
} from './identity'

/** Recompute the server's hashCredential (SHA-256 hex of the UTF-8 credential). */
async function serverHash(cred: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cred))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

test('device credential is a 256-bit hex string, persisted and stable', () => {
  const c1 = getDeviceCredential()
  expect(c1).toMatch(/^[0-9a-f]{64}$/) // 32 bytes = 64 hex chars
  expect(localStorage.getItem('viota_device_credential')).toBe(c1)
  const c2 = getDeviceCredential()
  expect(c2).toBe(c1) // stable across calls
})

test('ghostId equals SHA-256(credential) — matches the server hashCredential', async () => {
  const cred = getDeviceCredential()
  const ghostId = await getGhostId()
  expect(ghostId).toMatch(/^[0-9a-f]{64}$/)
  expect(ghostId).toBe(await serverHash(cred))
})

test('quickAuth POSTs credential+name and stores the token + accountId', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ token: 'jwt-abc', accountId: 'acc-1' }),
  })
  vi.stubGlobal('fetch', fetchMock)

  const res = await quickAuth('Alice')

  expect(res).toEqual({ token: 'jwt-abc', accountId: 'acc-1' })
  expect(getToken()).toBe('jwt-abc')
  expect(getAccountId()).toBe('acc-1')

  const [url, init] = fetchMock.mock.calls[0]!
  expect(url).toBe('http://localhost:8787/auth/quick')
  const body = JSON.parse((init as RequestInit).body as string)
  expect(body.displayName).toBe('Alice')
  expect(body.deviceCredential).toBe(getDeviceCredential())
})

test('quickAuth throws on a non-ok response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }))
  await expect(quickAuth('Bad')).rejects.toThrow()
})

test('getUsername is null until a claimed username is stored', () => {
  expect(getUsername()).toBeNull()
  setUsername('vijay')
  expect(getUsername()).toBe('vijay')
  expect(localStorage.getItem('viota_username')).toBe('vijay')
})
