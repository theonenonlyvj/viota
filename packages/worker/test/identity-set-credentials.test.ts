import { SELF, env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { applyD1Schema } from '../src/d1/schema'

const DB = () => (env as unknown as { DB: D1Database }).DB

async function ghostToken(cred: string, name: string): Promise<string> {
  const r = await SELF.fetch('https://example.com/auth/quick', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceCredential: cred, displayName: name }),
  })
  return ((await r.json()) as { token: string }).token
}

function setCreds(tok: string, body: unknown): Promise<Response> {
  return SELF.fetch('https://example.com/auth/set-credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
    body: JSON.stringify(body),
  })
}

describe('/auth/set-credentials', () => {
  beforeAll(async () => {
    await applyD1Schema(DB())
  })

  it('claims a username+password on the current ghost, in place', async () => {
    const tok = await ghostToken('cred-set-1111111111', 'Vee')
    const r = await setCreds(tok, { username: 'vee', password: 'hunter2' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
    const acc = await DB()
      .prepare(`SELECT status, username, display_name, password_hash, token_epoch FROM accounts WHERE username='vee'`)
      .first<{ status: string; username: string; display_name: string; password_hash: string; token_epoch: number }>()
    expect(acc!.status).toBe('claimed')
    expect(acc!.display_name).toBe('vee')
    expect(acc!.password_hash).toMatch(/^pbkdf2/)
    expect(acc!.token_epoch).toBe(1)
  })

  it('409s a taken username', async () => {
    const tok = await ghostToken('cred-set-2222222222', 'Two')
    const r = await setCreds(tok, { username: 'vee', password: 'abcdef' })
    expect(r.status).toBe(409)
    expect((await r.json()) as { error: string }).toMatchObject({ error: 'username_taken' })
  })

  it('409s if already claimed (not ghost)', async () => {
    const tok = await ghostToken('cred-set-3333333333', 'Three')
    await setCreds(tok, { username: 'three', password: 'abcdef' })
    const r = await setCreds(tok, { username: 'three2', password: 'abcdef' })
    expect(r.status).toBe(409)
    expect((await r.json()) as { error: string }).toMatchObject({ error: 'not_ghost' })
  })

  it('400s bad username/password', async () => {
    const tok = await ghostToken('cred-set-4444444444', 'Four')
    expect((await setCreds(tok, { username: 'AB', password: 'abcdef' })).status).toBe(400)
    expect((await setCreds(tok, { username: 'four', password: '123' })).status).toBe(400)
  })

  it('401s without a bearer token', async () => {
    const r = await SELF.fetch('https://example.com/auth/set-credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'nope', password: 'abcdef' }),
    })
    expect(r.status).toBe(401)
  })
})
