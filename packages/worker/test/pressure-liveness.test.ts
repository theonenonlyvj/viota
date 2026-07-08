import { SELF, env, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test'
import { it, expect, describe } from 'vitest'
import { AIAgent, type Card, type GameState } from '@viota/engine'
import { GameRepository, type SqlLike } from '../src/do/storage'
import { serializeState } from '../src/do/state-codec'
import { replay } from '../src/do/replay'
import { toMovePayload } from '../src/do/drive'
import { setTimer, rearmAlarm, hasTimer } from '../src/do/timers'
import { PRESENCE_MS } from '../src/do/constants'
import { authHeaders, createActiveGame, seedLiveGame } from './helpers'

/**
 * PRESSURE TEST — never-stall liveness + recovery (do/presence.ts,
 * do/drive.ts, do/veto.ts, game-do.ts alarm/heal/reclaim/heartbeat).
 *
 * Adversarially interleaves disconnect (silent) / reconnect (heartbeat) /
 * reclaim / veto / alarm / leave in seeded-random orders and asserts, after
 * EVERY step, the DO's core invariants:
 *   INV1  replay(initial, non-reverted moves) === persisted snapshot   (event-source truth)
 *   INV2  card conservation: multiset(grid ∪ hands ∪ drawPile) === initial, total 66, wilds 2
 *   INV3  meta.current_seat === snapshot.turnIndex                     (meta/snapshot agree)
 *   INV4  move rows are a contiguous 1..move_index run of length move_index
 *   INV5  distinct non-null client_move_ids                            (idempotency key sanity)
 *
 * Plus targeted liveness properties:
 *   (a) an ABSENT on-turn human with a present watcher is eventually covered +
 *       advanced by repeated alarm fires (never a permanent stall);
 *   (b) a CONNECTED (heartbeating) on-turn seat is NEVER auto-covered;
 *   (c) ai_takeover_ms===0 ("wait for me") arms no cover and the seat is never
 *       taken — the ONLY legitimate wait;
 *   (d) a reclaim that races an AI cover never double-moves / loses a card;
 *   (e) veto of an alarm-driven AI run rebuilds with conservation + replay intact.
 */

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

// ---- Seeded PRNG (mulberry32) — every failure is reproducible from its seed --
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

// ---- Card conservation ------------------------------------------------------
function cardKey(c: Card): string {
  return c.kind === 'wild' ? 'wild' : `r:${c.color}:${c.shape}:${c.number}`
}
/** Physical multiset across the three real zones (playedCards is tracking, not a zone). */
function multiset(gs: GameState): Map<string, number> {
  const m = new Map<string, number>()
  const add = (c: Card) => m.set(cardKey(c), (m.get(cardKey(c)) ?? 0) + 1)
  for (const c of gs.grid.values()) add(c)
  for (const hand of gs.hands) for (const c of hand) add(c)
  for (const c of gs.drawPile) add(c)
  return m
}
function totalCards(m: Map<string, number>): number {
  let t = 0
  for (const v of m.values()) t += v
  return t
}
function multisetsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}

/** Assert the full invariant bundle against live DO storage. `label` pinpoints failures. */
function assertInvariants(sql: SqlLike, label: string): void {
  const repo = new GameRepository(sql)
  const meta = repo.getMeta()
  if (!meta) return // never-initialized DO
  const snap = repo.getSnapshot()
  const initial = repo.getInitialState()
  if (!snap || !initial) return // waiting room (no deal yet)

  const rows = repo.getMovesSince(0)

  // INV1 — replay of the non-reverted log reproduces the snapshot byte-for-byte.
  expect(serializeState(replay(initial, rows)), `${label}: INV1 replay===snapshot`).toBe(serializeState(snap))

  // INV2 — card conservation (64 unique + 2 wild = 66 physical cards, always).
  const ms = multiset(snap)
  const mi = multiset(initial)
  expect(multisetsEqual(ms, mi), `${label}: INV2 multiset conserved vs initial`).toBe(true)
  expect(totalCards(ms), `${label}: INV2 total 66`).toBe(66)
  expect(ms.get('wild') ?? 0, `${label}: INV2 exactly 2 wilds`).toBe(2)

  // INV3 — meta's turn pointer agrees with the snapshot's turnIndex.
  if (meta.status !== 'waiting') {
    expect(meta.current_seat, `${label}: INV3 meta.current_seat===snapshot.turnIndex`).toBe(snap.turnIndex)
  }

  // INV4 — contiguous move indices 1..move_index (reverted rows are kept, never deleted).
  const idxs = rows.map((r) => r.move_index)
  const expected = Array.from({ length: meta.move_index }, (_, i) => i + 1)
  expect(idxs, `${label}: INV4 contiguous move_index run`).toEqual(expected)

  // INV5 — no two moves share a non-null client_move_id.
  const ids = rows.map((r) => r.client_move_id).filter((x): x is string => x != null)
  expect(new Set(ids).size, `${label}: INV5 distinct client_move_ids`).toBe(ids.length)
}

