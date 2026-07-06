import { env, runInDurableObject } from 'cloudflare:test'
import { it, expect } from 'vitest'
import { initGame } from '@viota/engine'

it('engine bundles and runs in the workerd runtime', () => {
  expect(initGame(2).drawPile.length).toBe(57)
})

it('engine runs inside a Durable Object', async () => {
  const id = env.GAME_DO.idFromName('smoke')
  const stub = env.GAME_DO.get(id)
  const n = await runInDurableObject(stub, (instance: any) => instance.ping())
  expect(n).toBe(57)
})
