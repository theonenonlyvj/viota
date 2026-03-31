import { describe, it, expect } from 'vitest'
import {
  signGuestToken, verifyToken, signAccountToken,
  hashPassword, comparePassword, generateRoomCode,
  type TokenPayload,
} from '../src/auth'

const SECRET = 'test-secret-key'

describe('generateRoomCode', () => {
  it('returns a 6-character uppercase alphanumeric string', () => {
    const code = generateRoomCode()
    expect(code).toHaveLength(6)
    expect(code).toMatch(/^[A-Z0-9]{6}$/)
  })

  it('generates unique codes across 100 calls', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateRoomCode()))
    expect(codes.size).toBeGreaterThan(90)
  })
})

describe('signGuestToken / verifyToken', () => {
  it('signs and verifies a guest token', () => {
    const token = signGuestToken(
      { roomCode: 'ABC123', playerIndex: 0, playerName: 'Alice', guestSecret: 'sec' },
      SECRET
    )
    const payload = verifyToken(token, SECRET)
    expect(payload).not.toBeNull()
    expect(payload!.sub).toBe('guest')
    expect((payload as Extract<TokenPayload, { sub: 'guest' }>).roomCode).toBe('ABC123')
    expect((payload as Extract<TokenPayload, { sub: 'guest' }>).playerIndex).toBe(0)
  })

  it('returns null for a malformed token', () => {
    expect(verifyToken('not.a.token', SECRET)).toBeNull()
  })

  it('returns null for token signed with different secret', () => {
    const token = signGuestToken(
      { roomCode: 'ABC123', playerIndex: 0, playerName: 'Alice', guestSecret: 'sec' },
      'secret-A'
    )
    expect(verifyToken(token, 'secret-B')).toBeNull()
  })
})

describe('signAccountToken / verifyToken', () => {
  it('signs and verifies an account token', () => {
    const token = signAccountToken({ accountId: 42, email: 'a@b.com' }, SECRET)
    const payload = verifyToken(token, SECRET)
    expect(payload).not.toBeNull()
    expect(payload!.sub).toBe('account')
    expect((payload as Extract<TokenPayload, { sub: 'account' }>).accountId).toBe(42)
  })
})

describe('hashPassword / comparePassword', () => {
  it('hashes and correctly verifies a password', async () => {
    const hash = await hashPassword('hunter2')
    expect(hash).not.toBe('hunter2')
    expect(await comparePassword('hunter2', hash)).toBe(true)
    expect(await comparePassword('wrong', hash)).toBe(false)
  })
})
