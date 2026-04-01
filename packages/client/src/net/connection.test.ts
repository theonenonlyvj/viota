import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createConnection, type Connection } from './connection'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  url: string
  onopen: (() => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  readyState = 0
  send = vi.fn()
  close = vi.fn()
  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }
  simulateOpen() { this.readyState = 1; this.onopen?.() }
  simulateMessage(data: object) { this.onmessage?.({ data: JSON.stringify(data) }) }
  simulateClose(code = 1006) { this.readyState = 3; this.onclose?.({ code }) }
}

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
})
afterEach(() => { vi.unstubAllGlobals() })

test('createConnection opens WebSocket with correct URL', () => {
  createConnection('http://localhost:3000', 'ABCD', 'jwt123')
  expect(MockWebSocket.instances).toHaveLength(1)
  expect(MockWebSocket.instances[0]!.url).toBe('ws://localhost:3000/rooms/ABCD?token=jwt123')
})

test('status transitions from connecting to connected on open', () => {
  const conn = createConnection('http://localhost:3000', 'ABCD', 'jwt123')
  expect(conn.status()).toBe('connecting')
  MockWebSocket.instances[0]!.simulateOpen()
  expect(conn.status()).toBe('connected')
})

test('onMessage callback receives parsed JSON', () => {
  const handler = vi.fn()
  const conn = createConnection('http://localhost:3000', 'ABCD', 'jwt123')
  conn.onMessage(handler)
  MockWebSocket.instances[0]!.simulateOpen()
  MockWebSocket.instances[0]!.simulateMessage({ type: 'welcome', playerIndex: 0 })
  expect(handler).toHaveBeenCalledWith({ type: 'welcome', playerIndex: 0 })
})

test('send serializes and sends JSON', () => {
  const conn = createConnection('http://localhost:3000', 'ABCD', 'jwt123')
  MockWebSocket.instances[0]!.simulateOpen()
  conn.send({ type: 'play', placements: [] })
  expect(MockWebSocket.instances[0]!.send).toHaveBeenCalledWith(JSON.stringify({ type: 'play', placements: [] }))
})

test('close closes the WebSocket', () => {
  const conn = createConnection('http://localhost:3000', 'ABCD', 'jwt123')
  MockWebSocket.instances[0]!.simulateOpen()
  conn.close()
  expect(MockWebSocket.instances[0]!.close).toHaveBeenCalled()
})

test('auto-reconnects on unexpected close with backoff', () => {
  vi.useFakeTimers()
  const conn = createConnection('http://localhost:3000', 'ABCD', 'jwt123')
  MockWebSocket.instances[0]!.simulateOpen()
  MockWebSocket.instances[0]!.simulateClose(1006)
  expect(conn.status()).toBe('reconnecting')
  vi.advanceTimersByTime(1000)
  expect(MockWebSocket.instances).toHaveLength(2)
  vi.useRealTimers()
})

test('does not reconnect on normal close (1000)', () => {
  vi.useFakeTimers()
  const conn = createConnection('http://localhost:3000', 'ABCD', 'jwt123')
  MockWebSocket.instances[0]!.simulateOpen()
  MockWebSocket.instances[0]!.simulateClose(1000)
  expect(conn.status()).toBe('disconnected')
  vi.advanceTimersByTime(5000)
  expect(MockWebSocket.instances).toHaveLength(1)
  vi.useRealTimers()
})
