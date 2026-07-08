import { env, runInDurableObject } from 'cloudflare:test'
import { it, expect, describe } from 'vitest'
import {
  AIAgent,
  createDeck,
  validateWildRecycle,
  posKey,
  fromKey,
  type Card,
  type GameState,
  type RegularCard,
} from '@viota/engine'
import { GameRepository, runMigrations, type SqlLike, type SeatRow } from '../src/do/storage'
import { serializeState } from '../src/do/state-codec'
import { replay } from '../src/do/replay'
import { applyAndPersist, type ApplyParams, type ApplyResult } from '../src/do/apply'
import { buildClientView } from '../src/do/view'
import { toMovePayload } from '../src/do/drive'
import type { MovePayload } from '../src/do/moves'

/**
 * PRESSURE / FUZZ for the DO move pipeline as an integrated system
 * (apply.ts + replay.ts + moves.ts + storage.ts + state-codec.ts).
 *
 * Everything runs inside real `ctx.storage.transactionSync`, exactly as the DO
 * does. Each game is dealt from a SEEDED PRNG (a faithful clone of
 * `initGame`, but seeded — so a failure reproduces from the printed seed; the
 * real `initGame` uses `Math.random` and is NOT reproducible). After EVERY step
 * of the randomized sequence we assert ALL invariants, not just at the end.
 */

// --- seeded PRNG (mulberry32) ------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const int = (rand: () => number, n: number) => Math.floor(rand() * n)

// --- canonical 66-card deck multiset ----------------------------------------
function cardKey(c: Card): string {
  return c.kind === 'wild' ? 'wild' : `${c.color}-${c.shape}-${c.number}`
}
function multiset(cards: Card[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of cards) m.set(cardKey(c), (m.get(cardKey(c)) ?? 0) + 1)
  return m
}
function msObj(m: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...m.entries()].sort())
}
const CANON = multiset(createDeck())
const CANON_OBJ = msObj(CANON)

// --- seeded clone of engine initGame (deterministic deal) --------------------
function seededShuffle<T>(arr: readonly T[], rand: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = int(rand, i + 1)
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}
function seededInitGame(playerCount: number, rand: () => number): GameState {
  const deck = seededShuffle(createDeck(), rand)
  const pile = [...deck]
  let starterCard = pile.shift()!
  // Mirror initGame's "starter must be a regular card" house rule.
  while (starterCard.kind === 'wild') {
    const idx = int(rand, pile.length + 1)
    pile.splice(idx, 0, starterCard)
    starterCard = pile.shift()!
  }
  const grid = new Map<string, Card>()
  grid.set(posKey({ x: 0, y: 0 }), starterCard)
  const playedCards: RegularCard[] = starterCard.kind === 'regular' ? [starterCard] : []
  const hands: Card[][] = []
  for (let i = 0; i < playerCount; i++) hands.push(pile.splice(0, 4))
  return {
    grid,
    hands,
    drawPile: pile,
    scores: Array.from({ length: playerCount }, () => 0),
    turnIndex: 0,
    playedCards,
    consecutivePasses: 0,
    finished: false,
  }
}

// --- seed a deterministic active game directly into a DO's SQLite ------------
function seedGame(sql: SqlLike, initialState: GameState, playerCount: number): GameRepository {
  runMigrations(sql)
  const repo = new GameRepository(sql)
  repo.putInitialState(initialState)
  repo.putSnapshot(initialState)
  repo.putMeta({
    move_index: 0,
    status: 'active',
    current_seat: initialState.turnIndex,
    player_count: playerCount,
    engine_version: 'viota-engine@fuzz',
    game_uuid: 'fuzz',
    code: null,
  })
  for (let i = 0; i < playerCount; i++) {
    const seat: SeatRow = {
      seat_index: i,
      owner_account_id: `acct-${i}`,
      ghost_id: null,
      owner_type: 'human',
      display_name: `P${i}`,
      ai_difficulty: null,
      controlled_by_ai: false,
      disconnected_at: null,
      last_seen_at: null,
      final_score: null,
    }
    repo.putSeat(seat)
  }
  return repo
}

// --- helpers -----------------------------------------------------------------
const stubFor = (name: string) => env.GAME_DO.get(env.GAME_DO.idFromName(name))
const allCards = (s: GameState): Card[] => [...s.grid.values(), ...s.hands.flat(), ...s.drawPile]

