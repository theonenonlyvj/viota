import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { claimAccount, loginAccount } from './account'
import { getAccountId, getDeviceCredential, getToken } from './identity'

function okJson(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

test('claimAccount POSTs /auth/set-credentials with the Bearer token + username/password', async () => {
  localStorage.setItem('viota_token', 'jwt-existing')
  const fetchMock = vi.fn().mockResolvedValueOnce(okJson({ ok: true }))
  vi.stubGlobal('fetch', fetchMock)

  const result = await claimAccount('http://sv', 'vijay', 'hunter2')

  expect(result).toEqual({ ok: true })
  const [url, init] = fetchMock.mock.calls[0]!
  expect(url).toBe('http://sv/auth/set-credentials')
  const headers = new Headers((init as RequestInit).headers)
  expect(headers.get('Authorization')).toBe('Bearer jwt-existing')
  const body = JSON.parse((init as RequestInit).body as string)
  expect(body).toEqual({ username: 'vijay', password: 'hunter2' })
})

test('claimAccount maps 409 username_taken', async () => {
  localStorage.setItem('viota_token', 'jwt-existing')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okJson({ error: 'username_taken' }, 409)))
  const result = await claimAccount('http://sv', 'vijay', 'hunter2')
  expect(result).toEqual({ ok: false, error: 'username_taken' })
})

test('claimAccount maps 409 not_ghost (already claimed/merged)', async () => {
  localStorage.setItem('viota_token', 'jwt-existing')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okJson({ error: 'not_ghost' }, 409)))
  const result = await claimAccount('http://sv', 'vijay', 'hunter2')
  expect(result).toEqual({ ok: false, error: 'not_ghost' })
})

test('claimAccount maps 400 to invalid', async () => {
  localStorage.setItem('viota_token', 'jwt-existing')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okJson({ error: 'invalid_username' }, 400)))
  const result = await claimAccount('http://sv', 'vi', 'hunter2')
  expect(result).toEqual({ ok: false, error: 'invalid' })
})

test('claimAccount maps an unexpected status to a generic failure', async () => {
  localStorage.setItem('viota_token', 'jwt-existing')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okJson({}, 500)))
  const result = await claimAccount('http://sv', 'vijay', 'hunter2')
  expect(result).toEqual({ ok: false, error: 'failed' })
})

test('loginAccount POSTs /auth/login with username/password/deviceCredential and no Bearer', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(okJson({ token: 'jwt-new', accountId: 'acc-9', mustChangePassword: false }))
  vi.stubGlobal('fetch', fetchMock)

  const result = await loginAccount('http://sv', 'vijay', 'hunter2')

  expect(result).toEqual({ ok: true, mustChangePassword: false })
  const [url, init] = fetchMock.mock.calls[0]!
  expect(url).toBe('http://sv/auth/login')
  const body = JSON.parse((init as RequestInit).body as string)
  expect(body).toEqual({ username: 'vijay', password: 'hunter2', deviceCredential: getDeviceCredential() })
  const headers = new Headers((init as RequestInit).headers)
  expect(headers.get('Authorization')).toBeNull() // plain fetch — not the caller's Bearer
})

test('loginAccount persists the token + accountId on success (same storage as quickAuth)', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okJson({ token: 'jwt-new', accountId: 'acc-9', mustChangePassword: true })))
  await loginAccount('http://sv', 'vijay', 'hunter2')
  expect(getToken()).toBe('jwt-new')
  expect(getAccountId()).toBe('acc-9')
})

test('loginAccount surfaces mustChangePassword:true from the server', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okJson({ token: 'jwt-new', accountId: 'acc-9', mustChangePassword: true })))
  const result = await loginAccount('http://sv', 'vijay', 'hunter2')
  expect(result).toEqual({ ok: true, mustChangePassword: true })
})

test('loginAccount maps 401 to invalid_credentials and persists nothing', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okJson({ error: 'invalid_credentials' }, 401)))
  const result = await loginAccount('http://sv', 'vijay', 'wrong')
  expect(result).toEqual({ ok: false, error: 'invalid_credentials' })
  expect(getToken()).toBeNull()
})
