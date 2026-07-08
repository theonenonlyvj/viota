/**
 * PRESSURE TEST — client NET-LAYER resilience (logic only, no UI/DOM).
 *
 * Adversarial / property / fuzz tests over the outbox + reconcile + nudge
 * subsystems. Every randomized sequence uses a SEEDED mulberry32 PRNG so a
 * failure reproduces from the printed seed. Invariants are asserted after every
 * step, not just at the end.
 *
 * Targets:
 *   src/net/online.ts     — send / postMove / drainOutbox idempotency + status classification
 *   src/net/outbox.ts     — queued/done ordering
 *   src/net/reconcile.ts  — drain-before-sync ordering, reclaim variants, queued-move survival
 *   src/net/nudge.ts      — handleServerFrame dispatch + reconnect/backoff state machine
 *
 * Constraint: a FAILURE here must mean the src is wrong, not the test.
 */
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createOnlineClient } from './net/online'
import { listQueued, enqueue } from './net/outbox'
import { runReconcile } from './net/reconcile'
import { createNudgeChannel, handleServerFrame } from './net/nudge'
import type { OnlineClient } from './net/online'
import type { ClientView, MovePayload, SyncResponse } from './net/protocol'

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) — deterministic, reproducible.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const randInt = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1))
const pick = <T,>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------
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
const move: MovePayload = { type: 'pass', trades: [], tradeOrder: [] }

