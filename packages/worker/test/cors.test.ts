import { SELF, env } from 'cloudflare:test'
import { it, expect, describe, beforeAll } from 'vitest'
import { corsHeaders, handlePreflight, withCors } from '../src/cors'
import { applyD1Schema } from '../src/d1/schema'

const DB = () => (env as unknown as { DB: D1Database }).DB
beforeAll(async () => { await applyD1Schema(DB()) })

const ORIGIN = 'https://viota.pages.dev'
const req = (opts: { origin?: string; method?: string } = {}) =>
  new Request('https://worker.example.com/games/resolve?code=X', {
    method: opts.method ?? 'GET',
    headers: opts.origin ? { Origin: opts.origin } : {},
  })

// --- Unit: the pure CORS policy ---------------------------------------------
describe('corsHeaders (the pinned-origin policy)', () => {
  it('reflects an Origin that EXACTLY equals CLIENT_ORIGIN', () => {
    const h = corsHeaders(req({ origin: ORIGIN }), { CLIENT_ORIGIN: ORIGIN })
    expect(h['Access-Control-Allow-Origin']).toBe(ORIGIN)
    expect(h['Vary']).toBe('Origin')
    expect(h['Access-Control-Allow-Methods']).toBe('GET,POST,OPTIONS')
    expect(h['Access-Control-Allow-Headers']).toBe('Authorization,Content-Type')
    expect(h['Access-Control-Max-Age']).toBeTruthy()
  })

  it('does NOT reflect a FOREIGN origin when CLIENT_ORIGIN is set (no Allow-Origin at all)', () => {
    const h = corsHeaders(req({ origin: 'https://evil.example.com' }), { CLIENT_ORIGIN: ORIGIN })
    expect('Access-Control-Allow-Origin' in h).toBe(false)
    // Still marks the response as origin-dependent so a cache can't leak it.
    expect(h['Vary']).toBe('Origin')
  })

  it('never reflects an arbitrary origin even when it merely PREFIXES CLIENT_ORIGIN', () => {
    // A substring / prefix must not satisfy the exact-equality check.
    const h1 = corsHeaders(req({ origin: 'https://viota.pages.dev.evil.com' }), { CLIENT_ORIGIN: ORIGIN })
    const h2 = corsHeaders(req({ origin: 'https://viota.pages.de' }), { CLIENT_ORIGIN: ORIGIN })
    expect('Access-Control-Allow-Origin' in h1).toBe(false)
    expect('Access-Control-Allow-Origin' in h2).toBe(false)
  })

  it('falls back to * ONLY when CLIENT_ORIGIN is unset (local dev; bearer-token model, no cookies)', () => {
    const h = corsHeaders(req({ origin: 'http://localhost:5173' }), {})
    expect(h['Access-Control-Allow-Origin']).toBe('*')
  })
})

describe('handlePreflight', () => {
  it('answers an OPTIONS preflight with 204 + the CORS headers', () => {
    const res = handlePreflight(req({ origin: ORIGIN, method: 'OPTIONS' }), { CLIENT_ORIGIN: ORIGIN })!
    expect(res).not.toBeNull()
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST,OPTIONS')
    expect(res.headers.get('Vary')).toBe('Origin')
  })

  it('is a no-op (null) for non-OPTIONS requests', () => {
    expect(handlePreflight(req({ origin: ORIGIN, method: 'GET' }), { CLIENT_ORIGIN: ORIGIN })).toBeNull()
  })

  it('a foreign preflight is 204 but carries NO Allow-Origin (browser blocks it)', () => {
    const res = handlePreflight(req({ origin: 'https://evil.example.com', method: 'OPTIONS' }), { CLIENT_ORIGIN: ORIGIN })!
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('withCors', () => {
  it('preserves status + body and merges the CORS headers onto an existing response', async () => {
    const base = new Response(JSON.stringify({ hello: 'world' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    })
    const wrapped = withCors(base, req({ origin: ORIGIN }), { CLIENT_ORIGIN: ORIGIN })
    expect(wrapped.status).toBe(201)
    expect(wrapped.headers.get('content-type')).toBe('application/json')
    expect(wrapped.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(await wrapped.json()).toEqual({ hello: 'world' })
  })
})

// --- Integration: the middleware is actually wired into the Worker fetch -----
describe('CORS middleware wired on the real Worker fetch (CLIENT_ORIGIN unset -> *)', () => {
  it('a real GET carries Access-Control-Allow-Origin + Vary', async () => {
    const res = await SELF.fetch('https://example.com/games/resolve?code=NOPEXX', {
      headers: { Origin: 'http://localhost:5173' },
    })
    // The route itself 404s (unknown code); CORS headers ride along regardless.
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Vary')).toBe('Origin')
  })

  it('an OPTIONS preflight to any route returns 204 with the allowed methods/headers', async () => {
    const res = await SELF.fetch('https://example.com/games', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST,OPTIONS')
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Authorization,Content-Type')
  })
})