// ============================================================================
// 1. RANDOMIZED SAFETY FUZZ — invariants hold after every recovery op
// ============================================================================
describe('pressure: randomized adversarial recovery fuzz (safety invariants)', () => {
  async function runFuzz(seed: string, accounts: string[], steps: number): Promise<void> {
    const rng = mulberry32(
      [...seed].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7),
    )
    const gameId = await createActiveGame(accounts, accounts.length)
    const stub = stubFor(gameId)
    const pc = accounts.length
    const seatOf = () => Math.floor(rng() * pc)

    // Baseline invariants right after deal.
    await runInDurableObject(stub, (_i: any, state: any) =>
      assertInvariants(state.storage.sql as SqlLike, `${seed} step -1 (deal)`),
    )

    for (let step = 0; step < steps; step++) {
      const roll = rng()
      let op: string

      if (roll < 0.3) {
        // MOVE: play the engine's own legal move for the current seat (as its owner).
        op = 'move'
        const info = await runInDurableObject(stub, (_i: any, state: any) => {
          const repo = new GameRepository(state.storage.sql as SqlLike)
          const meta = repo.getMeta()
          const snap = repo.getSnapshot()
          if (!meta || meta.status !== 'active' || !snap) return null
          const seat = meta.current_seat
          const move = toMovePayload(AIAgent('medium')(snap, seat))
          return { seat, move }
        })
        if (info) {
          await SELF.fetch(`https://example.com/games/${gameId}/move`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(await authHeaders(`acct-${info.seat}`)) },
            body: JSON.stringify({ seatIndex: info.seat, move: info.move, clientMoveId: crypto.randomUUID() }),
          })
        }
      } else if (roll < 0.5) {
        // ALARM: exercise the cover/floor/drive/heal wheel.
        op = 'alarm'
        await runDurableObjectAlarm(stub)
      } else if (roll < 0.65) {
        // HEARTBEAT: a seat checks in (reconnect / stay present).
        const s = seatOf()
        op = `heartbeat:${s}`
        await SELF.fetch(`https://example.com/games/${gameId}/heartbeat`, {
          method: 'POST',
          headers: await authHeaders(`acct-${s}`),
        })
      } else if (roll < 0.77) {
        // GO SILENT: stale a seat's presence into the past (silent phone-lock).
        // Old enough that both `isSeatPresent` is false AND any last_seen-based
        // cover deadline lands in the past, so the alarm can act on it.
        const s = seatOf()
        op = `silent:${s}`
        await runInDurableObject(stub, (_i: any, state: any) => {
          const repo = new GameRepository(state.storage.sql as SqlLike)
          repo.setPresence(s, Date.now() - (PRESENCE_MS + 200_000))
        })
      } else if (roll < 0.87) {
        // RECLAIM: take a seat back from AI cover.
        const s = seatOf()
        op = `reclaim:${s}`
        await SELF.fetch(`https://example.com/games/${gameId}/reclaim`, {
          method: 'POST',
          headers: await authHeaders(`acct-${s}`),
        })
      } else if (roll < 0.95) {
        // VETO: attempt to revert the trailing AI run on a seat.
        const s = seatOf()
        op = `veto:${s}`
        await SELF.fetch(`https://example.com/games/${gameId}/veto`, {
          method: 'POST',
          headers: await authHeaders(`acct-${s}`),
        })
      } else {
        // LEAVE: intentional leave -> instant AI cover of the caller's seat.
        const s = seatOf()
        op = `leave:${s}`
        await SELF.fetch(`https://example.com/games/${gameId}/leave`, {
          method: 'POST',
          headers: await authHeaders(`acct-${s}`),
        })
      }

      // INVARIANTS after every single step.
      await runInDurableObject(stub, (_i: any, state: any) =>
        assertInvariants(state.storage.sql as SqlLike, `seed=${seed} step ${step} op=${op}`),
      )
    }
  }

  it('2-player: 40 random recovery ops, invariants after each (seed A)', async () => {
    await runFuzz('fuzz-2p-A', ['acct-0', 'acct-1'], 40)
  })

  it('2-player: 40 random recovery ops, invariants after each (seed B)', async () => {
    await runFuzz('fuzz-2p-B', ['acct-0', 'acct-1'], 40)
  })

  it('3-player: 40 random recovery ops, invariants after each (seed C)', async () => {
    await runFuzz('fuzz-3p-C', ['acct-0', 'acct-1', 'acct-2'], 40)
  })
})