type FakeRes = { ok: boolean; status: number; json: () => Promise<unknown> }
function res(status: number, body: unknown = {}): FakeRes {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
// Mirror of online.ts isRetryableStatus — the property oracle.
const isRetryable = (s: number) => s >= 500 || s === 408 || s === 429

// ===========================================================================
// (a) + (b) OUTBOX: status classification, idempotent replay, drain ordering.
// ===========================================================================
describe('outbox: status classification + idempotent drain', () => {
  let clock = 0
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    localStorage.clear()
    localStorage.setItem('viota_token', 'jwt-1')
    // Strictly-increasing createdAt so listQueued order is UNAMBIGUOUSLY insertion
    // order (createdAt ties would make "oldest-first" underspecified — not a bug).
    clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => ++clock)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // (a) A single fuzzed HTTP status is classified correctly: transient => the
  //     move STAYS queued (replayable); a permanent non-401 4xx => resolved.
  test('property: postMove leaves a move queued IFF the status is transient', async () => {
    const SEED = 0xa11ce
    const rng = mulberry32(SEED)
    // 401 excluded (that's the silent-reauth path, tested elsewhere).
    const STATUSES = [200, 400, 403, 404, 409, 422, 408, 429, 500, 502, 503, 504] as const
    for (let i = 0; i < 300; i++) {
      globalThis.indexedDB = new IDBFactory() // fresh outbox each iteration
      const status = pick(rng, STATUSES)
      const dup = status === 200 && rng() < 0.5
      const okBody = dup ? { duplicate: true, view } : { ok: true, moveIndex: 3, view }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(status, status === 200 ? okBody : { error: 'e' })))
      const client = createOnlineClient('http://sv', 'g1', 0)
      const id = `mv-${i}`
      const r = await client.postMove(move, id)
      const q = await listQueued('g1')
      const ctx = `SEED=0x${SEED.toString(16)} i=${i} status=${status}`

      if (status === 200) {
        expect(r.status, ctx).toBe(dup ? 'duplicate' : 'ok')
        expect(q, ctx).toHaveLength(0) // resolved (marked done)
      } else if (isRetryable(status)) {
        expect(r, ctx).toEqual({ status: 'queued' })
        expect(q.map((e) => e.clientMoveId), ctx).toEqual([id]) // stays for replay
      } else {
        expect(r.status, ctx).toBe('error')
        expect((r as { http: number }).http, ctx).toBe(status)
        expect(q, ctx).toHaveLength(0) // permanent → resolved, never re-sent
      }
    }
  })

  // (a) A transient failure then a later success must replay the SAME clientMoveId
  //     (the server dedups on it) — the id survives across the whole lifecycle.
  test('a transiently-failed move replays with the identical clientMoveId', async () => {
    const bodies: Array<{ clientMoveId: string; seatIndex: number }> = []
    // First attempt: transient 503.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string))
        return res(503, { error: 'overloaded' })
      }),
    )
    const client = createOnlineClient('http://sv', 'g7', 2)
    expect(await client.postMove(move, 'stable-id')).toEqual({ status: 'queued' })

    // Reconnect: drain succeeds.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string))
        return res(200, { ok: true, moveIndex: 1, view })
      }),
    )
    await client.drainOutbox()

    expect(bodies).toHaveLength(2)
    expect(bodies[0]!.clientMoveId).toBe('stable-id')
    expect(bodies[1]!.clientMoveId).toBe('stable-id') // SAME id on replay
    expect(bodies[1]!.seatIndex).toBe(2) // seat pinned for the game's life
    expect(await listQueued('g7')).toHaveLength(0)
  })

  // (b) FUZZ the core drain invariant: drain sends in order, STOPS at the first
  //     TRANSIENT failure, keeps everything from that point on queued in order,
  //     but a PERMANENT 4xx is dropped (marked done) and drain CONTINUES.
  test('property: drainOutbox stops at the first transient, preserves order, skips permanents', async () => {
    const SEED = 0xd7a1
    const rng = mulberry32(SEED)
    for (let iter = 0; iter < 120; iter++) {
      globalThis.indexedDB = new IDBFactory()
      const gameId = `g-${iter}`
      const n = randInt(rng, 1, 6)
      // Enqueue n moves offline (network reject) so they're all queued in order.
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      const client = createOnlineClient('http://sv', gameId, 0)
      const ids: string[] = []
      for (let k = 0; k < n; k++) {
        const id = `${gameId}-mv-${k}`
        ids.push(id)
        await client.postMove(move, id)
      }
      expect((await listQueued(gameId)).map((e) => e.clientMoveId)).toEqual(ids)

      // Assign each queued move a drain outcome: 2xx-ok / permanent-4xx / transient.
      const OUTCOME = ['ok', 'perm', 'transient'] as const
      const plan = ids.map(() => pick(rng, OUTCOME))
      const sent: string[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
          const body = JSON.parse(init.body as string) as { clientMoveId: string }
          sent.push(body.clientMoveId)
          const idx = ids.indexOf(body.clientMoveId)
          const o = plan[idx]!
          if (o === 'ok') return res(200, { ok: true, moveIndex: idx, view })
          if (o === 'perm') return res(409, { error: 'not_your_turn' })
          return res(503, { error: 'overloaded' }) // transient
        }),
      )
      await client.drainOutbox()

      // The first transient index bounds what got sent + what remains queued.
      const firstTransient = plan.findIndex((o) => o === 'transient')
      const ctx = `SEED=0x${SEED.toString(16)} iter=${iter} plan=${plan.join(',')}`

      if (firstTransient === -1) {
        // No transient → every move was attempted in order and fully drained.
        expect(sent, ctx).toEqual(ids)
        expect(await listQueued(gameId), ctx).toHaveLength(0)
      } else {
        // Drain sent moves 0..firstTransient (inclusive) then STOPPED, in order.
        expect(sent, ctx).toEqual(ids.slice(0, firstTransient + 1))
        // Remaining queued = the transient one + everything after, unchanged order.
        // (permanent 4xx BEFORE the transient were dropped/marked done, ok's too.)
        const stillQueued = (await listQueued(gameId)).map((e) => e.clientMoveId)
        expect(stillQueued, ctx).toEqual(ids.slice(firstTransient))
      }
    }
  })

  // A duplicate (server already applied this clientMoveId) is a 2xx → resolved,
  // never re-sent. Exercised through drainOutbox (the replay path).
  test('a duplicate response during drain marks the move done (idempotent)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const client = createOnlineClient('http://sv', 'gd', 0)
    await client.postMove(move, 'd1')
    expect((await listQueued('gd')).length).toBe(1)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { duplicate: true, view })))
    await client.drainOutbox()
    expect(await listQueued('gd')).toHaveLength(0)
  })

  // drainOutbox must be scoped per-game: a transient stall in game A never blocks
  // or touches game B's queue.
  test('drainOutbox is game-scoped — one game stalling does not drain another', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const a = createOnlineClient('http://sv', 'gA', 0)
    const b = createOnlineClient('http://sv', 'gB', 0)
    await a.postMove(move, 'a1')
    await b.postMove(move, 'b1')

    // Only game A drains (and it stalls transiently); B's queue is untouched.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(503, { error: 'x' })))
    await a.drainOutbox()
    expect((await listQueued('gA')).map((e) => e.clientMoveId)).toEqual(['a1'])
    expect((await listQueued('gB')).map((e) => e.clientMoveId)).toEqual(['b1'])
  })
})

