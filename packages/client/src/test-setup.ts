import '@testing-library/jest-dom'

// Polyfill ResizeObserver for jsdom
globalThis.ResizeObserver = class ResizeObserver {
  private cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

// GUARDED in-memory localStorage/sessionStorage shim for the test env.
//
// Node 22+/26 ships an EXPERIMENTAL native `localStorage` that is `undefined`
// unless the process is started with `--localstorage-file`, and jsdom under this
// vitest does not override the native global — so the net-layer tests (which
// `localStorage.clear()` in beforeEach) crash. Install a real Storage only when
// the environment does not already provide a working one, so this is inert on
// Node versions where jsdom's localStorage works (never masks a real problem).
class MemoryStorage implements Storage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  removeItem(k: string) { this.m.delete(k) }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
}
function usable(s: unknown): s is Storage {
  try {
    if (!s || typeof (s as Storage).clear !== 'function') return false
    ;(s as Storage).setItem('__probe__', '1')
    ;(s as Storage).removeItem('__probe__')
    return true
  } catch {
    return false
  }
}
for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (!usable((globalThis as Record<string, unknown>)[name])) {
    Object.defineProperty(globalThis, name, { value: new MemoryStorage(), configurable: true, writable: true })
  }
}
