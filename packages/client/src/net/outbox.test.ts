import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, expect, test } from 'vitest'
import { enqueue, listQueued, markDone } from './outbox'
import type { MovePayload } from './protocol'

beforeEach(() => {
  // Fresh in-memory IndexedDB per test.
  globalThis.indexedDB = new IDBFactory()
})

const move: MovePayload = { type: 'pass', trades: [], tradeOrder: [] }

test('enqueue adds a queued row visible to listQueued', async () => {
  await enqueue({ clientMoveId: 'm1', gameId: 'g1', seatIndex: 0, move })
  const q = await listQueued('g1')
  expect(q).toHaveLength(1)
  expect(q[0]!.clientMoveId).toBe('m1')
  expect(q[0]!.status).toBe('queued')
})

test('markDone removes a move from the queued list', async () => {
  await enqueue({ clientMoveId: 'm1', gameId: 'g1', seatIndex: 0, move })
  await markDone('m1')
  expect(await listQueued('g1')).toHaveLength(0)
})

test('listQueued is scoped to a game and ordered oldest-first', async () => {
  await enqueue({ clientMoveId: 'a', gameId: 'g1', seatIndex: 0, move })
  await enqueue({ clientMoveId: 'b', gameId: 'g1', seatIndex: 0, move })
  await enqueue({ clientMoveId: 'c', gameId: 'g2', seatIndex: 0, move })
  const q = await listQueued('g1')
  expect(q.map((e) => e.clientMoveId)).toEqual(['a', 'b'])
})

test('enqueue is idempotent on the same clientMoveId', async () => {
  await enqueue({ clientMoveId: 'm1', gameId: 'g1', seatIndex: 0, move })
  await enqueue({ clientMoveId: 'm1', gameId: 'g1', seatIndex: 0, move })
  expect(await listQueued('g1')).toHaveLength(1)
})
