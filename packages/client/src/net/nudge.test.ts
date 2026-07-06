import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createNudgeChannel, handleServerFrame } from './nudge'

// ---- pure frame dispatch ---------------------------------------------------

test('a nudge ahead of the local index triggers a sync', () => {
  const sync = vi.fn()
  handleServerFrame({ type: 'nudge', moveIndex: 5 }, { getLocalIndex: () => 3, sync })
  expect(sync).toHaveBeenCalledOnce()
})

test('a nudge at or below the local index does NOT sync', () => {
  const sync = vi.fn()
  handleServerFrame({ type: 'nudge', moveIndex: 3 }, { getLocalIndex: () => 3, sync })
  handleServerFrame({ type: 'nudge', moveIndex: 1 }, { getLocalIndex: () => 3, sync })
  expect(sync).not.toHaveBeenCalled()
})

test('host_changed fans out to onHostChanged', () => {
  const onHostChanged = vi.fn()
  handleServerFrame({ type: 'host_changed', hostSeat: 2 }, { getLocalIndex: () => 0, sync: vi.fn(), onHostChanged })
  expect(onHostChanged).toHaveBeenCalledWith(2)
})

test('started fans out to onStarted', () => {
  const onStarted = vi.fn()
  handleServerFrame({ type: 'started', moveIndex: 0 }, { getLocalIndex: () => 0, sync: vi.fn(), onStarted })
  expect(onStarted).toHaveBeenCalledWith(0)
})

test('ai_cover and veto fan out to their callbacks; veto re-syncs', () => {
  const sync = vi.fn()
  const onAiCover = vi.fn()
  const onVeto = vi.fn()
  handleServerFrame({ type: 'ai_cover', seat: 1 }, { getLocalIndex: () => 0, sync, onAiCover, onVeto })
  handleServerFrame({ type: 'veto', seat: 0, moveIndex: 9 }, { getLocalIndex: () => 0, sync, onAiCover, onVeto })
  expect(onAiCover).toHaveBeenCalledWith(1)
  expect(onVeto).toHaveBeenCalledWith(0, 9)
  expect(sync).toHaveBeenCalledOnce() // from the veto
})

// ---- channel lifecycle (mock WebSocket) ------------------------------------

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static OPEN = 1
  url: string
  readyState = 0
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn()
  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }
  open() { this.readyState = 1; this.onopen?.() }
  message(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }) }
  fail() { this.readyState = 3; this.onclose?.() }
}

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('opens ws to /socket (token NOT in URL) and sends the auth frame on open', () => {
  createNudgeChannel('http://sv', 'g1', {
    getToken: () => 'jwt-9',
    getLocalIndex: () => 0,
    sync: vi.fn(),
    isVisible: () => true,
  })
  const ws = MockWebSocket.instances[0]!
  expect(ws.url).toBe('ws://sv/games/g1/socket')
  expect(ws.url).not.toContain('jwt-9') // token never in the URL
  ws.open()
  expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'auth', token: 'jwt-9' }))
})

test('a nudge over the live socket triggers sync', () => {
  const sync = vi.fn()
  createNudgeChannel('http://sv', 'g1', { getToken: () => 't', getLocalIndex: () => 2, sync, isVisible: () => true })
  const ws = MockWebSocket.instances[0]!
  ws.open()
  ws.message({ type: 'auth_ok', seat: 0 })
  ws.message({ type: 'nudge', moveIndex: 4 })
  expect(sync).toHaveBeenCalledOnce()
})

test('reconnects with infinite (capped) backoff — no give-up after many drops', () => {
  vi.useFakeTimers()
  createNudgeChannel('http://sv', 'g1', { getToken: () => 't', getLocalIndex: () => 0, sync: vi.fn(), isVisible: () => true })
  // Drop and reconnect far more than the old MAX_RETRIES=5.
  for (let i = 0; i < 8; i++) {
    MockWebSocket.instances[MockWebSocket.instances.length - 1]!.fail()
    vi.advanceTimersByTime(10_000) // >= the 10s cap always fires the next attempt
  }
  expect(MockWebSocket.instances.length).toBeGreaterThan(6)
})
