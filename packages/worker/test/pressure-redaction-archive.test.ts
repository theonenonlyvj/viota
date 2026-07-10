/**
 * PRESSURE TEST — hidden-information redaction + D1 archive round-trip.
 *
 * Subsystem: do/view.ts (buildClientView), do/client-move.ts (toClientMove),
 * do/apply.ts (the ClientView it returns), game-do.ts handleSync, and the D1
 * archive path (do/archive.ts + d1/schema.ts) with do/replay.ts.
 *
 * Two families of adversarial property tests, all SEEDED (mulberry32) so any
 * failure reproduces from the printed BASE_SEED:
 *
 *  (A) REDACTION FUZZ — drive many random games (2..4 seats) through the REAL
 *      authoritative pipeline (applyAndPersist inside transactionSync), injecting
 *      AI covers, wild_recycles and bounded vetos. After EVERY step, for EVERY
 *      seat, assert the /sync snapshot view + the move-result view + the /sync
 *      moves log NEVER leak another seat's hand cards (counts only), NEVER expose
 *      the ordered drawPile (count only), NEVER surface a pass's traded cards, and
 *      NEVER carry initial_state. Physical-card conservation (66) is asserted at
 *      every step. A subset is re-checked over the true HTTP GET /sync wire.
 *
 *  (B) ARCHIVE ROUND-TRIP — drive a full game to terminal (incl. an AI cover and
 *      a veto), write through to D1, then assert replay(DO initial_state, the
 *      D1-archived non-reverted moves) reconstructs a state BYTE-IDENTICAL to the
 *      DO's terminal snapshot, and the archived winner/outcome/scores match.
 *
 * A wild's face value is 0 but it is still ONE physical card: 64 unique regulars
 * + 2 wilds = 66. Conservation counts grid cells + every hand card + drawPile.
 */
import { env, runInDurableObject } from 'cloudflare:test'
import { it, expect, describe, beforeAll } from 'vitest'
import {
  posKey,
  validatePlay,
  validateWildRecycle,
  type Card,
  type GameState,
  type Placement,
  type Position,
  type RegularCard,
} from '@viota/engine'
import { GameRepository, type SqlLike, type MoveRow } from '../src/do/storage'
import { applyAndPersist } from '../src/do/apply'
import { buildClientView } from '../src/do/view'
import { toClientMove } from '../src/do/client-move'
import { performVeto } from '../src/do/veto'
import { replay } from '../src/do/replay'
import { serializeState } from '../src/do/state-codec'
import type { MovePayload } from '../src/do/moves'
import { flushGameCreate, winnerSeatOf, type GameArchiveRow } from '../src/do/archive'
import { seedLiveGame, authHeaders } from './helpers'

// The whole run is reproducible from this one number (override via SEED env).
const BASE_SEED = Number(process.env.SEED ?? 0xc0ffee)
const DB = () => (env as unknown as { DB: D1Database }).DB
const stubFor = (name: string) => env.GAME_DO.get(env.GAME_DO.idFromName(name))

// ---- seeded PRNG -----------------------------------------------------------
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
const gameSeed = (g: number) => (BASE_SEED + g * 0x9e3779b1) >>> 0

// ---- invariants / assertions ----------------------------------------------

const CARD_TOTAL = 66 // 64 unique regulars + 2 wilds
const CLIENT_VIEW_KEYS = [
  'consecutivePasses', 'drawPileCount', 'finished', 'grid', 'handCounts',
  'myHand', 'mySeat', 'playedCards', 'players', 'scores', 'turnIndex',
].sort()
// Keys that must NEVER appear ANYWHERE in a client-reachable payload.
const FORBIDDEN_KEYS = new Set([
  'hands', 'drawPile', 'initialState', 'initial_state', 'state_json',
  'trades', 'tradeOrder',
])

function fail(ctx: string, msg: string): never {
  throw new Error(`[seed=0x${BASE_SEED.toString(16)} ${ctx}] ${msg}`)
}
const deepEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Count every physical card object (kind 'wild'|'regular') anywhere in a value. */
function countCards(node: unknown): number {
  if (node == null || typeof node !== 'object') return 0
  const rec = node as Record<string, unknown>
  if (rec.kind === 'wild' || rec.kind === 'regular') return 1
  let n = 0
  if (Array.isArray(node)) for (const v of node) n += countCards(v)
  else for (const v of Object.values(rec)) n += countCards(v)
  return n
}

