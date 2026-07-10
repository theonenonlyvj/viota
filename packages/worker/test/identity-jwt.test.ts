import { describe, it, expect } from 'vitest'
import { signToken } from '../src/jwt'
import { signVGamesToken, verifyAnyToken } from '../src/jwt'

const SECRET = 'test-jwt-secret-0123456789-abcdefghijklmnop'

describe('vgames jwt', () => {
  it('verifies a new vgames token with epoch/status', async () => {
    const t = await signVGamesToken({ accountId: 'acc1', status: 'claimed', epoch: 3 }, SECRET)
    const v = await verifyAnyToken(t, SECRET)
    expect(v).toMatchObject({ accountId: 'acc1', status: 'claimed', epoch: 3 })
  })
  it('still verifies a legacy viota token (epoch absent -> undefined)', async () => {
    const legacy = await signToken('accLegacy', SECRET)
    const v = await verifyAnyToken(legacy, SECRET)
    expect(v!.accountId).toBe('accLegacy')
    expect(v!.epoch).toBeUndefined()
  })
  it('rejects a bad secret', async () => {
    const t = await signVGamesToken({ accountId: 'a', status: 'ghost', epoch: 0 }, SECRET)
    expect(await verifyAnyToken(t, 'x'.repeat(40))).toBeNull()
  })
})
