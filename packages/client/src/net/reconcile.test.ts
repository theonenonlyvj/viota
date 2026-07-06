import { afterEach, expect, test, vi } from 'vitest'
import { attachForegroundReconcile, runReconcile } from './reconcile'
import type { OnlineClient } from './online'
import type { ClientView, SyncResponse } from './protocol'

const view: ClientView = {
  grid: [],
  mySeat: 0,
  myHand: [],
  handCounts: [4, 4],
  drawPileCount: 50,
  scores: [0, 0],
  turnIndex: 0,
  playedCards: [],
  consecutivePasses: 0,
  finished: false,
}

function mockClient(over: Partial<OnlineClient> = {}): OnlineClient {
  return {
    gameId: 'g1',
    seatIndex: 0,
    sync: vi.fn().mockResolvedValue({ moveIndex: 3, snapshot: view, moves: [] } as SyncResponse),
    postMove: vi.fn(),
    drainOutbox: vi.fn().mockResolvedValue(undefined),
    heartbeat: vi.fn(),
    reclaim: vi.fn().mockResolvedValue({ moveIndex: 3, snapshot: view }),
    veto: vi.fn(),
    ...over,
  } as OnlineClient
}

afterEach(() => vi.restoreAllMocks())

test('runReconcile syncs (replace) then drains the outbox', async () => {
  const client = mockClient()
  const applySync = vi.fn()
  await runReconcile({ client, getLocalIndex: () => 2, applySync })
  expect(client.sync).toHaveBeenCalledWith(2)
  expect(applySync).toHaveBeenCalledWith({ moveIndex: 3, snapshot: view, moves: [] })
  expect(client.drainOutbox).toHaveBeenCalledOnce()
  expect(client.reclaim).not.toHaveBeenCalled()
})

test('runReconcile with withReclaim reclaims first, then syncs + drains', async () => {
  const client = mockClient()
  const applySync = vi.fn()
  await runReconcile({ client, getLocalIndex: () => 0, applySync }, { withReclaim: true })
  expect(client.reclaim).toHaveBeenCalledOnce()
  // reclaim snapshot applied, then the /sync snapshot applied
  expect(applySync).toHaveBeenCalledTimes(2)
  expect(client.drainOutbox).toHaveBeenCalledOnce()
})

test('attachForegroundReconcile fires on visible / pageshow / online and cleans up', () => {
  const handler = vi.fn()
  const cleanup = attachForegroundReconcile(handler)

  window.dispatchEvent(new Event('pageshow'))
  window.dispatchEvent(new Event('online'))
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true })) // bubbles to window; jsdom visibilityState defaults 'visible'

  expect(handler).toHaveBeenCalledWith('pageshow')
  expect(handler).toHaveBeenCalledWith('online')
  expect(handler).toHaveBeenCalledWith('visible')

  cleanup()
  handler.mockClear()
  window.dispatchEvent(new Event('pageshow'))
  expect(handler).not.toHaveBeenCalled()
})