/** Assert no FORBIDDEN key appears anywhere in the object graph. */
function assertNoForbiddenKeys(node: unknown, ctx: string): void {
  if (node == null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const v of node) assertNoForbiddenKeys(v, ctx)
    return
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(k)) fail(ctx, `client payload leaked forbidden key "${k}"`)
    assertNoForbiddenKeys(v, ctx)
  }
}

/** Physical-card conservation on an authoritative snapshot: always 66. */
function assertConservation(snap: GameState, ctx: string): void {
  const inHands = snap.hands.reduce((s, h) => s + h.length, 0)
  const total = snap.grid.size + inHands + snap.drawPile.length
  if (total !== CARD_TOTAL) {
    fail(ctx, `card conservation broke: grid=${snap.grid.size} hands=${inHands} draw=${snap.drawPile.length} total=${total} (expected ${CARD_TOTAL})`)
  }
}

/** The redaction contract for one seat's ClientView against the true snapshot. */
function assertViewRedacted(view: any, snap: GameState, seat: number, ctx: string): void {
  const c = `${ctx} seat=${seat}`
  if (!deepEq(Object.keys(view).sort(), CLIENT_VIEW_KEYS)) {
    fail(c, `view keys mismatch: ${JSON.stringify(Object.keys(view).sort())}`)
  }
  if (view.mySeat !== seat) fail(c, `mySeat=${view.mySeat}`)
  // Own hand FULL and exact (order preserved); others exposed only as counts.
  if (!deepEq(view.myHand, snap.hands[seat])) fail(c, 'myHand != authoritative own hand')
  if (!deepEq(view.handCounts, snap.hands.map((h) => h.length))) fail(c, 'handCounts wrong')
  if (typeof view.drawPileCount !== 'number' || view.drawPileCount !== snap.drawPile.length) {
    fail(c, `drawPileCount=${view.drawPileCount} vs ${snap.drawPile.length}`)
  }
  if ('drawPile' in view) fail(c, 'view exposed a drawPile array')
  if ('hands' in view) fail(c, 'view exposed a hands array')
  assertNoForbiddenKeys(view, c)
  // The ONLY cards a seat may see are the board + its own hand + the public
  // played-cards log. If ANY other seat's hand card or a drawPile card leaked in
  // (under any key), this count exceeds the justified total.
  const justified = snap.grid.size + snap.hands[seat]!.length + snap.playedCards.length
  const seen = countCards(view)
  if (seen !== justified) {
    fail(c, `view card count ${seen} != justified ${justified} — a hidden card leaked`)
  }
}

/** The /sync moves log must never leak a pass's traded cards. */
function assertMovesRedacted(moves: any[], ctx: string): void {
  for (const m of moves) {
    assertNoForbiddenKeys(m, `${ctx} move#${m.moveIndex}`)
    if (m.type === 'pass') {
      const keys = Object.keys(m.payload).sort()
      if (!deepEq(keys, ['tradedCount', 'type'])) {
        fail(ctx, `pass payload not redacted: ${JSON.stringify(m.payload)}`)
      }
      if (typeof m.payload.tradedCount !== 'number') fail(ctx, 'tradedCount not a number')
      if (countCards(m.payload) !== 0) fail(ctx, 'pass payload leaked card objects')
    }
  }
}

/** Full redaction sweep over the authoritative snapshot for every seat. */
function assertAllSeats(repo: GameRepository, ctx: string): GameState {
  const snap = repo.getSnapshot()!
  assertConservation(snap, ctx)
  const seats = repo.getSeats()
  for (let s = 0; s < snap.hands.length; s++) {
    assertViewRedacted(buildClientView(snap, s, seats), snap, s, ctx)
  }
  const moves = repo.getMovesSince(0).filter((m) => !m.reverted).map(toClientMove)
  assertMovesRedacted(moves, ctx)
  return snap
}

// ---- seeded legal-move generator (no engine randomness) --------------------

function emptyAdjacent(grid: Map<string, Card>): Position[] {
  const empties = new Set<string>()
  for (const key of grid.keys()) {
    const [x, y] = key.split(',').map(Number)
    for (const p of [{ x: x! + 1, y: y! }, { x: x! - 1, y: y! }, { x: x!, y: y! + 1 }, { x: x!, y: y! - 1 }]) {
      const k = posKey(p)
      if (!grid.has(k)) empties.add(k)
    }
  }
  return [...empties].map((k) => {
    const [x, y] = k.split(',').map(Number)
    return { x: x!, y: y! }
  })
}

