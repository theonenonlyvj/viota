import { SELF } from 'cloudflare:test'
import { describe, it, expect, afterEach, vi } from 'vitest'

/**
 * Identity code/data split, Step 3 (A2/2b) — viota-worker no longer serves
 * `/auth/*` locally: it's a thin GRACE-WINDOW proxy to `vgames-identity` (see
 * `proxyToIdentity`/`GRACE_PROXY_PATHS` in src/index.ts). These tests mock
 * `fetch` and assert the proxy forwards method/headers/body to the upstream
 * service and relays its response VERBATIM (status + body) for exactly the
 * four proxied paths — and that `/admin/merge` is DROPPED, not proxied.
 *
 * Mocking `fetch` works here because `SELF` (the main worker under test) runs
 * in the SAME isolate as this test file (vitest-pool-workers: "any global
 * mocks will apply to it too") — `vi.stubGlobal` on `fetch` is visible inside
 * the worker's own `fetch()` handler.
 */

const UPSTREAM = 'https://vgames-identity.theonenonlyvj.workers.dev'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('identity grace-window proxy (Step 3)', () => {
  it('forwards POST /auth/quick to vgames-identity, preserving method/headers/body, and relays the response verbatim', async () => {
    const upstreamBody = { token: 'upstream-token', accountId: 'upstream-acct-1' }
    const calls: { url: string; method: string; headers: Headers; body: string }[] = []
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        body: init?.body ? new TextDecoder().decode(init.body as ArrayBuffer) : '',
      })
      return new Response(JSON.stringify(upstreamBody), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', mockFetch)

    const res = await SELF.fetch('https://example.com/auth/quick', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Test-Header': 'yes' },
      body: JSON.stringify({ deviceCredential: 'x'.repeat(32), displayName: 'Proxy Test' }),
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(`${UPSTREAM}/auth/quick`)
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.headers.get('x-test-header')).toBe('yes')
    expect(JSON.parse(calls[0]!.body)).toEqual({ deviceCredential: 'x'.repeat(32), displayName: 'Proxy Test' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(upstreamBody)
  })

  it.each(['/auth/login', '/auth/set-credentials', '/auth/introspect'])(
    'forwards POST %s to vgames-identity',
    async (path) => {
      const mockFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
      vi.stubGlobal('fetch', mockFetch)

      const res = await SELF.fetch(`https://example.com${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch.mock.calls[0]![0]).toBe(`${UPSTREAM}${path}`)
      expect(res.status).toBe(200)
    },
  )

  it('relays a non-200 upstream status + body verbatim (e.g. 401 invalid_credentials)', async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_credentials' }), { status: 401 }))
    vi.stubGlobal('fetch', mockFetch)

    const res = await SELF.fetch('https://example.com/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'nope', password: 'wrong' }),
    })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'invalid_credentials' })
  })

  it('answers CORS preflight (OPTIONS) locally — never proxied', async () => {
    const mockFetch = vi.fn(async () => new Response('should not be called'))
    vi.stubGlobal('fetch', mockFetch)

    const res = await SELF.fetch('https://example.com/auth/quick', { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('POST /admin/merge is DROPPED (not proxied) — 404 not_found, upstream never called', async () => {
    const mockFetch = vi.fn(async () => new Response('should not be called'))
    vi.stubGlobal('fetch', mockFetch)

    const res = await SELF.fetch('https://example.com/admin/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(404)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