// ===========================================================================
// (c) RECONCILE: drain-before-sync ordering + reclaim variants + survival.
// ===========================================================================
describe('reconcile ordering + reclaim variants', () => {
  afterEach(() => vi.restoreAllMocks())

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
  const order = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]

  // With reclaim, the strict global order is reclaim -> drain -> sync, and the
  // applied snapshots are reclaim-first then sync-last.
  test('withReclaim: strict reclaim < drain < sync ordering', async () => {
    const client = mockClient()
    const applied: SyncResponse[] = []
    await runReconcile({ client, getLocalIndex: () => 0, applySync: (r) => applied.push(r) }, { withReclaim: true })
    expect(order(client.reclaim)).toBeLessThan(order(client.drainOutbox)!)
    expect(order(client.drainOutbox)).toBeLessThan(order(client.sync)!)
    expect(applied).toHaveLength(2)
    expect(applied[0]).toEqual({ moveIndex: 3, snapshot: view, moves: [] }) // reclaim
    expect(applied[1]).toEqual({ moveIndex: 3, snapshot: view, moves: [] }) // sync
  })

  // A reclaim that returns null (nothing to reclaim) must NOT applySync for it —
  // only the trailing /sync snapshot is applied. Drain + sync still run.
  test('withReclaim but reclaim returns null: only the sync snapshot is applied', async () => {
    const client = mockClient({ reclaim: vi.fn().mockResolvedValue(null) })
    const applied: SyncResponse[] = []
    await runReconcile({ client, getLocalIndex: () => 0, applySync: (r) => applied.push(r) }, { withReclaim: true })
    expect(client.reclaim).toHaveBeenCalledOnce()
    expect(client.drainOutbox).toHaveBeenCalledOnce()
    expect(applied).toHaveLength(1) // no reclaim snapshot, just sync
  })

  // A reclaim that THROWS is swallowed (.catch(()=>null)); reconcile still drains
  // + syncs and does not reject.
  test('withReclaim but reclaim rejects: swallowed, drain+sync still happen', async () => {
    const client = mockClient({ reclaim: vi.fn().mockRejectedValue(new Error('boom')) })
    const applied: SyncResponse[] = []
    await expect(
      runReconcile({ client, getLocalIndex: () => 0, applySync: (r) => applied.push(r) }, { withReclaim: true }),
    ).resolves.toBeUndefined()
    expect(client.drainOutbox).toHaveBeenCalledOnce()
    expect(client.sync).toHaveBeenCalledOnce()
    expect(applied).toHaveLength(1)
  })

  // PROPERTY: for a random reconcile (with/without reclaim, reclaim null or not),
  // drain ALWAYS precedes sync, sync is called with exactly getLocalIndex(), and
  // the LAST applied snapshot is always the authoritative /sync one.
  test('property: drain always precedes sync; last applied snapshot is the sync', async () => {
    const SEED = 0x5eed
    const rng = mulberry32(SEED)
    for (let i = 0; i < 200; i++) {
      const withReclaim = rng() < 0.5
      const reclaimNull = rng() < 0.5
      const localIdx = randInt(rng, 0, 50)
      const syncRes: SyncResponse = { moveIndex: localIdx + randInt(rng, 0, 5), snapshot: { ...view, turnIndex: 1 }, moves: [] }
      const client = mockClient({
        reclaim: vi.fn().mockResolvedValue(reclaimNull ? null : { moveIndex: localIdx, snapshot: view }),
        sync: vi.fn().mockResolvedValue(syncRes),
      })
      const applied: SyncResponse[] = []
      await runReconcile({ client, getLocalIndex: () => localIdx, applySync: (r) => applied.push(r) }, { withReclaim })
      const ctx = `SEED=0x${SEED.toString(16)} i=${i} withReclaim=${withReclaim} reclaimNull=${reclaimNull}`

      expect(order(client.drainOutbox), ctx).toBeLessThan(order(client.sync)!)
      expect(client.sync, ctx).toHaveBeenCalledWith(localIdx)
      expect(applied.length, ctx).toBeGreaterThanOrEqual(1)
      expect(applied[applied.length - 1], ctx).toEqual(syncRes) // sync is authoritative + last
      if (withReclaim && !reclaimNull) expect(applied.length, ctx).toBe(2)
      else expect(applied.length, ctx).toBe(1)
    }
  })

  // A queued offline move survives reconcile: because drain runs before sync, the
  // applied snapshot is the POST-drain (higher-index) one, never the stale pre-move.
  test('property: a queued move is never reverted — post-drain snapshot wins', async () => {
    const SEED = 0xf00d
    const rng = mulberry32(SEED)
    for (let i = 0; i < 100; i++) {
      const baseIdx = randInt(rng, 0, 40)
      const pre: SyncResponse = { moveIndex: baseIdx, snapshot: view, moves: [] }
      const post: SyncResponse = { moveIndex: baseIdx + 1, snapshot: { ...view, turnIndex: 1 }, moves: [] }
      let drained = false
      const client = mockClient({
        drainOutbox: vi.fn().mockImplementation(async () => {
          drained = true
        }),
        sync: vi.fn().mockImplementation(async () => (drained ? post : pre)),
      })
      const applied: SyncResponse[] = []
      await runReconcile({ client, getLocalIndex: () => baseIdx, applySync: (r) => applied.push(r) })
      expect(applied[applied.length - 1], `SEED=0x${SEED.toString(16)} i=${i}`).toEqual(post)
    }
  })
})

