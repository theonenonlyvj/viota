import { SELF, env, runInDurableObject } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { authHeaders } from './helpers'
import { applyD1Schema } from '../src/d1/schema'
import { GameRepository } from '../src/do/storage'

// ---------------------------------------------------------------------------
// PRESSURE TEST — room / host / join / start / leave lifecycle races.
//
// Subsystem: game-do.ts {handleCreateRoom, handleJoin, handleStart, handleLeave},
// do/init.ts {createWaitingRoom, dealInto}, do/presence.ts {promoteHost}.
//
// Strategy: drive the REAL authed endpoints via SELF.fetch (Worker router ->
// DO), stress weird orderings + concurrency, and assert the structural
// invariants after EVERY step of a seeded-random sequence. A seeded PRNG
// (mulberry32) makes any failure reproducible — the seed is printed in every
// assertion message.
//
// Card conservation note: a physical card lives in exactly ONE of {grid, a hand,
// drawPile}. `playedCards` is a HISTORY subset that overlaps the grid and is NOT
// counted. A wild's face value is 0 but it is still one physical card. Total
// deck = 64 unique + 2 wild = 66, ALWAYS, once dealt.
// ---------------------------------------------------------------------------

const DECK_SIZE = 66

const DB = () => (env as unknown as { DB: D1Database }).DB
function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

beforeAll(async () => {
  await applyD1Schema(DB())
})

// --- Deterministic PRNG (reproducible) -------------------------------------
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

// The server-side allowlist gate mirror (game-do.ts resolveAiTakeoverMs).
const AI_TAKEOVER_ALLOWED = [0, 30_000, 60_000, 120_000, 300_000]
const DEFAULT_AI_TAKEOVER_MS = 60_000
function resolveAiTakeoverMs(raw: number | undefined): number {
  return typeof raw === 'number' && AI_TAKEOVER_ALLOWED.includes(raw) ? raw : DEFAULT_AI_TAKEOVER_MS
}

// --- Endpoint helpers ------------------------------------------------------
async function createRoom(host: string, playerCount: number, aiTakeoverMs?: number): Promise<string> {
  const res = await SELF.fetch('https://example.com/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders(host)) },
    body: JSON.stringify({ playerCount, mode: 'multiplayer', displayName: 'Host', aiTakeoverMs }),
  })
  const b = (await res.json()) as { gameId: string }
  return b.gameId
}