function shuffleInPlace<T>(rng: () => number, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
  return arr
}

/** A fully-seeded legal move: a validated single-card play, else a legal pass. */
function pickMove(rng: () => number, state: GameState, seat: number): MovePayload {
  const hand = state.hands[seat]!
  const empties = emptyAdjacent(state.grid)
  const plays: Placement[][] = []
  for (const card of hand) {
    for (const pos of empties) {
      const placement: Placement[] = [{ card, position: pos }]
      if (validatePlay(state.grid, placement).valid) plays.push(placement)
    }
  }
  if (plays.length > 0 && rng() < 0.85) {
    return { type: 'play', placements: plays[Math.floor(rng() * plays.length)]! }
  }
  // Pass, trading a random legal subset of the hand (0..min(4,handLen)).
  const maxTrade = Math.min(4, hand.length)
  const k = Math.floor(rng() * (maxTrade + 1))
  const idxs = shuffleInPlace(rng, hand.map((_, i) => i)).slice(0, k)
  const trades = idxs.map((i) => hand[i]!)
  const tradeOrder = shuffleInPlace(rng, [...trades])
  return { type: 'pass', trades, tradeOrder }
}

/** Opportunistic, fully-validated wild_recycle for the current seat (or null). */
function tryRecycle(state: GameState, seat: number): MovePayload | null {
  const wildKeys = [...state.grid.entries()].filter(([, c]) => c.kind === 'wild').map(([k]) => k)
  if (wildKeys.length === 0) return null
  const regs = state.hands[seat]!.filter((c): c is RegularCard => c.kind === 'regular')
  for (const wk of wildKeys) {
    const [x, y] = wk.split(',').map(Number)
    const pos = { x: x!, y: y! }
    for (const r of regs) {
      if (validateWildRecycle(state.grid, pos, r)) {
        return { type: 'wild_recycle', wildPosition: pos, replacement: r }
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  await applyD1SchemaSafe()
  // eslint-disable-next-line no-console
  console.log(`[pressure-redaction-archive] BASE_SEED = 0x${BASE_SEED.toString(16)}`)
})

async function applyD1SchemaSafe() {
  const { applyD1Schema } = await import('../src/d1/schema')
  await applyD1Schema(DB())
}

// Shared apply helper used inside a DO callback. Returns the ApplyResult.
type ApplyEnv = { doState: any; sql: SqlLike; repo: GameRepository }
let moveTag = 0
function applyOne(e: ApplyEnv, seat: number, move: MovePayload, byAi: boolean, now: number): any {
  const meta = e.repo.getMeta()!
  const tag = moveTag++
  const params = byAi
    ? {
        seatIndex: seat, move, clientMoveId: `ai-${tag}`, accountId: null,
        byAi: true, aiDifficulty: 'medium', expectedSeat: seat, requireAiControlled: true, now,
      }
    : { seatIndex: seat, move, clientMoveId: `h-${tag}`, accountId: `acct-${seat}`, now }
  return e.doState.storage.transactionSync(() => applyAndPersist(e.sql, e.repo, params))
}

describe('PRESSURE: redaction fuzz (no hand/drawPile/initial_state leak, ever)', () => {
  const GAMES = 24
  const CAP = 160

  it(`drives ${GAMES} random games and asserts the redaction contract after every step`, async () => {
    let totalSteps = 0
    let vetos = 0
    let covers = 0
    let recycles = 0

    for (let g = 0; g < GAMES; g++) {
      const rng = mulberry32(gameSeed(g))
      const playerCount = 2 + Math.floor(rng() * 3) // 2..4
      const now0 = 1_000_000

      await runInDurableObject(stubFor(`fuzz-${g}-${crypto.randomUUID()}`), (_i: any, doState: any) => {
        const sql = doState.storage.sql as SqlLike
        const { repo } = seedLiveGame(sql, {
          playerCount,
          presentSeats: Array.from({ length: playerCount }, (_, i) => i),
          now: now0,
        })
        const e: ApplyEnv = { doState, sql, repo }

        // Baseline: the freshly-dealt state redacts cleanly for every seat.
        assertAllSeats(repo, `g=${g} step=init`)

        for (let step = 0; step < CAP; step++) {
          const meta = repo.getMeta()!
          if (meta.status !== 'active') break
          const now = now0 + step
          const seat = meta.current_seat
          const seatRow = repo.getSeats()[seat]!
          const byAi = seatRow.controlled_by_ai
          const ctx = `g=${g} step=${step}`

          // Opportunistic wild_recycle (does NOT advance the turn).
          if (rng() < 0.2) {
            const rc = tryRecycle(repo.getSnapshot()!, seat)
            if (rc) {
              const rres = applyOne(e, seat, rc, byAi, now)
              if ('error' in rres) fail(ctx, `legal wild_recycle rejected: ${rres.error}`)
              recycles++
              assertViewRedacted(rres.view, repo.getSnapshot()!, seat, `${ctx} recycle-result`)
              assertAllSeats(repo, `${ctx} post-recycle`)
            }
          }

          // Main move.
          const move = pickMove(rng, repo.getSnapshot()!, seat)
          const res = applyOne(e, seat, move, byAi, now)
          if ('error' in res) fail(ctx, `legal ${move.type} rejected: ${res.error}`)
          totalSteps++

          // (1) the move-RESULT view (apply.ts output) must be redacted...
          assertViewRedacted(res.view, repo.getSnapshot()!, seat, `${ctx} move-result`)
          // (2) ...and so must every seat's /sync-style view + the moves log.
          assertAllSeats(repo, `${ctx} post-move`)

          // Randomly cover / uncover the NEW current seat -> "after cover" states
          // + real by_ai moves next iteration (exercised via requireAiControlled).
          const after = repo.getMeta()!
          if (after.status === 'active' && rng() < 0.18) {
            const target = after.current_seat
            const cur = repo.getSeats()[target]!.controlled_by_ai
            doState.storage.transactionSync(() => repo.setControlledByAi(target, !cur))
            if (!cur) covers++
            assertAllSeats(repo, `${ctx} post-cover-toggle`)
          }

          // Randomly veto a trailing AI run -> reverted row + rebuilt snapshot.
          if (rng() < 0.15) {
            const live = repo.getMovesSince(0).filter((m) => !m.reverted)
            const last = live[live.length - 1]
            if (last && last.by_ai) {
              const vseat = last.seat_index
              const vres = doState.storage.transactionSync(() =>
                performVeto(repo, sql, vseat, now),
              )
              if (vres.ok) {
                vetos++
                for (const idx of vres.revertedIndices) repo.enqueueOutbox(idx)
                assertViewRedacted(
                  buildClientView(vres.rebuilt, vseat, repo.getSeats()), repo.getSnapshot()!, vseat, `${ctx} veto-result`,
                )
                assertAllSeats(repo, `${ctx} post-veto`)
              }
            }
          }
        }
      })
    }

    // The fuzz is only meaningful if it actually exercised the interesting paths.
    expect(totalSteps).toBeGreaterThan(200)
    expect(covers).toBeGreaterThan(0)
    expect(vetos).toBeGreaterThan(0)
    // eslint-disable-next-line no-console
    console.log(`[redaction fuzz] steps=${totalSteps} covers=${covers} vetos=${vetos} recycles=${recycles}`)
  })
})

describe('PRESSURE: the real HTTP GET /sync wire never leaks', () => {
  const GAMES = 4
  const DRIVE = 40

  it('drives games then reads /sync over the DO fetch handler for every seat', async () => {
    let checks = 0
    for (let g = 0; g < GAMES; g++) {
      const rng = mulberry32(gameSeed(1000 + g))
      const playerCount = 2 + (g % 3) // 2,3,4,2
      const now0 = 2_000_000
      // Pre-mint auth headers (crypto is fine outside the DO callback).
      const headers: Record<string, string>[] = []
      for (let s = 0; s < playerCount; s++) headers.push(await authHeaders(`acct-${s}`))

      await runInDurableObject(stubFor(`wire-${g}-${crypto.randomUUID()}`), async (instance: any, doState: any) => {
        const sql = doState.storage.sql as SqlLike
        const { repo } = seedLiveGame(sql, {
          playerCount,
          presentSeats: Array.from({ length: playerCount }, (_, i) => i),
          now: now0,
        })
        const e: ApplyEnv = { doState, sql, repo }

        for (let step = 0; step < DRIVE; step++) {
          const meta = repo.getMeta()!
          if (meta.status !== 'active') break
          const seat = meta.current_seat
          const move = pickMove(rng, repo.getSnapshot()!, seat)
          const res = applyOne(e, seat, move, repo.getSeats()[seat]!.controlled_by_ai, now0 + step)
          if ('error' in res) fail(`wire g=${g} step=${step}`, `legal ${move.type} rejected: ${res.error}`)
        }

        const snap = repo.getSnapshot()!
        for (let s = 0; s < playerCount; s++) {
          const resp = await instance.fetch(
            new Request('https://do/sync', { method: 'GET', headers: headers[s] }),
          )
          expect(resp.status).toBe(200)
          const body = (await resp.json()) as any
          const ctx = `wire g=${g} seat=${s}`
          // Nothing forbidden anywhere in the wire body, and quoted-key scan too.
          assertNoForbiddenKeys(body, ctx)
          const raw = JSON.stringify(body)
          if (/"drawPile"|"hands"|"initialState"|"initial_state"|"state_json"|"trades"|"tradeOrder"/.test(raw)) {
            fail(ctx, `raw /sync body leaked a forbidden key: ${raw.slice(0, 200)}`)
          }
          assertViewRedacted(body.snapshot, snap, s, ctx)
          assertMovesRedacted(body.moves, ctx)
          checks++
        }
      })
    }
    expect(checks).toBeGreaterThan(0)
  })
})

describe('PRESSURE: D1 archive round-trip (replay of archived log == terminal snapshot)', () => {
  const RUNS = 6

  it('drives full games with an AI cover + veto, then replays the D1 log byte-identically', async () => {
    let completed = 0
    let stalemates = 0

    for (let r = 0; r < RUNS; r++) {
      const rng = mulberry32(gameSeed(9000 + r))
      const playerCount = 2 + (r % 3)
      const gameUuid = `rt-${crypto.randomUUID()}`
      const now = 3_000_000 + r

      await runInDurableObject(stubFor(`rt-${r}-${crypto.randomUUID()}`), async (instance: any, doState: any) => {
        const sql = doState.storage.sql as SqlLike
        const { repo } = seedLiveGame(sql, {
          playerCount,
          presentSeats: Array.from({ length: playerCount }, (_, i) => i),
          now,
        })
        repo.putMeta({ ...repo.getMeta()!, game_uuid: gameUuid }) // unique D1 PK
        const e: ApplyEnv = { doState, sql, repo }

        let injectedVeto = false
        const CAP = 400
        for (let step = 0; step < CAP; step++) {
          const meta = repo.getMeta()!
          if (meta.status !== 'active') break
          const seat = meta.current_seat

          // Inject the mandated cover + AI move + veto + human replacement once,
          // a handful of moves in (so a real trailing AI run exists to veto).
          if (!injectedVeto && step === 6) {
            doState.storage.transactionSync(() => repo.setControlledByAi(seat, true))
            const aiMove = pickMove(rng, repo.getSnapshot()!, seat)
            const aiRes = applyOne(e, seat, aiMove, true, now)
            if ('error' in aiRes) fail(`rt r=${r}`, `AI cover move rejected: ${aiRes.error}`)
            // Veto that trailing AI run: revert it, reclaim the seat to the human.
            const vres = doState.storage.transactionSync(() => performVeto(repo, sql, seat, now))
            expect(vres.ok).toBe(true)
            for (const idx of (vres as any).revertedIndices) repo.enqueueOutbox(idx)
            injectedVeto = true
            // Fall through: the (now human) seat plays its real move below.
          }

          const cur = repo.getMeta()!.current_seat
          const move = pickMove(rng, repo.getSnapshot()!, cur)
          const res = applyOne(e, cur, move, repo.getSeats()[cur]!.controlled_by_ai, now)
          if ('error' in res) fail(`rt r=${r} step=${step}`, `legal ${move.type} rejected: ${res.error}`)
        }

        // If natural play didn't terminate, force a stalemate deterministically:
        // uncover everyone and pass until the engine declares the game over.
        if (repo.getMeta()!.status === 'active') {
          doState.storage.transactionSync(() => {
            for (let s = 0; s < playerCount; s++) repo.setControlledByAi(s, false)
          })
          for (let step = 0; step < 3 * playerCount + 2; step++) {
            const meta = repo.getMeta()!
            if (meta.status !== 'active') break
            const seat = meta.current_seat
            const res = applyOne(e, seat, { type: 'pass', trades: [], tradeOrder: [] }, false, now)
            if ('error' in res) fail(`rt r=${r}`, `forced pass rejected: ${res.error}`)
          }
        }

        const terminalMeta = repo.getMeta()!
        expect(terminalMeta.status === 'completed' || terminalMeta.status === 'stalemate').toBe(true)
        if (terminalMeta.status === 'completed') completed++
        else stalemates++
        const terminalSnap = repo.getSnapshot()!
        assertConservation(terminalSnap, `rt r=${r} terminal`)

        // ---- write through to D1 --------------------------------------------
        const createRow: GameArchiveRow = {
          gameUuid, mode: 'online', status: 'active', playerCount,
          source: 'online_authoritative', engineVersion: terminalMeta.engine_version,
          createdAt: now, lastActivityAt: now, code: null,
        }
        await flushGameCreate(DB(), createRow, repo.getSeats())
        await instance.flushOutbox(now, DB()) // push every move row (incl. reverted flag)
        await instance.archiveTick(now, DB()) // finalize games row (winner/outcome/scores)
        expect(new GameRepository(sql).unflushedOutbox()).toEqual([])

        // ---- round-trip: replay the ARCHIVED log against the DO initial_state -
        const d1rows = (
          await DB().prepare('SELECT * FROM moves WHERE game_uuid = ? ORDER BY move_index ASC').bind(gameUuid).all()
        ).results as Record<string, unknown>[]
        // The DO log and the D1 log must contain the exact same move_index set.
        const doIdx = repo.getMovesSince(0).map((m) => m.move_index)
        expect(d1rows.map((r) => Number(r.move_index))).toEqual(doIdx)
        // At least one row must be reverted (the vetoed AI move) and it must have
        // re-propagated to D1 as reverted=1.
        expect(d1rows.some((r) => Number(r.reverted) === 1)).toBe(true)

        const archivedMoves: MoveRow[] = d1rows.map((r) => ({
          move_index: Number(r.move_index),
          turn_number: Number(r.turn_number),
          seat_index: Number(r.seat_index),
          type: r.type as MoveRow['type'],
          payload: String(r.payload),
          score_delta: Number(r.score_delta),
          score_after: Number(r.score_after),
          by_ai: Number(r.by_ai) === 1,
          ai_difficulty: r.ai_difficulty == null ? null : String(r.ai_difficulty),
          controlling_account_id: r.controlling_account_id == null ? null : String(r.controlling_account_id),
          client_move_id: null,
          reverted: Number(r.reverted) === 1,
          created_at: Number(r.created_at),
        }))

        const initial = repo.getInitialState()!
        const replayed = replay(initial, archivedMoves)
        // BYTE-IDENTICAL: hidden hands + exact drawPile order + grid all match.
        expect(serializeState(replayed)).toBe(serializeState(terminalSnap))

        // ---- archived outcome must match the DO truth -----------------------
        const g = await DB()
          .prepare('SELECT status, outcome, winner_seat FROM games WHERE game_uuid = ?')
          .bind(gameUuid)
          .first<{ status: string; outcome: string; winner_seat: number | null }>()
        expect(g!.status).toBe(terminalMeta.status)
        expect(g!.outcome).toBe(terminalMeta.status)
        const expectedWinner = terminalMeta.status === 'completed' ? winnerSeatOf(terminalSnap.scores) : null
        expect(g!.winner_seat == null ? null : Number(g!.winner_seat)).toBe(expectedWinner)

        const players = (
          await DB().prepare('SELECT seat_index, final_score FROM game_players WHERE game_uuid = ? ORDER BY seat_index').bind(gameUuid).all()
        ).results as { seat_index: number; final_score: number }[]
        expect(players.length).toBe(playerCount)
        for (const p of players) {
          expect(Number(p.final_score)).toBe(terminalSnap.scores[Number(p.seat_index)])
        }
      })
    }
    // eslint-disable-next-line no-console
    console.log(`[archive round-trip] completed=${completed} stalemates=${stalemates}`)
    expect(completed + stalemates).toBe(RUNS)
  })
})