// ============================================================================
// 2. LIVENESS — an absent on-turn human is ALWAYS covered + advanced (no stall)
// ============================================================================
describe('pressure: never-stall liveness across configs (repeated alarm fires)', () => {
  const TAKEOVERS = [30_000, 60_000, 120_000, 300_000]

  for (const playerCount of [2, 3, 4]) {
    for (const takeover of TAKEOVERS) {
      it(`pc=${playerCount} takeover=${takeover}: absent on-turn seat is covered + advanced`, async () => {
        const name = `liveness-${playerCount}-${takeover}`
        const stub = stubFor(name)
        const T = Date.now()
        const watcher = 1 // present human watcher (seat 0 is on turn per initGame)

        await runInDurableObject(stub, async (_i: any, state: any) => {
          const sql = state.storage.sql as SqlLike
          const { repo } = seedLiveGame(sql, { playerCount, aiSeats: [], presentSeats: [watcher], now: T })
          repo.putMeta({ ...repo.getMeta()!, ai_takeover_ms: takeover })
          // Seat 0 is on turn but silently gone: stale last_seen so its cover
          // deadline (last_seen + takeover) is already in the past.
          repo.setPresence(0, T - (PRESENCE_MS + takeover + 10_000))
          setTimer(sql, 'heal', -1, T) // give the wheel an entry to start firing
          await rearmAlarm(state, sql)
        })

        let advanced = false
        for (let i = 0; i < 24 && !advanced; i++) {
          const snap = await runInDurableObject(stub, (_i: any, state: any) => {
            const sql = state.storage.sql as SqlLike
            assertInvariants(sql, `${name} pre-fire ${i}`)
            const repo = new GameRepository(sql)
            repo.setPresence(watcher, Date.now()) // keep the watcher genuinely present
            const m = repo.getMeta()!
            return { seat: m.current_seat, status: m.status }
          })
          if (snap.seat !== 0 || snap.status !== 'active') {
            advanced = true
            break
          }
          await runDurableObjectAlarm(stub)
        }

        expect(advanced, `${name}: turn advanced or game ended within 24 alarm fires`).toBe(true)
        await runInDurableObject(stub, (_i: any, state: any) =>
          assertInvariants(state.storage.sql as SqlLike, `${name} final`),
        )
      })
    }
  }
})

// ============================================================================
// 3. NEGATIVE: a CONNECTED on-turn seat is NEVER auto-covered
// ============================================================================
describe('pressure: a connected on-turn seat is never auto-covered', () => {
  it('20 alarm fires while heartbeating keep the on-turn human in control', async () => {
    const stub = stubFor('connected-never-covered')
    const T = Date.now()
    await runInDurableObject(stub, async (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      // Seat 0 on turn AND present; seat 1 also present. A very impatient host.
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [0, 1], now: T })
      repo.putMeta({ ...repo.getMeta()!, ai_takeover_ms: 30_000 })
      setTimer(sql, 'heal', -1, T)
      await rearmAlarm(state, sql)
    })

    for (let i = 0; i < 20; i++) {
      await runInDurableObject(stub, (_i: any, state: any) => {
        const sql = state.storage.sql as SqlLike
        const repo = new GameRepository(sql)
        // The human keeps heartbeating (stays connected) on its own turn.
        repo.setPresence(0, Date.now())
        expect(repo.getSeats()[0]!.controlled_by_ai, `fire ${i}: seat 0 stays human`).toBe(false)
        expect(repo.getMeta()!.current_seat, `fire ${i}: still seat 0's turn`).toBe(0)
        expect(hasTimer(sql, 'turn', 0), `fire ${i}: no cover armed for connected seat`).toBe(false)
        assertInvariants(sql, `connected fire ${i}`)
      })
      await runDurableObjectAlarm(stub)
    }

    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const repo = new GameRepository(sql)
      expect(repo.getSeats()[0]!.controlled_by_ai).toBe(false)
      expect(repo.getMovesSince(0).length).toBe(0) // never moved for the human
    })
  })
})

