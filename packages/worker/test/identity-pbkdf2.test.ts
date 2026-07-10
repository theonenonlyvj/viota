import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, needsRehash, PBKDF2_ITERS } from '../src/identity/pbkdf2'

describe('pbkdf2', () => {
  it('round-trips a password', async () => {
    const phc = await hashPassword('hunter2')
    expect(phc).toMatch(/^pbkdf2-sha256\$i=\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
    expect(await verifyPassword('hunter2', phc)).toBe(true)
    expect(await verifyPassword('wrong', phc)).toBe(false)
  })
  it('uses distinct salts', async () => {
    expect(await hashPassword('x')).not.toBe(await hashPassword('x'))
  })
  it('honors iteration count and flags rehash', async () => {
    const weak = await hashPassword('x', 210000)
    expect(await verifyPassword('x', weak)).toBe(true) // still verifies at lower i
    expect(needsRehash(weak, PBKDF2_ITERS)).toBe(true)
    const strong = await hashPassword('x', PBKDF2_ITERS)
    expect(needsRehash(strong, PBKDF2_ITERS)).toBe(false)
  })
  it('rejects malformed PHC', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false)
  })
})
