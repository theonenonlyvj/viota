import { SELF, env, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test'
import { it, expect, beforeAll } from 'vitest'
import { AIAgent } from '@viota/engine'
import { applyGameSchema, applyIdentitySchema } from '../src/d1/schema'
import { GameRepository, type MoveRow, type SqlLike } from '../src/do/storage'
import { serializeState, deserializeState } from '../src/do/state-codec'
import { replay } from '../src/do/replay'
import { toMovePayload } from '../src/do/drive'
import { markDisconnected } from '../src/do/presence'
import { setTimer, clearTimer, rearmAlarm } from '../src/do/timers'
import { GLOBAL_SEAT } from '../src/do/constants'
import type { MovePayload } from '../src/do/moves'
import { mintQuickAccount } from './helpers'

/**
 * THE flagship end-to-end confidence test (Phase 7). Drives the WHOLE online
 * lifecycle through the REAL Worker `fetch` (HTTP) + the Durable Object + D1,
 * with TWO authed accounts minted via `POST /auth/quick`. It only reaches into
 * DO storage (`runInDurableObject`) to (a) CHOOSE a legal move for the current
 * seat — the mutation itself always goes back out through `POST /:id/move` — and
 * (b) drive the disconnect/cover timer + read the immutable deal for the archive
 * replay. Everything asserted about the game is produced by the real code path.
 */

const DB = () => (env as unknown as { DB: D1Database }).DB
const IDENTITY_DB = () => (env as unknown as { IDENTITY_DB: D1Database }).IDENTITY_DB
const stubFor = (name: string) => env.GAME_DO.get(env.GAME_DO.idFromName(name))
beforeAll(async () => {
  await applyGameSchema(DB())
  await applyIdentitySchema(IDENTITY_DB())
})

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
const jsonHeaders = (token: string) => ({ 'content-type': 'application/json', ...bearer(token) })

/** Mint a real account+token with a distinct device credential. Identity
 *  code/data split (Step 3): `/auth/quick` is now a network proxy on
 *  viota-worker (see src/index.ts) — seed the account directly instead. See
 *  `mintQuickAccount`'s doc comment in ./helpers. */
async function quickAuth(displayName: string): Promise<{ token: string; accountId: string }> {
  return mintQuickAccount(IDENTITY_DB(), displayName)
}

/** Read the live turn + a legal medium-AI move for the current seat, server-side. */
type Turn = { seat: number; move: MovePayload | null; moveIndex: number; status: string }
function readTurn(gameId: string): Promise<Turn> {
  return runInDurableObject(stubFor(gameId), (_i: unknown, state: any) => {
    const repo = new GameRepository(state.storage.sql as SqlLike)
    const meta = repo.getMeta()!
    if (meta.status !== 'active') return { seat: -1, move: null, moveIndex: meta.move_index, status: meta.status }
    const snap = repo.getSnapshot()!
    const seat = meta.current_seat
    const move = toMovePayload(AIAgent('medium')(snap, seat))
    return { seat, move, moveIndex: meta.move_index, status: meta.status }
  })
}

/** POST a move as the seat's owner through the real Worker route. */
async function postMove(gameId: string, seatIndex: number, move: MovePayload, token: string): Promise<Response> {
  return SELF.fetch(`https://viota.example.com/games/${gameId}/move`, {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({ seatIndex, move, clientMoveId: crypto.randomUUID() }),
  })
}

/** Map D1 archive rows to the minimal MoveRow shape `replay` consumes. */
function d1MovesToRows(rows: Record<string, unknown>[]): MoveRow[] {
  return rows.map((r) => ({
    move_index: Number(r.move_index),
    turn_number: Number(r.turn_number),
    seat_index: Number(r.seat_index),
    type: String(r.type) as MoveRow['type'],
    payload: String(r.payload),
    score_delta: Number(r.score_delta),
    score_after: Number(r.score_after),
    by_ai: Number(r.by_ai) === 1,
    ai_difficulty: (r.ai_difficulty ?? null) as string | null,
    controlling_account_id: (r.controlling_account_id ?? null) as string | null,
    client_move_id: null,
    reverted: Number(r.reverted) === 1,
    created_at: Number(r.created_at),
  }))
}

// timeout: this single test drives a WHOLE game (2 real accounts + up to 600
// HTTP moves + archive replay) and normally takes ~4-5s — right at vitest's
// 5000ms default. Under full-suite CPU contention it tipped over ~1-in-3 (the
// long-documented "e2e flake"). 60s is headroom, not an expectation.
it('drives the full online lifecycle: create -> join -> start -> play -> drop/cover -> reclaim/veto -> end, and the D1 archive replays to the final board', { timeout: 60_000 }, async () => {
  // Two distinct authed accounts (real D1 accounts rows).
  const host = await quickAuth('Host')
  const friend = await quickAuth('Friend')
  expect(host.accountId).not.toBe(friend.accountId)
  const ownerToken = (seat: number) => (seat === 0 ? host.token : friend.token)

  // (a) Host creates a 2-seat multiplayer room; the D1 games row is 'waiting'.
  const createRes = await SELF.fetch('https://viota.example.com/games', {
    method: 'POST',
    headers: jsonHeaders(host.token),
    body: JSON.stringify({ mode: 'multiplayer', playerCount: 2, displayName: 'Host' }),
  })
  expect(createRes.status).toBe(201)
  const { gameId, code } = (await createRes.json()) as { gameId: string; code: string }
  expect(typeof gameId).toBe('string')
  expect(code.length).toBe(6)
  const waitingRow = await DB().prepare('SELECT status FROM games WHERE game_uuid = ?').bind(gameId).first<{ status: string }>()
  expect(waitingRow?.status).toBe('waiting')

  // (b) Resolve the code -> the same gameId.
  const resolveRes = await SELF.fetch(`https://viota.example.com/games/resolve?code=${code}`)
  expect(resolveRes.status).toBe(200)
  expect(((await resolveRes.json()) as { gameId: string }).gameId).toBe(gameId)

  // (c) Friend joins -> seat 1; both see the 2-seat waiting roster.
  const joinRes = await SELF.fetch(`https://viota.example.com/games/${gameId}/join`, {
    method: 'POST',
    headers: jsonHeaders(friend.token),
    body: JSON.stringify({ displayName: 'Friend' }),
  })
  expect(joinRes.status).toBe(200)
  expect(((await joinRes.json()) as { seatIndex: number }).seatIndex).toBe(1)

  for (const who of [host, friend]) {
    const room = (await (await SELF.fetch(`https://viota.example.com/games/${gameId}/sync`, { headers: bearer(who.token) })).json()) as any
    expect(room.status).toBe('waiting')
    expect(room.seats.length).toBe(2)
    expect(room.seats[0]).toMatchObject({ ownerType: 'human' })
    expect(room.seats[1]).toMatchObject({ ownerType: 'human' })
  }

  // (d) Host starts -> deal + active; both /sync return a redacted board, each
  // seeing only its own hand + no drawPile/other hands.
  const startRes = await SELF.fetch(`https://viota.example.com/games/${gameId}/start`, {
    method: 'POST',
    headers: bearer(host.token),
  })
  expect(startRes.status).toBe(200)

  for (const [seat, who] of [[0, host], [1, friend]] as const) {
    const raw = await (await SELF.fetch(`https://viota.example.com/games/${gameId}/sync`, { headers: bearer(who.token) })).text()
    const body = JSON.parse(raw)
    expect(body.snapshot.mySeat).toBe(seat)
    expect(body.snapshot.myHand.length).toBe(4)
    expect(body.snapshot.handCounts).toEqual([4, 4])
    // HARD redaction: never the opponent's hand nor the ordered draw pile.
    expect('hands' in body.snapshot).toBe(false)
    expect('drawPile' in body.snapshot).toBe(false)
    expect(raw).not.toContain('"drawPile":[')
    expect(raw).not.toContain('initial_state')
  }

  // (e/f) Play 3 legal moves alternating seats via the real /move route. Start
  // is seat 0, and every medium-AI move (play|pass, never wild_recycle) advances
  // the turn, so after 3 moves it is seat 1's turn.
  let lastIndex = 0
  for (let i = 0; i < 3; i++) {
    const turn = await readTurn(gameId)
    expect(turn.status).toBe('active')
    expect(turn.seat).toBe(i % 2) // 0,1,0
    const res = await postMove(gameId, turn.seat, turn.move!, ownerToken(turn.seat))
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.moveIndex).toBe(lastIndex + 1) // monotonic move_index
    lastIndex = body.moveIndex

    // Each move's own echo is redacted for the mover.
    expect('drawPile' in body.view).toBe(false)
    // A cross-seat /sync still redacts the opponent's hand + draw pile.
    const other = turn.seat === 0 ? friend : host
    const otherSync = (await (await SELF.fetch(`https://viota.example.com/games/${gameId}/sync`, { headers: bearer(other.token) })).json()) as any
    expect('hands' in otherSync.snapshot).toBe(false)
    expect('drawPile' in otherSync.snapshot).toBe(false)
  }
  const turnAfterPlay = await readTurn(gameId)
  expect(turnAfterPlay.seat).toBe(1) // seat 1 is on turn and about to "drop"

  // (f) Simulate seat 1 dropping WHILE ON TURN: mark it disconnected (arms the
  // fast-track `turn` timer) and fire the alarm -> the absent seat is AI-covered.
  const dropNow = Date.now()
  await runInDurableObject(stubFor(gameId), async (_i: unknown, state: any) => {
    const sql = state.storage.sql as SqlLike
    const repo = new GameRepository(sql)
    markDisconnected(repo, sql, 1, dropNow) // seat 1 on turn -> arms the fast-track `turn` timer
    // Clear the background `heal` timer so `turn` is the sole (thus minimum, thus
    // due) timer when the alarm fires; arm it in the future so the platform does
    // not auto-fire it before the explicit runDurableObjectAlarm.
    clearTimer(sql, 'heal', GLOBAL_SEAT)
    setTimer(sql, 'turn', 1, Date.now() + 60_000)
    await rearmAlarm(state, sql)
  })
  expect(await runDurableObjectAlarm(stubFor(gameId))).toBe(true)

  const indexBeforeCover = await runInDurableObject(stubFor(gameId), (_i: unknown, state: any) => {
    const repo = new GameRepository(state.storage.sql as SqlLike)
    expect(repo.getSeats()[1]!.controlled_by_ai).toBe(true) // covered
    return repo.getMeta()!.move_index
  })

  // (f) The game must keep progressing: a host heartbeat drives seat 1's covered
  // AI move (present human + AI-controlled current seat). Exactly ONE AI move
  // lands (the turn then advances to the human seat 0, so the drive stops).
  const hb = await SELF.fetch(`https://viota.example.com/games/${gameId}/heartbeat`, { method: 'POST', headers: bearer(host.token) })
  expect(hb.status).toBe(200)
  const covered = await runInDurableObject(stubFor(gameId), (_i: unknown, state: any) => {
    const repo = new GameRepository(state.storage.sql as SqlLike)
    const rows = repo.getMovesSince(0)
    const last = rows[rows.length - 1]!
    return { moveIndex: repo.getMeta()!.move_index, status: repo.getMeta()!.status, lastBySeat1Ai: last.seat_index === 1 && last.by_ai, currentSeat: repo.getMeta()!.current_seat }
  })
  expect(covered.moveIndex).toBe(indexBeforeCover + 1) // an AI move landed — never stalled
  expect(covered.lastBySeat1Ai).toBe(true) // by seat 1, by_ai
  expect(covered.status).toBe('active')

  // (g) Seat 1's human reclaims -> controlled_by_ai cleared (the committed AI
  // move is NOT rolled back by reclaim).
  const reclaimRes = await SELF.fetch(`https://viota.example.com/games/${gameId}/reclaim`, { method: 'POST', headers: bearer(friend.token) })
  expect(reclaimRes.status).toBe(200)
  await runInDurableObject(stubFor(gameId), (_i: unknown, state: any) => {
    const repo = new GameRepository(state.storage.sql as SqlLike)
    expect(repo.getSeats()[1]!.controlled_by_ai).toBe(false)
  })

  // (g) Seat 1 vetoes the trailing AI run -> it reverts, the board rolls back,
  // and seat 1 is on turn. move_index stays at the max.
  const vetoRes = await SELF.fetch(`https://viota.example.com/games/${gameId}/veto`, { method: 'POST', headers: bearer(friend.token) })
  expect(vetoRes.status).toBe(200)
  const vetoBody = (await vetoRes.json()) as any
  expect(vetoBody.ok).toBe(true)
  expect(vetoBody.moveIndex).toBe(covered.moveIndex) // unchanged max
  expect(vetoBody.reverted).toEqual([covered.moveIndex]) // the seat-1 AI move
  expect(vetoBody.snapshot.mySeat).toBe(1)
  const afterVeto = await readTurn(gameId)
  expect(afterVeto.seat).toBe(1) // seat 1 is back on turn

  // (g) The human's real move lands at the NEXT index (max + 1).
  const humanMove = await postMove(gameId, 1, afterVeto.move!, friend.token)
  expect(humanMove.status).toBe(200)
  expect(((await humanMove.json()) as any).moveIndex).toBe(covered.moveIndex + 1)

  // (h) Play on to a NATURAL end (medium AI on both seats, chosen server-side,
  // committed via the real route). Bounded: passes are stalemate-capped and the
  // deck is finite, so this always terminates.
  let terminalStatus = ''
  for (let i = 0; i < 600; i++) {
    const turn = await readTurn(gameId)
    if (turn.status !== 'active') { terminalStatus = turn.status; break }
    const res = await postMove(gameId, turn.seat, turn.move!, ownerToken(turn.seat))
    expect(res.status).toBe(200)
  }
  expect(['completed', 'stalemate']).toContain(terminalStatus)

  // Force a deterministic full archive drain + game-end finalize (in prod this
  // rides ctx.waitUntil; here we await it so the D1 reads below are stable).
  await runInDurableObject(stubFor(gameId), (i: any) => i.archiveTick(Date.now()))

  // The D1 games row is finalized to the terminal status.
  const finalGameRow = await DB().prepare('SELECT status FROM games WHERE game_uuid = ?').bind(gameId).first<{ status: string }>()
  expect(finalGameRow?.status).toBe(terminalStatus)

  // (h) Reconstruct the final board from the ARCHIVE (D1 moves), not the DO:
  // replay(initial_state, non-reverted D1 moves) == the DO's final snapshot,
  // byte-for-byte. This is the end-to-end replay-determinism proof.
  const d1Rows = (await DB().prepare('SELECT * FROM moves WHERE game_uuid = ? ORDER BY move_index').bind(gameId).all<Record<string, unknown>>()).results
  const archiveMoves = d1MovesToRows(d1Rows)

  // by_ai rows are present in the archive -> human-vs-AI is separable.
  expect(archiveMoves.some((m) => m.by_ai)).toBe(true)
  expect(archiveMoves.some((m) => !m.by_ai)).toBe(true)
  // The vetoed seat-1 AI move survives as a reverted row (audit) and is skipped.
  expect(archiveMoves.find((m) => m.move_index === covered.moveIndex)!.reverted).toBe(true)

  const initialSerialized = await runInDurableObject(stubFor(gameId), (_i: unknown, state: any) => {
    const repo = new GameRepository(state.storage.sql as SqlLike)
    return serializeState(repo.getInitialState()!)
  })
  const finalSerialized = await runInDurableObject(stubFor(gameId), (_i: unknown, state: any) => {
    const repo = new GameRepository(state.storage.sql as SqlLike)
    return serializeState(repo.getSnapshot()!)
  })

  const rebuilt = replay(deserializeState(initialSerialized), archiveMoves)
  expect(serializeState(rebuilt)).toBe(finalSerialized)
})