// ============================================================================
// 4. THE ONLY LEGITIMATE WAIT: ai_takeover_ms===0 never covers
// ============================================================================
describe('pressure: ai_takeover_ms===0 ("wait for me") is the only permanent wait', () => {
  it('an absent on-turn wait-for-me seat is never covered no matter how many alarms fire', async () => {
    const stub = stubFor('wait-for-me-forever')
    const T = Date.now()
    await runInDurableObject(stub, async (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [1], now: T })
      repo.putMeta({ ...repo.getMeta()!, ai_takeover_ms: 0 })
      // Seat 0 on turn, silently long gone.
      repo.setPresence(0, T - (PRESENCE_MS + 500_000))
      setTimer(sql, 'heal', -1, T)
      await rearmAlarm(state, sql)
    })

    for (let i = 0; i < 20; i++) {
      await runInDurableObject(stub, (_i: any, state: any) => {
        const sql = state.storage.sql as SqlLike
        const repo = new GameRepository(sql)
        repo.setPresence(1, Date.now()) // watcher stays present the whole time
        expect(repo.getSeats()[0]!.controlled_by_ai, `fire ${i}: wait-for-me never covered`).toBe(false)
        expect(repo.getMeta()!.current_seat, `fire ${i}: turn frozen on seat 0`).toBe(0)
        expect(hasTimer(sql, 'turn', 0), `fire ${i}: no cover timer armed`).toBe(false)
        assertInvariants(sql, `wait-for-me fire ${i}`)
      })
      await runDurableObjectAlarm(stub)
    }

    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const repo = new GameRepository(sql)
      expect(repo.getSeats()[0]!.controlled_by_ai).toBe(false)
      expect(repo.getMeta()!.status).toBe('active') // still waiting, never abandoned/moved
      expect(repo.getMovesSince(0).length).toBe(0)
    })
  })
})

// ============================================================================
// 5. RECLAIM RACES AI COVER — no double-move, no card loss, replay holds
// ============================================================================
describe('pressure: reclaim racing an AI cover (E2E)', () => {
  it('reclaim BEFORE the ai_step fires: the AI never plays the returned seat', async () => {
    const gameId = await createActiveGame(['acct-0', 'acct-1'])
    const stub = stubFor(gameId)

    // Cover the on-turn seat 0 with an ai_step armed in the FUTURE so the platform
    // cannot auto-fire the drive in real time and race the reclaim (the pattern
    // alarm.test.ts uses). This deterministically reproduces "seat covered, drive
    // pending, human returns first".
    await runInDurableObject(stub, async (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const repo = new GameRepository(sql)
      repo.setPresence(1, Date.now()) // present watcher so the drive isn't frozen
      repo.setControlledByAi(0, true) // seat 0 auto-covered by AI, on turn
      setTimer(sql, 'ai_step', 0, Date.now() + 60_000) // pending drive, won't auto-fire
      await rearmAlarm(state, sql)
    })

    // The human RECLAIMS before the pending ai_step drive fires.
    const res = await SELF.fetch(`https://example.com/games/${gameId}/reclaim`, {
      method: 'POST',
      headers: await authHeaders('acct-0'),
    })
    expect(res.status).toBe(200)

    // Reclaim must have cleared the pending ai_step; firing the alarm now must NOT
    // drive the returned (human) seat 0.
    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      expect(hasTimer(sql, 'ai_step', 0), 'reclaim cleared the pending ai_step').toBe(false)
    })
    await runDurableObjectAlarm(stub)
    await runDurableObjectAlarm(stub)

    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const repo = new GameRepository(sql)
      expect(repo.getSeats()[0]!.controlled_by_ai).toBe(false)
      // No AI move was ever committed for the reclaimed seat 0.
      const seat0AiMoves = repo.getMovesSince(0).filter((r) => r.seat_index === 0 && r.by_ai)
      expect(seat0AiMoves.length).toBe(0)
      assertInvariants(sql, 'reclaim-before-drive')
    })
  })

  it('reclaim AFTER one AI move commits: the move stands once, no dupe, conservation holds', async () => {
    const gameId = await createActiveGame(['acct-0', 'acct-1'])
    const stub = stubFor(gameId)

    await runInDurableObject(stub, async (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const repo = new GameRepository(sql)
      repo.setPresence(1, Date.now())
      repo.setPresence(0, Date.now() - (PRESENCE_MS + 200_000))
      setTimer(sql, 'heal', -1, Date.now())
      await rearmAlarm(state, sql)
    })
    // Drive far enough that seat 0 is covered AND has committed exactly one AI move.
    let seat0Moves = 0
    for (let i = 0; i < 8 && seat0Moves === 0; i++) {
      await runDurableObjectAlarm(stub)
      seat0Moves = await runInDurableObject(stub, (_i: any, state: any) => {
        const repo = new GameRepository(state.storage.sql as SqlLike)
        return repo.getMovesSince(0).filter((r) => r.seat_index === 0 && r.by_ai).length
      })
    }
    expect(seat0Moves).toBe(1)

    // Human returns AFTER the AI already moved — the committed move is NOT rolled back.
    const res = await SELF.fetch(`https://example.com/games/${gameId}/reclaim`, {
      method: 'POST',
      headers: await authHeaders('acct-0'),
    })
    expect(res.status).toBe(200)

    // More alarms must not double the committed AI move.
    await runDurableObjectAlarm(stub)
    await runDurableObjectAlarm(stub)

    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const repo = new GameRepository(sql)
      expect(repo.getSeats()[0]!.controlled_by_ai).toBe(false)
      const seat0Ai = repo.getMovesSince(0).filter((r) => r.seat_index === 0 && r.by_ai)
      expect(seat0Ai.length, 'exactly one AI move stands for seat 0').toBe(1)
      assertInvariants(sql, 'reclaim-after-drive')
    })
  })
})

