import { SELF } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'

/**
 * Grace-window auth proxy (split Step 3 / A2-2b): viota-worker forwards the four
 * /auth/* routes to the `vgames-identity` worker over the IDENTITY_SVC SERVICE
 * BINDING (worker->worker HTTP to *.workers.dev is restricted — proven live
 * 2026-07-18). In tests the binding is an ECHO stub (vitest.config.ts) that
 * reflects method/path/body and honors `x-stub-status`, so these tests assert
 * the proxy forwards faithfully through the REAL binding code path.
 * Remove with the proxy (~2026-07-20).
 */

const PROXIED = ['/auth/quick', '/auth/login', '/auth/set-credentials', '/auth/introspect']

describe('identity grace-window proxy (Step 3, via IDENTITY_SVC binding)', () => {
  it('forwards each proxied route with method/path/body intact', async () => {
    for (const path of PROXIED) {
      const payload = JSON.stringify({ probe: path })
      const res = await SELF.fetch(`https://example.com${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
      })
      expect(res.status).toBe(200)
      const echoed = (await res.json()) as { via: string; method: string; path: string; body: string }
      expect(echoed.via).toBe('identity_svc_stub')
      expect(echoed.method).toBe('POST')
      expect(echoed.path).toBe(path)
      expect(echoed.body).toBe(payload)
    }
  })

  it('relays a non-200 upstream status + body verbatim', async () => {
    const res = await SELF.fetch('https://example.com/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-stub-status': '401' },
      body: JSON.stringify({ username: 'nope', password: 'wrong', deviceCredential: 'x' }),
    })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { via: string }).via).toBe('identity_svc_stub')
  })

  it('answers CORS preflight locally — never proxied', async () => {
    const res = await SELF.fetch('https://example.com/auth/quick', {
      method: 'OPTIONS',
      headers: { origin: 'https://viota.pages.dev', 'access-control-request-method': 'POST' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy()
    // preflight never reaches the stub (its body would say identity_svc_stub)
    expect(await res.text()).toBe('')
  })

  it('does NOT proxy /admin/merge (dropped from viota-worker) or /claim (game-domain, served locally)', async () => {
    const admin = await SELF.fetch('https://example.com/admin/merge', { method: 'POST', body: '{}' })
    expect(admin.status).toBe(404)
    const claim = await SELF.fetch('https://example.com/claim', { method: 'POST', body: '{}' })
    expect([400, 401]).toContain(claim.status) // served LOCALLY (auth/shape error), not echoed by the stub
  })
})
