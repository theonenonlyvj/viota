import { it, expect, describe } from 'vitest'
import { assertSecret, KNOWN_DEV_DEFAULTS } from '../src/auth'

describe('assertSecret (request-time fail-closed guard)', () => {
  const valid = 'x'.repeat(32) // exactly 32 bytes

  it('returns a 503 Response when the secret is missing', () => {
    const r = assertSecret({})
    expect(r).toBeInstanceOf(Response)
    expect(r!.status).toBe(503)
  })

  it('returns 503 for an empty secret', () => {
    expect(assertSecret({ JWT_SECRET: '' })!.status).toBe(503)
  })

  it('returns 503 for every known dev default', () => {
    for (const d of KNOWN_DEV_DEFAULTS) {
      const r = assertSecret({ JWT_SECRET: d })
      expect(r, `default ${JSON.stringify(d)} must be rejected`).toBeInstanceOf(Response)
      expect(r!.status).toBe(503)
    }
  })

  it('rejects the source-committed dev secret from the live bug', () => {
    expect(assertSecret({ JWT_SECRET: 'dev-secret-change-in-production' })!.status).toBe(503)
  })

  it('returns 503 for a secret shorter than 32 bytes', () => {
    expect(assertSecret({ JWT_SECRET: 'short' })!.status).toBe(503)
    expect(assertSecret({ JWT_SECRET: 'a'.repeat(31) })!.status).toBe(503)
  })

  it('measures bytes not characters (a 31-byte multibyte secret fails)', () => {
    // '€' is 3 UTF-8 bytes; 10 of them = 30 bytes < 32.
    expect(assertSecret({ JWT_SECRET: '€'.repeat(10) })!.status).toBe(503)
  })

  it('passes (returns null) for a valid 32+ byte secret not in the deny list', () => {
    expect(assertSecret({ JWT_SECRET: valid })).toBeNull()
    expect(assertSecret({ JWT_SECRET: 'a-genuinely-long-production-secret-value-goes-here' })).toBeNull()
  })
})