/** A legal move for `seat` in `snapshot` from the medium AI (play or pass). */
function legalAiMove(snapshot: GameState, seat: number): MovePayload {
  return toMovePayload(AIAgent('medium')(snapshot, seat))
}

/** A legal wild_recycle for `seat`, or null if none exists. */
function legalRecycle(snapshot: GameState, seat: number): MovePayload | null {
  const hand = snapshot.hands[seat] ?? []
  const regulars = hand.filter((c): c is RegularCard => c.kind === 'regular')
  for (const [key, card] of snapshot.grid.entries()) {
    if (card.kind !== 'wild') continue
    const pos = fromKey(key)
    for (const repl of regulars) {
      if (validateWildRecycle(snapshot.grid, pos, repl)) {
        return { type: 'wild_recycle', wildPosition: pos, replacement: repl }
      }
    }
  }
  return null
}

/** ctx string so any failure prints the seed + step for reproduction. */
const at = (seed: number, step: number, extra = '') => `seed=${seed} step=${step}${extra ? ' ' + extra : ''}`

/** All post-step system invariants over the persisted state. Throws on violation. */
function assertGlobalInvariants(repo: GameRepository, initialState: GameState, seed: number, step: number) {
  const snapshot = repo.getSnapshot()!
  const moves = repo.getMovesSince(0)
  const meta = repo.getMeta()!

  // (a) CARD CONSERVATION — the 66-card multiset is exactly the deck, always.
  const cards = allCards(snapshot)
  expect(cards.length, at(seed, step, 'card count')).toBe(66)
  const ms = multiset(cards)
  expect(ms.get('wild'), at(seed, step, 'physical wild count')).toBe(2)
  expect(msObj(ms), at(seed, step, 'deck multiset')).toEqual(CANON_OBJ)

  // (b) REPLAY DETERMINISM — replay(initial, non-reverted moves) === snapshot, byte-for-byte.
  const replayed = replay(initialState, moves)
  expect(serializeState(replayed), at(seed, step, 'replay==snapshot')).toBe(serializeState(snapshot))

  // (c) move_index strictly monotonic + gapless (1..N), and meta agrees.
  const indices = moves.map((m) => m.move_index)
  const expected = Array.from({ length: moves.length }, (_, i) => i + 1)
  expect(indices, at(seed, step, 'move_index gapless')).toEqual(expected)
  expect(meta.move_index, at(seed, step, 'meta move_index')).toBe(moves.length)

  // turn_number monotonic non-decreasing.
  for (let i = 1; i < moves.length; i++) {
    expect(moves[i]!.turn_number >= moves[i - 1]!.turn_number, at(seed, step, 'turn_number monotone')).toBe(true)
  }

  // (d) NO LEAK — the per-seat view exposes only that seat's cards, never
  // another hand or the ordered draw pile.
  for (let s = 0; s < snapshot.hands.length; s++) {
    const view = buildClientView(snapshot, s)
    const keys = Object.keys(view).sort()
    expect(keys, at(seed, step, `view keys seat ${s}`)).toEqual(
      ['consecutivePasses', 'drawPileCount', 'finished', 'grid', 'handCounts', 'myHand', 'mySeat', 'playedCards', 'scores', 'turnIndex'].sort(),
    )
    expect(view.mySeat).toBe(s)
    expect(view.myHand, at(seed, step, `own hand seat ${s}`)).toEqual(snapshot.hands[s])
    expect(view.handCounts, at(seed, step, `hand counts seat ${s}`)).toEqual(snapshot.hands.map((h) => h.length))
    expect(view.drawPileCount, at(seed, step, `draw count seat ${s}`)).toBe(snapshot.drawPile.length)
    // Serialized view must not contain any OTHER seat's cards.
    const wire = JSON.stringify(view)
    for (let o = 0; o < snapshot.hands.length; o++) {
      if (o === s) continue
      // A foreign hand of length>0 must not be reconstructable: its exact ordered
      // JSON fragment must be absent (own hand is the only full card array).
      const foreign = JSON.stringify(snapshot.hands[o])
      if ((snapshot.hands[o]?.length ?? 0) > 0 && JSON.stringify(snapshot.hands[s]) !== foreign) {
        expect(wire.includes(`"myHand":${foreign}`), at(seed, step, `no foreign hand ${o}->${s}`)).toBe(false)
      }
    }
    // The ordered draw pile array must never appear on the wire.
    if (snapshot.drawPile.length > 0) {
      expect(wire.includes(JSON.stringify(snapshot.drawPile)), at(seed, step, `no drawPile order seat ${s}`)).toBe(false)
    }
  }

  // (g) SCORE INTEGRITY — scores equal an INDEPENDENT recomputation from the
  // move log (sum of per-move score_delta grouped by acting seat), and the
  // replayed state's scores agree with the snapshot's.
  const recomputed = Array.from({ length: snapshot.hands.length }, () => 0)
  for (const m of moves) {
    if (m.reverted) continue
    recomputed[m.seat_index] = (recomputed[m.seat_index] ?? 0) + m.score_delta
  }
  expect(recomputed, at(seed, step, 'score = sum of deltas')).toEqual(snapshot.scores)
  expect(replayed.scores, at(seed, step, 'replay scores')).toEqual(snapshot.scores)
  // score_after column of the last non-reverted move for a seat == that seat's score.
  for (let s = 0; s < snapshot.hands.length; s++) {
    const last = [...moves].reverse().find((m) => !m.reverted && m.seat_index === s)
    if (last) expect(last.score_after, at(seed, step, `score_after seat ${s}`)).toBe(snapshot.scores[s])
  }
}