// ===========================================================================
// (d) handleServerFrame dispatch — fuzz the sync-trigger + fan-out invariants.
// ===========================================================================
describe('handleServerFrame dispatch (fuzz)', () => {
  test('property: sync fires IFF (nudge with numeric index ahead) OR veto; callbacks fan out', () => {
    const SEED = 0xbeef
    const rng = mulberry32(SEED)
    for (let i = 0; i < 500; i++) {
      const sync = vi.fn()
      const onAuthOk = vi.fn()
      const onAiCover = vi.fn()
      const onVeto = vi.fn()
      const onHostChanged = vi.fn()
      const onStarted = vi.fn()
      const local = randInt(rng, 0, 20)
      const deps = { getLocalIndex: () => local, sync, onAuthOk, onAiCover, onVeto, onHostChanged, onStarted }

      // Build a random frame — sometimes malformed.
      const kind = pick(rng, [
        'nudge',
        'veto',
        'ai_cover',
        'auth_ok',
        'host_changed',
        'started',
        'garbage',
        'null',
        'notype',
        'nudge_nan',
      ] as const)
      let frame: unknown
      let mi = 0
      let seat = 0
      switch (kind) {
        case 'nudge':
          mi = randInt(rng, 0, 40)
          frame = { type: 'nudge', moveIndex: mi }
          break
        case 'nudge_nan':
          frame = { type: 'nudge', moveIndex: pick(rng, ['5', null, undefined, NaN] as const) }
          break
        case 'veto':
          seat = randInt(rng, 0, 3)
          mi = randInt(rng, 0, 40)
          frame = { type: 'veto', seat, moveIndex: mi }
          break
        case 'ai_cover':
          seat = randInt(rng, 0, 3)
          frame = { type: 'ai_cover', seat }
          break
        case 'auth_ok':
          seat = randInt(rng, 0, 3)
          frame = { type: 'auth_ok', seat }
          break
        case 'host_changed':
          seat = randInt(rng, 0, 3)
          frame = { type: 'host_changed', hostSeat: seat }
          break
        case 'started':
          mi = randInt(rng, 0, 40)
          frame = { type: 'started', moveIndex: mi }
          break
        case 'garbage':
          frame = { type: `x${randInt(rng, 0, 9)}`, foo: 1 }
          break
        case 'null':
          frame = null
          break
        case 'notype':
          frame = { moveIndex: 5 }
          break
      }

      handleServerFrame(frame as never, deps)
      const ctx = `SEED=0x${SEED.toString(16)} i=${i} kind=${kind} local=${local}`

      // sync oracle
      const expectSync =
        (kind === 'nudge' && mi > local) || kind === 'veto'
      expect(sync.mock.calls.length === 1, `${ctx} syncCalls=${sync.mock.calls.length} expect=${expectSync}`).toBe(expectSync)

      // fan-out oracle
      expect(onVeto).toHaveBeenCalledTimes(kind === 'veto' ? 1 : 0)
      if (kind === 'veto') expect(onVeto).toHaveBeenCalledWith(seat, mi)
      expect(onAiCover).toHaveBeenCalledTimes(kind === 'ai_cover' ? 1 : 0)
      if (kind === 'ai_cover') expect(onAiCover).toHaveBeenCalledWith(seat)
      expect(onAuthOk).toHaveBeenCalledTimes(kind === 'auth_ok' ? 1 : 0)
      expect(onHostChanged).toHaveBeenCalledTimes(kind === 'host_changed' ? 1 : 0)
      if (kind === 'host_changed') expect(onHostChanged).toHaveBeenCalledWith(seat)
      expect(onStarted).toHaveBeenCalledTimes(kind === 'started' ? 1 : 0)
      if (kind === 'started') expect(onStarted).toHaveBeenCalledWith(mi)
    }
  })

  test('missing optional callbacks never throw (nudge below index, unknown types)', () => {
    // deps with NO optional callbacks — only the two required fields.
    const sync = vi.fn()
    expect(() => handleServerFrame({ type: 'ai_cover', seat: 1 }, { getLocalIndex: () => 0, sync })).not.toThrow()
    expect(() => handleServerFrame({ type: 'host_changed', hostSeat: 2 }, { getLocalIndex: () => 0, sync })).not.toThrow()
    expect(() => handleServerFrame({ type: 'started', moveIndex: 0 }, { getLocalIndex: () => 0, sync })).not.toThrow()
    // veto with no onVeto still triggers sync without throwing.
    expect(() => handleServerFrame({ type: 'veto', seat: 0, moveIndex: 3 }, { getLocalIndex: () => 0, sync })).not.toThrow()
    expect(sync).toHaveBeenCalledOnce()
  })
})