async function join(gameId: string, acct: string, body: object = {}) {
  return SELF.fetch(`https://example.com/games/${gameId}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders(acct)) },
    body: JSON.stringify(body),
  })
}
async function start(gameId: string, acct: string) {
  return SELF.fetch(`https://example.com/games/${gameId}/start`, { method: 'POST', headers: await authHeaders(acct) })
}
async function leave(gameId: string, acct: string) {
  return SELF.fetch(`https://example.com/games/${gameId}/leave`, { method: 'POST', headers: await authHeaders(acct) })
}
async function heartbeat(gameId: string, acct: string) {
  return SELF.fetch(`https://example.com/games/${gameId}/heartbeat`, { method: 'POST', headers: await authHeaders(acct) })
}

type Inspection = {
  status: string
  host: number
  playerCount: number
  aiTakeoverMs: number | null
  moveIndex: number
  seats: { i: number; type: string; acct: string | null; ai: boolean }[]
  hasSnap: boolean
  hasInit: boolean
  cardTotal: number | null
  handLens: number[] | null
  initFingerprint: string | null
}

// Read the authoritative DO SQLite state (never the redacted client view).
async function inspect(gameId: string): Promise<Inspection> {
  return runInDurableObject(stubFor(gameId), (_i, state: any) => {
    const repo = new GameRepository(state.storage.sql)
    const meta = repo.getMeta()!
    const seats = repo.getSeats()
    const snap = repo.getSnapshot()
    const init = repo.getInitialState()
    return {
      status: meta.status,
      host: meta.host_seat ?? 0,
      playerCount: meta.player_count,
      aiTakeoverMs: meta.ai_takeover_ms ?? null,
      moveIndex: meta.move_index,
      seats: seats.map((s) => ({ i: s.seat_index, type: s.owner_type, acct: s.owner_account_id, ai: s.controlled_by_ai })),
      hasSnap: snap != null,
      hasInit: init != null,
      cardTotal: snap ? snap.grid.size + snap.hands.reduce((a, h) => a + h.length, 0) + snap.drawPile.length : null,
      handLens: snap ? snap.hands.map((h) => h.length) : null,
      // A stable fingerprint of the immutable deal (drawPile order + grid) so we
      // can prove initial_state never mutates once written.
      initFingerprint: init
        ? `${init.drawPile.length}:${init.grid.size}:${init.drawPile.map((c) => (c.kind === 'wild' ? 'W' : `${c.color[0]}${c.shape[0]}${c.number}`)).join(',')}`
        : null,
    }
  })
}

// The structural invariants that must hold after EVERY lifecycle step.
function assertInvariants(tag: string, s: Inspection, playerCount: number, expectedAiTakeover: number): void {
  // INV1: never more (or fewer) than playerCount seats.
  expect(s.seats.length, `${tag}: seat count == playerCount`).toBe(playerCount)
  for (let i = 0; i < s.seats.length; i++) {
    expect(s.seats[i]!.i, `${tag}: seat_index contiguous`).toBe(i)
    expect(['human', 'open', 'ai'], `${tag}: seat ${i} owner_type valid`).toContain(s.seats[i]!.type)
  }

  // INV2: a seat is never double-claimed — every non-null owner account is unique.
  const owners = s.seats.map((x) => x.acct).filter((a): a is string => a != null)
  expect(new Set(owners).size, `${tag}: no account owns two seats`).toBe(owners.length)

  // INV3: host_seat is in range and always points at a HUMAN seat (never open/ai).
  expect(s.host, `${tag}: host_seat >= 0`).toBeGreaterThanOrEqual(0)
  expect(s.host, `${tag}: host_seat < playerCount`).toBeLessThan(playerCount)
  expect(s.seats[s.host]!.type, `${tag}: host_seat points at a human`).toBe('human')

  // INV4: player_count immutable; the host's AI-takeover choice is preserved
  // through the waiting->active transition.
  expect(s.playerCount, `${tag}: player_count stable`).toBe(playerCount)
  expect(s.aiTakeoverMs, `${tag}: ai_takeover_ms preserved`).toBe(expectedAiTakeover)

  if (s.status === 'waiting') {
    // INV5: a waiting room is NEVER dealt — no immutable state, no snapshot.
    expect(s.hasInit, `${tag}: waiting room has no initial_state (never dealt)`).toBe(false)
    expect(s.hasSnap, `${tag}: waiting room has no snapshot`).toBe(false)
  } else if (s.status === 'active') {
    // INV6: an active game is dealt exactly once and conserves the 66-card deck.
    expect(s.hasInit, `${tag}: active game has initial_state`).toBe(true)
    expect(s.hasSnap, `${tag}: active game has snapshot`).toBe(true)
    expect(s.cardTotal, `${tag}: card conservation (grid+hands+draw == 66)`).toBe(DECK_SIZE)
    // No open seats survive a deal — /start fills them all with AI.
    expect(s.seats.some((x) => x.type === 'open'), `${tag}: no open seats remain after deal`).toBe(false)
  }
}

// ===========================================================================
// 1. Concurrent /join racing for the last open seats.
// ===========================================================================
describe('concurrent /join races', () => {
  it('N accounts racing for M open seats never double-claim; humans <= playerCount', async () => {
    for (const seed of [1, 7, 42, 1337, 90210]) {
      const rand = mulberry32(seed)
      const playerCount = 2 + Math.floor(rand() * 3) // 2..4
      const openSeats = playerCount - 1 // host holds seat 0
      const contenders = playerCount + 2 // more racers than seats -> some must lose
      const gameId = await createRoom('host', playerCount)

      const accts = Array.from({ length: contenders }, (_, i) => `race-${seed}-${i}`)
      const results = await Promise.all(accts.map((a) => join(gameId, a)))
      const statuses = results.map((r) => r.status)
      const won = statuses.filter((st) => st === 200).length

      const s = await inspect(gameId)
      assertInvariants(`seed=${seed} concurrent-join`, s, playerCount, DEFAULT_AI_TAKEOVER_MS)

      // Exactly openSeats accounts win a seat (the rest 409 room_full); the seated
      // set is exactly host + winners, all distinct, all in range.
      expect(won, `seed=${seed}: winners == open seats`).toBe(openSeats)
      const humanSeats = s.seats.filter((x) => x.type === 'human')
      expect(humanSeats.length, `seed=${seed}: humans == 1 host + winners`).toBe(1 + openSeats)
      expect(humanSeats.length, `seed=${seed}: humans never exceed playerCount`).toBeLessThanOrEqual(playerCount)
    }
  })

  it('two accounts racing the SAME explicit seatIndex: exactly one wins', async () => {
    for (const seed of [3, 11, 55]) {
      const gameId = await createRoom('host', 4, 30_000)
      const target = 2
      const [rA, rB] = await Promise.all([join(gameId, `x-${seed}-A`, { seatIndex: target }), join(gameId, `x-${seed}-B`, { seatIndex: target })])
      const okCount = [rA, rB].filter((r) => r.status === 200).length
      expect(okCount, `seed=${seed}: exactly one wins the explicit seat`).toBe(1)
      const s = await inspect(gameId)
      assertInvariants(`seed=${seed} explicit-race`, s, 4, 30_000)
      const owners = s.seats[target]!.acct
      expect(owners, `seed=${seed}: the contested seat has exactly one owner`).toMatch(/^x-\d+-[AB]$/)
    }
  })
})

// ===========================================================================
// 2. Concurrent / rapid /start — exactly one deal, never re-dealt.
// ===========================================================================
describe('concurrent /start races', () => {
  it('rapid concurrent /start from the host deals exactly once (conservation holds)', async () => {
    for (const seed of [2, 9, 77, 2024]) {
      const rand = mulberry32(seed)
      const playerCount = 2 + Math.floor(rand() * 3)
      const aiMs = AI_TAKEOVER_ALLOWED[Math.floor(rand() * AI_TAKEOVER_ALLOWED.length)]!
      const gameId = await createRoom('host', playerCount, aiMs)
      // Seat a second human so /start is legal.
      await join(gameId, `p1-${seed}`)

      const fires = 4
      const results = await Promise.all(Array.from({ length: fires }, () => start(gameId, 'host')))
      const oks = results.filter((r) => r.status === 200).length
      expect(oks, `seed=${seed}: every concurrent start that saw 'waiting' succeeds (>=1)`).toBeGreaterThanOrEqual(1)

      const s = await inspect(gameId)
      assertInvariants(`seed=${seed} concurrent-start`, s, playerCount, aiMs)
      expect(s.status, `seed=${seed}: game is active after start`).toBe('active')
      // A fresh deal: every seat holds exactly 4 cards, no move has been made,
      // and the immutable deal was written once (fingerprint present + stable).
      expect(s.handLens, `seed=${seed}: each seat dealt 4 cards`).toEqual(Array(playerCount).fill(4))
      expect(s.moveIndex, `seed=${seed}: opening seat 0 is the human host -> no AI move yet`).toBe(0)

      // Fire one MORE start after the fact: must NOT re-deal (idempotent 409/no-op)
      // and the immutable fingerprint must be byte-identical.
      const fp1 = s.initFingerprint
      const late = await start(gameId, 'host')
      expect(late.status, `seed=${seed}: a start on an active game is rejected 409`).toBe(409)
      const s2 = await inspect(gameId)
      expect(s2.initFingerprint, `seed=${seed}: initial_state is immutable across a re-start`).toBe(fp1)
      expect(s2.cardTotal, `seed=${seed}: conservation survives a re-start attempt`).toBe(DECK_SIZE)
    }
  })

  it('/start with < 2 humans is rejected and never deals', async () => {
    const gameId = await createRoom('host', 3, 60_000)
    const res = await start(gameId, 'host') // only the host is human
    expect(res.status).toBe(409)
    const s = await inspect(gameId)
    assertInvariants('lonely-start', s, 3, 60_000)
    expect(s.status).toBe('waiting')
    expect(s.hasInit).toBe(false)
  })
})

// ===========================================================================
// 3. /join after the game is already active -> 409 not_waiting.
// ===========================================================================
describe('/join after go-live', () => {
  it('rejects a join once the room has been started (still conserves cards)', async () => {
    const gameId = await createRoom('host', 3, 120_000)
    await join(gameId, 'joiner-1')
    await start(gameId, 'host')
    const before = await inspect(gameId)

    const late = await join(gameId, 'latecomer')
    expect(late.status, 'join after active -> 409 not_waiting').toBe(409)

    const after = await inspect(gameId)
    assertInvariants('join-after-active', after, 3, 120_000)
    // The late join changed NOTHING: same seats, same deal.
    expect(after.seats, 'roster unchanged by a rejected late join').toEqual(before.seats)
    expect(after.initFingerprint).toBe(before.initFingerprint)
    expect(after.cardTotal).toBe(DECK_SIZE)
  })

  it('an already-seated human who re-joins an active game gets ITS OWN seat back, not 409 (fix: invite link resumes a started game)', async () => {
    const gameId = await createRoom('host', 2, 60_000)
    await join(gameId, 'p1')
    await start(gameId, 'host')
    const before = await inspect(gameId)

    // p1 is already seated AND the game is active -> the idempotent-seat
    // shortcut now fires BEFORE the not_waiting guard, so p1 re-enters the
    // game it's already in (e.g. clicking the invite link back in) instead of
    // being rejected.
    const res = await join(gameId, 'p1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.seatIndex).toBe(1) // p1's own seat, not a fresh one
    expect(body.status).toBe('active')
    expect(body.room).toBeNull()

    // Nothing about the live game changed — this is a read-only re-entry.
    const after = await inspect(gameId)
    expect(after.status).toBe('active')
    expect(after.seats).toEqual(before.seats)
    expect(after.initFingerprint).toBe(before.initFingerprint)
    expect(after.cardTotal).toBe(DECK_SIZE)
  })
})

// ===========================================================================
// 4. Chained host-leaves — host promotion stays coherent.
// ===========================================================================
describe('chained host leaves in a waiting room', () => {
  it('every host-leave leaves host_seat on a human; a survivor can still start', async () => {
    for (const seed of [4, 8, 15, 16, 23]) {
      const rand = mulberry32(seed)
      const playerCount = 3 + Math.floor(rand() * 2) // 3..4 (need room to chain)
      const gameId = await createRoom('host', playerCount)
      const joiners = Array.from({ length: playerCount - 1 }, (_, i) => `j-${seed}-${i}`)
      for (const j of joiners) await join(gameId, j)

      // All seats human now. Leave the CURRENT host repeatedly and re-check.
      const seatedAccts = ['host', ...joiners]
      const left = new Set<string>()
      for (let k = 0; k < playerCount - 1; k++) {
        const cur = await inspect(gameId)
        const hostAcct = cur.seats[cur.host]!.acct!
        const res = await leave(gameId, hostAcct)
        expect(res.status, `seed=${seed} step ${k}: host leave ok`).toBe(200)
        left.add(hostAcct)

        const s = await inspect(gameId)
        assertInvariants(`seed=${seed} chained-leave step ${k}`, s, playerCount, DEFAULT_AI_TAKEOVER_MS)
        // The new host must be a DIFFERENT, still-present-in-roster human seat.
        expect(s.seats[s.host]!.type, `seed=${seed}: promoted host is human`).toBe('human')
        // Owners are preserved on leave (seat stays owned + reclaimable).
        const stillOwned = s.seats.map((x) => x.acct).filter((a): a is string => a != null)
        for (const a of seatedAccts) expect(stillOwned, `seed=${seed}: seat still owned by ${a}`).toContain(a)
      }

      // A remaining human (someone who never left) can start the game.
      const survivor = seatedAccts.find((a) => !left.has(a))!
      const s3 = await inspect(gameId)
      const hostAcct = s3.seats[s3.host]!.acct!
      // Only the host may start; if the survivor is not the host, the host acct
      // (possibly AI-covered but still owner) is what /start authorizes. Start via
      // whoever currently holds the host role.
      const started = await start(gameId, hostAcct)
      expect(started.status, `seed=${seed}: the current host can start (survivor=${survivor})`).toBe(200)
      const s4 = await inspect(gameId)
      assertInvariants(`seed=${seed} chained-leave started`, s4, playerCount, DEFAULT_AI_TAKEOVER_MS)
      expect(s4.status).toBe('active')
      expect(s4.cardTotal).toBe(DECK_SIZE)
    }
  })
})

// ===========================================================================
// 5. Interleaved /join and /start (a joiner races the deal).
// ===========================================================================
describe('join racing the start', () => {
  it('a join concurrent with start either lands before the deal or is rejected — never corrupts the roster', async () => {
    for (const seed of [5, 50, 500]) {
      const gameId = await createRoom('host', 4, 60_000)
      await join(gameId, `seed1-${seed}`) // guarantee >=2 humans so start is legal
      // Fire a late joiner concurrently with the host's start.
      const [joinRes, startRes] = await Promise.all([join(gameId, `late-${seed}`), start(gameId, 'host')])

      const s = await inspect(gameId)
      assertInvariants(`seed=${seed} join-vs-start`, s, 4, 60_000)

      // Whatever the interleaving, the game is coherent:
      if (startRes.status === 200) {
        expect(s.status).toBe('active')
        expect(s.cardTotal).toBe(DECK_SIZE)
        // If the late join won the race (200), it must own a real seat; if it lost
        // (409 not_waiting) it must NOT appear in the roster.
        const lateOwned = s.seats.some((x) => x.acct === `late-${seed}`)
        expect(lateOwned, `seed=${seed}: late join presence matches its result`).toBe(joinRes.status === 200)
      }
    }
  })
})

// ===========================================================================
// 6. SEEDED LIFECYCLE FUZZ — random op sequence, invariants after each step.
// ===========================================================================
describe('seeded lifecycle fuzz', () => {
  const SEEDS = [111, 222, 333, 444, 555, 987654, 20260708]
  for (const seed of SEEDS) {
    it(`survives a random join/leave/heartbeat/start sequence (seed=${seed})`, async () => {
      const rand = mulberry32(seed)
      const playerCount = 2 + Math.floor(rand() * 3) // 2..4
      const aiMs = AI_TAKEOVER_ALLOWED[Math.floor(rand() * AI_TAKEOVER_ALLOWED.length)]!
      const expectedAi = resolveAiTakeoverMs(aiMs)
      const gameId = await createRoom('host', playerCount, aiMs)

      // Account pool: host + extra candidates (more than seats, to exercise
      // room_full + join-after-active rejections).
      const pool = ['host', ...Array.from({ length: playerCount + 2 }, (_, i) => `f-${seed}-${i}`)]

      let dealtFingerprint: string | null = null
      let everActive = false

      const OPS = 24
      for (let step = 0; step < OPS; step++) {
        const roll = rand()
        const who = pool[Math.floor(rand() * pool.length)]!
        const tag = `seed=${seed} step=${step}`

        if (roll < 0.4) {
          await join(gameId, who, rand() < 0.3 ? { seatIndex: Math.floor(rand() * (playerCount + 1)) } : {})
        } else if (roll < 0.6) {
          await leave(gameId, who)
        } else if (roll < 0.8) {
          await heartbeat(gameId, who)
        } else {
          // Attempt a start via whoever currently holds the host role (the only
          // account allowed to start), regardless of the random `who`.
          const cur = await inspect(gameId)
          const hostAcct = cur.seats[cur.host]!.acct
          if (hostAcct) await start(gameId, hostAcct)
        }

        const s = await inspect(gameId)
        assertInvariants(tag, s, playerCount, expectedAi)

        // Monotonic lifecycle + immutable deal: once active, stays active and the
        // initial_state fingerprint never changes.
        if (s.status === 'active') {
          if (!everActive) {
            everActive = true
            dealtFingerprint = s.initFingerprint
          }
          expect(s.initFingerprint, `${tag}: initial_state immutable once dealt`).toBe(dealtFingerprint)
          expect(s.cardTotal, `${tag}: conservation while active`).toBe(DECK_SIZE)
        }
        if (everActive) {
          expect(s.status, `${tag}: an active game never reverts to waiting`).not.toBe('waiting')
        }
      }
    })
  }
})
