import { env, createExecutionContext, waitOnExecutionContext, runInDurableObject } from 'cloudflare:test'
import { it, expect } from 'vitest'
import worker from '../src/index'

it('Worker fetch() returns 503 when JWT_SECRET is missing/short/default', async () => {
  for (const bad of [undefined, '', 'short', 'dev-secret-change-in-production', 'insecure-dev-placeholder']) {
    const ctx = createExecutionContext()
    const res = await worker.fetch(
      new Request('https://example.com/'),
      { ...env, JWT_SECRET: bad } as any,
      ctx,
    )
    await waitOnExecutionContext(ctx)
    expect(res.status, `secret=${JSON.stringify(bad)}`).toBe(503)
  }
})

it('Worker fetch() proceeds (not 503) with a valid 32+ byte secret', async () => {
  const ctx = createExecutionContext()
  const res = await worker.fetch(
    new Request('https://example.com/'),
    { ...env, JWT_SECRET: 'x'.repeat(40) } as any,
    ctx,
  )
  await waitOnExecutionContext(ctx)
  expect(res.status).not.toBe(503)
  expect(res.status).toBe(200)
})

it('GameDO.fetch() also fail-closes on a bad secret (defense in depth)', async () => {
  const stub = env.GAME_DO.get(env.GAME_DO.idFromName('guard-do'))
  // Drive the DO fetch with an env that has a short secret by overriding this.env.
  const status = await runInDurableObject(stub, async (instance: any) => {
    instance.env = { ...instance.env, JWT_SECRET: 'short' }
    const res = await instance.fetch(new Request('https://do/'))
    return res.status
  })
  expect(status).toBe(503)
})