// ===========================================================================
// (e) NUDGE reconnect state machine — backoff, hidden re-arm, polling, close.
// ===========================================================================
describe('nudge reconnect state machine', () => {
  let throwOnConstruct = false
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
    close = vi.fn(() => {
      this.readyState = 3
    })
    constructor(url: string) {
      if (throwOnConstruct) throw new Error('blocked')
      this.url = url
      MockWebSocket.instances.push(this)
    }
    open() {
      this.readyState = 1
      this.onopen?.()
    }
    message(obj: unknown) {
      this.onmessage?.({ data: JSON.stringify(obj) })
    }
    error() {
      this.onerror?.()
    }
    fail() {
      this.readyState = 3
      this.onclose?.()
    }
  }

  beforeEach(() => {
    MockWebSocket.instances = []
    throwOnConstruct = false
    vi.stubGlobal('WebSocket', MockWebSocket)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const live = () => MockWebSocket.instances[MockWebSocket.instances.length - 1]!

  // PROPERTY: under ANY random visibility schedule of drops + timer fires, the
  // channel NEVER dead-ends: after finally being visible + given time, a fresh
  // socket connects. And a socket is NEVER opened at the instant the timer fires
  // while hidden.
  test('property: reconnect chain never dead-ends across random hidden/visible drops', () => {
    const SEED = 0xc0ffee
    const rng = mulberry32(SEED)
    for (let iter = 0; iter < 40; iter++) {
      vi.useFakeTimers()
      MockWebSocket.instances = []
      let visible = rng() < 0.5
      const ch = createNudgeChannel('http://sv', 'g1', {
        getToken: () => 't',
        getLocalIndex: () => 0,
        sync: vi.fn(),
        isVisible: () => visible,
      })
      const ctx = `SEED=0x${SEED.toString(16)} iter=${iter}`

      // A random storm of: drop the socket, toggle visibility, advance time.
      const steps = randInt(rng, 3, 12)
      for (let s = 0; s < steps; s++) {
        const action = pick(rng, ['drop', 'toggle', 'advance'] as const)
        if (action === 'drop') {
          // Only close a socket that is still live. A real WebSocket fires onclose
          // exactly once; re-failing an already-dead mock would arm a duplicate
          // reconnect timer (a test artifact, not a code path reality reaches).
          if (MockWebSocket.instances.length && live().readyState !== 3) live().fail()
        } else if (action === 'toggle') {
          visible = !visible
        } else {
          const before = MockWebSocket.instances.length
          vi.advanceTimersByTime(pick(rng, [1000, 4000, 10_000, 30_000] as const))
          // INVARIANT: if a new socket appeared from a timer fire, the tab was
          // visible at fire-time (we never open a socket while hidden).
          if (MockWebSocket.instances.length > before && !visible) {
            throw new Error(`${ctx}: opened a socket while hidden`)
          }
        }
      }

      // Now force foreground and prove the PURE backoff chain reconnects (no
      // reopen() escape hatch). Fail the latest socket if it isn't already dead so
      // there is a freshly-armed backoff timer, then advance one full cap window:
      // it MUST fire connect() and construct a new socket. This is the anti-stall
      // guarantee — a hidden timer fire must have RE-ARMED, never dead-ended.
      visible = true
      if (live().readyState !== 3) live().fail()
      const before = MockWebSocket.instances.length
      vi.advanceTimersByTime(10_000) // >= the 10s cap → the armed backoff fires
      expect(MockWebSocket.instances.length, `${ctx}: backoff chain dead-ended, no reconnect`).toBe(before + 1)

      ch.close()
      vi.useRealTimers()
    }
  })

  // After close(), the machine is terminal: no timer, no reopen, no drop ever
  // spawns another socket.
  test('close() is terminal — no further sockets from timers or reopen', () => {
    vi.useFakeTimers()
    const ch = createNudgeChannel('http://sv', 'g1', {
      getToken: () => 't',
      getLocalIndex: () => 0,
      sync: vi.fn(),
      isVisible: () => true,
    })
    live().fail() // arm a reconnect
    ch.close()
    const n = MockWebSocket.instances.length
    vi.advanceTimersByTime(60_000)
    ch.reopen()
    vi.advanceTimersByTime(60_000)
    expect(MockWebSocket.instances.length).toBe(n) // nothing new ever
  })

  // The poll fallback pushes truth while the socket is down — but ONLY while the
  // tab is visible (a hidden tab must not poll).
  test('poll fallback syncs while visible, stays silent while hidden', () => {
    vi.useFakeTimers()
    let visible = true
    const sync = vi.fn()
    const ch = createNudgeChannel('http://sv', 'g1', {
      getToken: () => 't',
      getLocalIndex: () => 0,
      sync,
      isVisible: () => visible,
    })
    live().fail() // socket down → onclose starts polling (+ arms reconnect)
    // But immediately hide so the reconnect timer keeps re-arming and does not
    // replace the socket; the poll interval keeps ticking.
    visible = false
    sync.mockClear()
    vi.advanceTimersByTime(5_000 * 3) // three poll intervals, hidden
    expect(sync).not.toHaveBeenCalled() // hidden → no poll-sync

    visible = true
    sync.mockClear()
    vi.advanceTimersByTime(5_000) // one poll interval, visible
    expect(sync).toHaveBeenCalled()
    ch.close()
  })

  // A blocked WebSocket constructor (throws) degrades to polling instead of
  // crashing, and still arms a reconnect.
  test('a WebSocket that throws on construct degrades to polling (no crash)', () => {
    vi.useFakeTimers()
    throwOnConstruct = true
    const sync = vi.fn()
    const ch = createNudgeChannel('http://sv', 'g1', {
      getToken: () => 't',
      getLocalIndex: () => 0,
      sync,
      isVisible: () => true,
    })
    // No socket ever constructed, but polling must drive sync forward.
    expect(MockWebSocket.instances.length).toBe(0)
    vi.advanceTimersByTime(5_000)
    expect(sync).toHaveBeenCalled()
    ch.close()
  })

  // reopen() while the socket is already OPEN is a no-op (no duplicate socket).
  test('reopen() while OPEN does not spawn a duplicate socket', () => {
    const ch = createNudgeChannel('http://sv', 'g1', {
      getToken: () => 't',
      getLocalIndex: () => 0,
      sync: vi.fn(),
      isVisible: () => true,
    })
    live().open()
    live().message({ type: 'auth_ok', seat: 0 })
    const n = MockWebSocket.instances.length
    ch.reopen()
    expect(MockWebSocket.instances.length).toBe(n)
    ch.close()
  })

  // auth_ok resets backoff so the NEXT drop reconnects on the short (1s) delay,
  // not a long backed-off one — a healthy socket must not inherit stale backoff.
  test('auth_ok resets the backoff so a later drop reconnects quickly', () => {
    vi.useFakeTimers()
    const ch = createNudgeChannel('http://sv', 'g1', {
      getToken: () => 't',
      getLocalIndex: () => 0,
      sync: vi.fn(),
      isVisible: () => true,
    })
    // Burn several failed attempts to inflate the backoff exponent.
    for (let i = 0; i < 5; i++) {
      live().fail()
      vi.advanceTimersByTime(10_000)
    }
    // Now a healthy connection.
    live().open()
    live().message({ type: 'auth_ok', seat: 0 })
    const n = MockWebSocket.instances.length
    // Drop again: with backoff reset, the very next 1s tick must reconnect.
    live().fail()
    vi.advanceTimersByTime(1_000)
    expect(MockWebSocket.instances.length).toBe(n + 1)
    ch.close()
  })
})
