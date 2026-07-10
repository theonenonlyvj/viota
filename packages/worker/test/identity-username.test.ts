import { describe, it, expect } from 'vitest'
import { validateUsername, slugifyUsername, validatePassword, USERNAME_RE } from '../src/identity/username'

describe('username', () => {
  it('validates the rule', () => {
    expect(validateUsername('vijay')).toBe(true)
    expect(validateUsername('ab')).toBe(false) // too short
    expect(validateUsername('Vijay')).toBe(false) // uppercase
    expect(validateUsername('has space')).toBe(false)
    expect(validateUsername('a'.repeat(21))).toBe(false)
  })
  it('slugifies display names into valid usernames', () => {
    for (const [inp, sfx] of [['Vijay Ram', ''], ['José!!', ''], ['ab', '1234'], ['👍', ''], ['   ', '9999']] as const) {
      const s = slugifyUsername(inp, sfx)
      expect(USERNAME_RE.test(s), `${inp} -> ${s}`).toBe(true)
    }
    expect(slugifyUsername('Vijay Ram')).toBe('vijay_ram')
    expect(slugifyUsername('ab', '1234').length).toBeGreaterThanOrEqual(3)
  })
  it('validates passwords', () => {
    expect(validatePassword('123456')).toBe(true)
    expect(validatePassword('12345')).toBe(false)
    expect(validatePassword('x'.repeat(129))).toBe(false)
  })
})