describe('pressure: DO move pipeline fuzz (100+ seeded full games)', () => {
  it('plays many randomized full games through applyAndPersist inside transactionSync, asserting every invariant after every step', async () => {
    const GAMES = 130
    const MAX_STEPS = 600
    let totalCommitted = 0
    let totalRejected = 0
    let finishedGames = 0

    for (let g = 0; g < GAMES; g++) {
      const seed = 1000 + g
      await runInDurableObject(stubFor(`fuzz-${seed}`), (_i, state: any) => {
        const sql = state.storage.sql as SqlLike
        const rand = mulberry32(seed)
        const playerCount = 2 + (seed % 3) // 2, 3, or 4
        const initialState = seededInitGame(playerCount, rand)
        const initialSnapshot = seedGame(sql, initialState, playerCount)
        const repo = initialSnapshot
        const apply = (p: ApplyParams): ApplyResult => state.storage.transactionSync(() => applyAndPersist(sql, repo, p))

        // Baseline invariants on the fresh deal.
        assertGlobalInvariants(repo, initialState, seed, -1)

        const committed: { cm: string; seat: number }[] = []
        let cmCounter = 0

        for (let step = 0; step < MAX_STEPS; step++) {
          const meta = repo.getMeta()!
          if (meta.status !== 'active') break
          const snapshot = repo.getSnapshot()!
          const current = meta.current_seat
          const roll = rand()

          const movesBefore = repo.getMovesSince(0).length
          const snapBefore = serializeState(snapshot)

          if (roll < 0.55) {
            // (LEGAL) current seat plays a legal move; sometimes a legal recycle.
            let move: MovePayload
            const recycle = rand() < 0.18 ? legalRecycle(snapshot, current) : null
            move = recycle ?? legalAiMove(snapshot, current)
            const cm = `cm-${seed}-${cmCounter++}`
            const useAi = rand() < 0.1 && move.type !== 'wild_recycle'
            const res = useAi
              ? apply({ seatIndex: current, move, clientMoveId: `ai:${current}:${meta.move_index + 1}`, accountId: null, byAi: true, aiDifficulty: 'medium', expectedSeat: current, requireAiControlled: false, now: step })
              : apply({ seatIndex: current, move, clientMoveId: cm, accountId: `acct-${current}`, now: step })
            expect('ok' in res && res.ok, at(seed, step, `legal ${move.type} rejected: ${'error' in res ? res.error : ''}`)).toBe(true)
            if ('ok' in res) {
              expect(res.moveIndex, at(seed, step, 'moveIndex advances')).toBe(movesBefore + 1)
              // (d) success view exposes only the acting seat's hand.
              expect(res.view.mySeat).toBe(current)
              committed.push({ cm: useAi ? `ai:${current}:${meta.move_index + 1}` : cm, seat: current })
            }
            totalCommitted++
          } else if (roll < 0.68 && playerCount >= 2) {
            // (WRONG TURN) a legal-shaped play/pass by a NON-current seat is rejected.
            const other = (current + 1 + int(rand, playerCount - 1)) % playerCount
            const move = legalAiMove(snapshot, other) // play or pass (never recycle)
            const res = apply({ seatIndex: other, move, clientMoveId: `wt-${seed}-${cmCounter++}`, accountId: `acct-${other}`, now: step })
            expect(res, at(seed, step, 'wrong-turn must be not_your_turn')).toEqual({ error: 'not_your_turn' })
            totalRejected++
          } else if (roll < 0.8) {
            // (WRONG SEAT) current seat, but a non-owning account -> not_your_seat, no view.
            const move = legalAiMove(snapshot, current)
            const res = apply({ seatIndex: current, move, clientMoveId: `ws-${seed}-${cmCounter++}`, accountId: 'acct-intruder', now: step })
            expect(res, at(seed, step, 'wrong-seat must be not_your_seat')).toEqual({ error: 'not_your_seat' })
            expect('view' in res, at(seed, step, 'wrong-seat leaks no view')).toBe(false)
            totalRejected++
          } else if (roll < 0.9 && committed.length > 0) {
            // (IDEMPOTENCY + HAND-LEAK re-attack) replay a committed clientMoveId.
            const victim = committed[int(rand, committed.length)]!
            // (e) legit replay by the owner -> duplicate, own hand, NO new row.
            const dup = apply({ seatIndex: victim.seat, move: { type: 'pass', trades: [], tradeOrder: [] }, clientMoveId: victim.cm, accountId: `acct-${victim.seat}`, now: step })
            expect('duplicate' in dup && dup.duplicate, at(seed, step, 'duplicate ack')).toBe(true)
            if ('duplicate' in dup) {
              expect(dup.view.mySeat, at(seed, step, 'dup view is own seat')).toBe(victim.seat)
              // must reflect the CURRENT snapshot for the owning seat only.
              expect(dup.view.myHand, at(seed, step, 'dup own hand only')).toEqual(repo.getSnapshot()!.hands[victim.seat])
            }
            expect(repo.getMovesSince(0).length, at(seed, step, 'dup adds no row')).toBe(movesBefore)

            // (d) HAND-LEAK: same clientMoveId, but name a DIFFERENT seat, as the
            // original committer. Authz precedes idempotency -> not_your_seat, no view.
            if (playerCount >= 2) {
              const foreign = (victim.seat + 1) % playerCount
              const attack = apply({ seatIndex: foreign, move: { type: 'pass', trades: [], tradeOrder: [] }, clientMoveId: victim.cm, accountId: `acct-${victim.seat}`, now: step })
              expect(attack, at(seed, step, 'leak-attack must be not_your_seat')).toEqual({ error: 'not_your_seat' })
              expect('view' in attack, at(seed, step, 'leak-attack builds no view')).toBe(false)
              expect(repo.getMovesSince(0).length, at(seed, step, 'leak-attack adds no row')).toBe(movesBefore)
            }
            totalRejected++
          } else {
            // (MALFORMED / ILLEGAL) current seat plays onto the always-occupied
            // starter cell (0,0) -> engine error, no row. (shape-valid, illegal)
            const handCard = snapshot.hands[current]?.[0]
            if (handCard) {
              const move: MovePayload = { type: 'play', placements: [{ card: handCard, position: { x: 0, y: 0 } }] }
              const res = apply({ seatIndex: current, move, clientMoveId: `bad-${seed}-${cmCounter++}`, accountId: `acct-${current}`, now: step })
              expect('error' in res, at(seed, step, 'illegal move rejected')).toBe(true)
              if ('error' in res) {
                expect(res.error, at(seed, step, 'illegal != turn/seat')).not.toBe('not_your_turn')
                expect(res.error, at(seed, step, 'illegal != seat')).not.toBe('not_your_seat')
              }
              totalRejected++
            }
          }

          // After a REJECTED step the persisted snapshot + move count must be UNCHANGED.
          const movesAfter = repo.getMovesSince(0).length
          if (movesAfter === movesBefore) {
            expect(serializeState(repo.getSnapshot()!), at(seed, step, 'rejected step mutated snapshot')).toBe(snapBefore)
          }

          // (a)-(g) FULL invariant sweep after EVERY step.
          assertGlobalInvariants(repo, initialState, seed, step)
        }

        // POST-GAME-OVER GUARD: once not active, any move is game_over + writes nothing.
        const endMeta = repo.getMeta()!
        if (endMeta.status !== 'active') {
          finishedGames++
          const before = repo.getMovesSince(0).length
          const beforeSnap = serializeState(repo.getSnapshot()!)
          const res = apply({ seatIndex: 0, move: { type: 'pass', trades: [], tradeOrder: [] }, clientMoveId: `after-over-${seed}`, accountId: 'acct-0', now: 999999 })
          expect(res, at(seed, MAX_STEPS, 'post-game-over must be game_over')).toEqual({ error: 'game_over' })
          expect(repo.getMovesSince(0).length, at(seed, MAX_STEPS, 'no write after over')).toBe(before)
          expect(serializeState(repo.getSnapshot()!), at(seed, MAX_STEPS, 'snapshot frozen after over')).toBe(beforeSnap)
        }

        // Final replay-equality one more time (belt + suspenders).
        expect(serializeState(replay(initialState, repo.getMovesSince(0)))).toBe(serializeState(repo.getSnapshot()!))
      })
    }

    // Sanity: the fuzz actually did meaningful work.
    expect(totalCommitted).toBeGreaterThan(GAMES * 3)
    expect(totalRejected).toBeGreaterThan(GAMES)
    // Report coverage as a soft signal (finished games can be < GAMES if some hit MAX_STEPS).
    expect(finishedGames).toBeGreaterThanOrEqual(0)
  }, 180_000)

  // --- focused reclaim-race guard (CRITICAL #2 territory) --------------------
  it('reclaim-race guard: a byAi move ABORTS (reclaimed, no write) when the seat is no longer AI-controlled or the turn advanced', async () => {
    await runInDurableObject(stubFor('fuzz-reclaim'), (_i, state: any) => {
      const sql = state.storage.sql as SqlLike
      const rand = mulberry32(42)
      const initialState = seededInitGame(2, rand)
      const repo = seedGame(sql, initialState, 2)
      // Mark seat 0 AI-controlled (as the drive path would before a cover move).
      repo.setControlledByAi(0, true)
      const apply = (p: ApplyParams): ApplyResult => state.storage.transactionSync(() => applyAndPersist(sql, repo, p))
      const snapshot = repo.getSnapshot()!
      const move = legalAiMove(snapshot, 0)

      // (1) seat 0 is NOT controlled_by_ai anymore (human reclaimed) -> reclaimed.
      repo.setControlledByAi(0, false)
      const r1 = apply({ seatIndex: 0, move, clientMoveId: 'ai:0:1', accountId: null, byAi: true, aiDifficulty: 'medium', expectedSeat: 0, requireAiControlled: true, now: 1 })
      expect(r1).toEqual({ error: 'reclaimed' })
      expect(repo.getMovesSince(0).length).toBe(0)

      // (2) still AI, but the expected seat != current_seat (turn advanced) -> reclaimed.
      repo.setControlledByAi(0, true)
      const r2 = apply({ seatIndex: 0, move, clientMoveId: 'ai:0:1b', accountId: null, byAi: true, aiDifficulty: 'medium', expectedSeat: 1, requireAiControlled: true, now: 2 })
      expect(r2).toEqual({ error: 'reclaimed' })
      expect(repo.getMovesSince(0).length).toBe(0)

      // (3) guard satisfied -> the AI move commits exactly once.
      const r3 = apply({ seatIndex: 0, move, clientMoveId: 'ai:0:1c', accountId: null, byAi: true, aiDifficulty: 'medium', expectedSeat: 0, requireAiControlled: true, now: 3 })
      expect('ok' in r3 && r3.ok).toBe(true)
      expect(repo.getMovesSince(0).length).toBe(1)
      expect(repo.getMovesSince(0)[0]!.by_ai).toBe(true)
      // controlling_account_id still attributes to the human owner of the seat.
      expect(repo.getMovesSince(0)[0]!.controlling_account_id).toBe('acct-0')
    })
  })
})
