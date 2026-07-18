import { describe, it, expect } from 'vitest'
import { verifyToken, verifyAnyToken } from '../src/jwt'
import { verifyAdminToken } from '../src/identity/admin'
import tokenContract from './fixtures/token-contract.json'

/**
 * A7 — the token-fixture contract. `test/fixtures/token-contract.json` is a
 * CHECKED-IN, deterministically-generated set of tokens (see
 * `scripts/generate-token-contract.ts`) covering the full claim-shape matrix
 * viota-worker's verify layer must handle: legacy viota, vgames+epoch,
 * expired, wrong-audience, and admin. This suite asserts EVERY verifier's
 * verdict against EVERY fixture — not just the "happy path" pairing — so a
 * claim-shape change (a renamed field, a widened/narrowed audience allowlist,
 * an accidentally-shared secret) fails HERE first.
 *
 * Step 3 copies this JSON verbatim into the hub repo, where the identity
 * service's own tests consume it the same way — the OPS-RUNBOOK rule is that
 * a JWT claim change is a two-repo change gated by this fixture (deploy-both
 * is no longer just a convention, it's executable).
 */

type Verdict = 'valid' | 'invalid'
type Fixture = {
  description: string
  token: string
  expect: { verifyToken: Verdict; verifyAnyToken: Verdict; verifyAdminToken: Verdict }
}

const { secret, adminSecret, fixtures } = tokenContract as {
  secret: string
  adminSecret: string
  fixtures: Record<'legacyViota' | 'vgamesEpoch' | 'expired' | 'wrongAud' | 'admin', Fixture>
}

function adminRequest(token: string): Request {
  return new Request('https://x/admin/merge', { headers: { authorization: `Bearer ${token}` } })
}

describe('token-fixture contract (A7)', () => {
  for (const [name, fixture] of Object.entries(fixtures)) {
    describe(`${name} — ${fixture.description}`, () => {
      it(`verifyToken: ${fixture.expect.verifyToken}`, async () => {
        const result = await verifyToken(fixture.token, secret)
        expect(result !== null, `verifyToken(${name})`).toBe(fixture.expect.verifyToken === 'valid')
      })

      it(`verifyAnyToken: ${fixture.expect.verifyAnyToken}`, async () => {
        const result = await verifyAnyToken(fixture.token, secret)
        expect(result !== null, `verifyAnyToken(${name})`).toBe(fixture.expect.verifyAnyToken === 'valid')
      })

      it(`verifyAdminToken: ${fixture.expect.verifyAdminToken}`, async () => {
        const result = await verifyAdminToken(adminRequest(fixture.token), { ADMIN_JWT_SECRET: adminSecret })
        expect(result !== null, `verifyAdminToken(${name})`).toBe(fixture.expect.verifyAdminToken === 'valid')
      })
    })
  }

  it('a player-facing verifier NEVER accepts a token signed with the admin secret (cross-secret isolation)', async () => {
    const admin = fixtures.admin
    expect(await verifyToken(admin.token, adminSecret)).toBeNull() // wrong iss/aud anyway, but prove secret alone isn't enough
    expect(await verifyAnyToken(admin.token, secret)).toBeNull() // right secret, wrong iss/aud
  })

  it('the admin verifier NEVER accepts a player-facing token, even with the right secret swapped in', async () => {
    const legacy = fixtures.legacyViota
    const vgames = fixtures.vgamesEpoch
    expect(await verifyAdminToken(adminRequest(legacy.token), { ADMIN_JWT_SECRET: secret })).toBeNull()
    expect(await verifyAdminToken(adminRequest(vgames.token), { ADMIN_JWT_SECRET: secret })).toBeNull()
  })

  it('carries the accountId/epoch/status the app actually reads (not just pass/fail)', async () => {
    const legacy = await verifyAnyToken(fixtures.legacyViota.token, secret)
    expect(legacy).toMatchObject({ accountId: 'fixture-legacy-account-0001', epoch: undefined })

    const vgames = await verifyAnyToken(fixtures.vgamesEpoch.token, secret)
    expect(vgames).toMatchObject({ accountId: 'fixture-vgames-account-0002', epoch: 3, status: 'claimed' })

    const admin = await verifyAdminToken(adminRequest(fixtures.admin.token), { ADMIN_JWT_SECRET: adminSecret })
    expect(admin).toMatchObject({ sub: 'fixture-admin-operator-0003' })
  })
})
