import { it, expect, describe } from 'vitest'
import { SignJWT } from 'jose'
import { signToken, verifyToken } from '../src/jwt'

// The vitest miniflare binding uses this exact secret; any 32+ byte value works.
const SECRET = 'test-jwt-secret-0123456789-abcdefghijklmnop'
const OTHER = 'a-totally-different-secret-0123456789-xyzzy'
const key = new TextEncoder().encode(SECRET)

/** base64url with no padding (for hand-crafting a forged token). */
function b64url(o: unknown): string {
  return btoa(JSON.stringify(o)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

describe('jwt sign/verify (HS256, pinned)', () => {
  it('round-trips: a signed token verifies back to only its accountId', async () => {
    const token = await signToken('acct-42', SECRET)
    expect(await verifyToken(token, SECRET)).toEqual({ accountId: 'acct-42' })
  })

  it('carries ONLY the account id in the subject — no seat/room claims', async () => {
    const token = await signToken('acct-7', SECRET)
    // decode the payload segment and assert it has no seat/room/game leakage
    const payload = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
      ),
    )
    expect(payload.sub).toBe('acct-7')
    expect(payload.iss).toBe('viota')
    expect(payload.aud).toBe('viota-web')
    expect('seat' in payload).toBe(false)
    expect('seatIndex' in payload).toBe(false)
    expect('room' in payload).toBe(false)
    expect('gameId' in payload).toBe(false)
  })

  it('rejects a token signed with a different secret → null', async () => {
    const token = await signToken('acct-1', SECRET)
    expect(await verifyToken(token, OTHER)).toBeNull()
  })

  it('rejects a tampered token → null', async () => {
    const token = await signToken('acct-1', SECRET)
    const parts = token.split('.')
    const sig = parts[2]!
    parts[2] = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)
    expect(await verifyToken(parts.join('.'), SECRET)).toBeNull()
  })

  it('rejects an alg:none token (the algorithms allowlist is mandatory) → null', async () => {
    const header = b64url({ alg: 'none', typ: 'JWT' })
    const payload = b64url({
      sub: 'acct-evil',
      iss: 'viota',
      aud: 'viota-web',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    const forged = `${header}.${payload}.`
    expect(await verifyToken(forged, SECRET)).toBeNull()
  })

  it('rejects a wrong-issuer token → null', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('acct-1')
      .setIssuer('evil-issuer')
      .setAudience('viota-web')
      .setExpirationTime('24h')
      .sign(key)
    expect(await verifyToken(token, SECRET)).toBeNull()
  })

  it('rejects a wrong-audience token → null', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('acct-1')
      .setIssuer('viota')
      .setAudience('some-other-app')
      .setExpirationTime('24h')
      .sign(key)
    expect(await verifyToken(token, SECRET)).toBeNull()
  })

  it('rejects an expired token → null', async () => {
    // Mint with `now` 48h in the past → exp (now + 24h) is already elapsed.
    const past = Date.now() - 48 * 60 * 60 * 1000
    const token = await signToken('acct-1', SECRET, past)
    expect(await verifyToken(token, SECRET)).toBeNull()
  })
})