// ============================================================================
// 6. VETO OF AN ALARM-DRIVEN AI RUN — conservation + replay on rebuild
// ============================================================================
describe('pressure: veto of an alarm-driven AI-covered run rebuilds cleanly', () => {
  it('reverts the trailing AI move, restores card conservation, replay===snapshot', async () => {
    const gameId = await createActiveGame(['acct-0', 'acct-1'])
    const stub = stubFor(gameId)

    // Silently drop the on-turn seat 0 and drive it via the alarm until it has
    // committed exactly one AI move (turn then advances to seat 1).
    await runInDurableObject(stub, async (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const repo = new GameRepository(sql)
      repo.setPresence(1, Date.now())
      repo.setPresence(0, Date.now() - (PRESENCE_MS + 200_000))
      setTimer(sql, 'heal', -1, Date.now())
      await rearmAlarm(state, sql)
    })
    let seat0Moves = 0
    for (let i = 0; i < 8 && seat0Moves === 0; i++) {
      await runDurableObjectAlarm(stub)
      seat0Moves = await runInDurableObject(stub, (_i: any, state: any) => {
        const repo = new GameRepository(state.storage.sql as SqlLike)
        return repo.getMovesSince(0).filter((r) => r.seat_index === 0 && r.by_ai).length
      })
    }
    expect(seat0Moves).toBe(1)

    const beforeVeto = await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      assertInvariants(sql, 'pre-veto')
      const repo = new GameRepository(sql)
      return { moveIndex: repo.getMeta()!.move_index }
    })

    // Seat 0's human vetoes the AI's turn.
    const vres = await SELF.fetch(`https://example.com/games/${gameId}/veto`, {
      method: 'POST',
      headers: await authHeaders('acct-0'),
    })
    expect(vres.status).toBe(200)
    const vbody = (await vres.json()) as any
    expect(vbody.ok).toBe(true)
    expect(vbody.reverted.length).toBeGreaterThanOrEqual(1)

    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const repo = new GameRepository(sql)
      // Control is back to seat 0, the human owns it again.
      expect(repo.getMeta()!.current_seat).toBe(0)
      expect(repo.getSeats()[0]!.controlled_by_ai).toBe(false)
      // move_index stays at the max (indices unique + monotonic); the reverted row survives.
      expect(repo.getMeta()!.move_index).toBe(beforeVeto.moveIndex)
      const reverted = repo.getMovesSince(0).filter((r) => r.reverted)
      expect(reverted.length).toBeGreaterThanOrEqual(1)
      // The heavy lifting: conservation + replay after the rebuild.
      assertInvariants(sql, 'post-veto rebuild')
    })
  })
})
