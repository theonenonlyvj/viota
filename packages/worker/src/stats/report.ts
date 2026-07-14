import { requireCanonicalAccount, type IdentityEnv } from '../identity/authctx'
import { deriveSeatArchiveFields, type ArchiveMoveRow, type ArchiveSeatRow } from './deriveSeatArchive'
import type { StatMove } from './computeSeatStats'

/**
 * Phase 4 (Task 7) — POST /games/report. Uploads a FINISHED local (client-only,
 * vs-AI) game so it counts toward stats/leaderboards. `mode:'local'` games never
 * touch a Durable Object — they run entirely in the browser (Web Worker AI) — so
 * this is the ONLY path that ever archives them.
 *
 * The client sends the raw ingredients (roster + reported final scores/winner +
 * the full move log); the SERVER re-derives result/opponent_kind/stats via the
 * SAME pure helpers the live online archive (do/archive.ts's flushGameEnd) and
 * the backfill (stats/backfill.ts) use — deriveSeatArchiveFields +
 * computeSeatStats + opponentKindFor. There is deliberately no `stats` field in
 * the request body: a client can never hand us a pre-computed stats blob, only
 * the moves it claims happened, from which the SAME derivation the trusted
 * online path uses is re-run. (final_score/winnerSeat are still fundamentally
 * self-reported for a single-device local game with no independent judge —
 * that lower trust tier is exactly why these rows are tagged
 * source='client_reported', kept separate from 'online_authoritative'.)
 *
 * Idempotent by the client-minted `clientGameId`, reused directly as the D1
 * `game_uuid` primary key — a re-POST (e.g. a retry after a flaky network) is a
 * guaranteed no-op via `ON CONFLICT ... DO NOTHING` on both tables, no
 * read-before-write race window.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

type ReportPlayer = { seat: number; accountId?: string | null; ghostId?: string | null; ownerType: 'human' | 'ai'; displayName: string }
type ReportSeat = { seat: number; finalScore: number }

export type ReportBody = {
  clientGameId: string
  playerCount: number
  players: ReportPlayer[]
  winnerSeat: number | null
  seats: ReportSeat[]
  moves: StatMove[]
  startedAt: number
  endedAt: number
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function isPlayer(p: unknown): p is ReportPlayer {
  return (
    isObj(p) &&
    typeof p.seat === 'number' &&
    (p.ownerType === 'human' || p.ownerType === 'ai') &&
    typeof p.displayName === 'string' &&
    (p.accountId === undefined || p.accountId === null || typeof p.accountId === 'string') &&
    (p.ghostId === undefined || p.ghostId === null || typeof p.ghostId === 'string')
  )
}

function isSeat(s: unknown): s is ReportSeat {
  return isObj(s) && typeof s.seat === 'number' && typeof s.finalScore === 'number'
}

function isMove(m: unknown): m is StatMove {
  return (
    isObj(m) &&
    typeof m.seat_index === 'number' &&
    (m.type === 'play' || m.type === 'pass' || m.type === 'wild_recycle') &&
    typeof m.payload === 'string' &&
    typeof m.score_delta === 'number' &&
    typeof m.created_at === 'number'
  )
}

/** Structural validation only (never game-legality — this is analytics data,
 *  not the authoritative engine; a malformed move payload is already handled
 *  defensively by computeSeatStats's own parse guard). Returns null on any
 *  shape mismatch. */
function parseReportBody(raw: unknown): ReportBody | null {
  if (!isObj(raw)) return null
  if (typeof raw.clientGameId !== 'string' || raw.clientGameId.length === 0) return null
  if (typeof raw.playerCount !== 'number') return null
  if (!Array.isArray(raw.players) || raw.players.length === 0 || !raw.players.every(isPlayer)) return null
  if (raw.winnerSeat !== null && typeof raw.winnerSeat !== 'number') return null
  if (!Array.isArray(raw.seats) || !raw.seats.every(isSeat)) return null
  if (!Array.isArray(raw.moves) || !raw.moves.every(isMove)) return null
  if (typeof raw.startedAt !== 'number' || typeof raw.endedAt !== 'number') return null
  return {
    clientGameId: raw.clientGameId,
    playerCount: raw.playerCount,
    players: raw.players as ReportPlayer[],
    winnerSeat: raw.winnerSeat as number | null,
    seats: raw.seats as ReportSeat[],
    moves: raw.moves as StatMove[],
    startedAt: raw.startedAt,
    endedAt: raw.endedAt,
  }
}

/** `POST /games/report` (Bearer, requireCanonicalAccount). */
export async function handleGamesReport(request: Request, env: IdentityEnv): Promise<Response> {
  const auth = await requireCanonicalAccount(request, env)
  if (auth instanceof Response) return auth

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }
  const body = parseReportBody(raw)
  if (!body) return json({ error: 'bad_body' }, 400)

  // The reporter must own a HUMAN seat in the game they're reporting — never
  // let an arbitrary authed caller archive a game on someone else's behalf.
  const ownsASeat = body.players.some((p) => p.ownerType === 'human' && p.accountId === auth.accountId)
  if (!ownsASeat) return json({ error: 'forbidden' }, 403)

  const seatsForKind: ArchiveSeatRow[] = body.players.map((p) => ({ seat_index: p.seat, owner_type: p.ownerType }))
  const movesForStats: ArchiveMoveRow[] = body.moves.map((m) => ({ ...m, by_ai: false }))

  const db = env.DB

  await db
    .prepare(
      `INSERT INTO games
         (game_uuid, mode, status, player_count, source, engine_version,
          winner_seat, outcome, created_at, ended_at, last_activity_at, game_type)
       VALUES (?, 'local', 'completed', ?, 'client_reported', NULL, ?, 'completed', ?, ?, ?, 'iota')
       ON CONFLICT(game_uuid) DO NOTHING`,
    )
    .bind(body.clientGameId, body.playerCount, body.winnerSeat, body.startedAt, body.endedAt, body.endedAt)
    .run()

  const stmts = body.players.map((p) => {
    const finalScore = body.seats.find((s) => s.seat === p.seat)?.finalScore ?? 0
    if (p.ownerType === 'human') {
      // SAME derivation the live archive/backfill use — see deriveSeatArchive.ts.
      const fields = deriveSeatArchiveFields(seatsForKind, movesForStats, p.seat, finalScore, body.winnerSeat, body.startedAt, body.endedAt)
      return db
        .prepare(
          `INSERT INTO game_players
             (game_uuid, seat_index, account_id, ghost_id, owner_type, display_name,
              final_score, result, opponent_kind, stats, total_moves, ai_move_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(game_uuid, seat_index) DO NOTHING`,
        )
        .bind(
          body.clientGameId,
          p.seat,
          p.accountId ?? null,
          p.ghostId ?? null,
          p.ownerType,
          p.displayName,
          finalScore,
          fields.result,
          fields.opponentKind,
          fields.stats,
          fields.totalMoves,
          fields.aiMoveCount,
        )
    }
    // AI seats: identity + score only — never a result/opponent_kind/stats,
    // matching the live archive's per-seat rule (do/archive.ts's flushGameEnd).
    return db
      .prepare(
        `INSERT INTO game_players (game_uuid, seat_index, account_id, ghost_id, owner_type, display_name, final_score)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_uuid, seat_index) DO NOTHING`,
      )
      .bind(body.clientGameId, p.seat, p.accountId ?? null, p.ghostId ?? null, p.ownerType, p.displayName, finalScore)
  })
  if (stmts.length) await db.batch(stmts)

  return json({ ok: true, gameUuid: body.clientGameId })
}
