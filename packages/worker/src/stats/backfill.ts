import { verifyAdminToken, type AdminEnv } from '../identity/admin'
import { deriveSeatArchiveFields, gameStartOf, type ArchiveMoveRow, type ArchiveSeatRow } from './deriveSeatArchive'

/**
 * Phase 3 — one-time (idempotent, re-runnable) backfill for online games
 * archived BEFORE Task 5 started populating `result`/`opponent_kind`/`stats`/
 * `total_moves`/`ai_move_count` at live game-end. Walks `games` rows whose
 * status is terminal-with-a-resolvable-winner (`completed` or `stalemate` —
 * same set `game-do.ts`'s `archiveTick` resolves a `winnerSeatOf` for) that
 * still have a human seat with NULL `result`, loads that game's seats +
 * non-reverted moves, and fills each such seat via `deriveSeatArchiveFields` —
 * the SAME derivation `flushGameEnd` uses live, so backfilled history is
 * bit-for-bit what the live path would have written.
 *
 * Idempotent by construction: the UPDATE's `WHERE ... AND result IS NULL`
 * means an already-filled row can never be rewritten, so re-running this
 * against the same D1 is always safe and eventually reaches a fixed point
 * (zero rows touched).
 */

type GamesRow = { winner_seat: number | null; ended_at: number | null }
type SeatDbRow = { seat_index: number; owner_type: string; final_score: number | null; result: string | null }
type MoveDbRow = { seat_index: number; type: 'play' | 'pass' | 'wild_recycle'; payload: string; score_delta: number; created_at: number; by_ai: number }

export type BackfillResult = { gamesProcessed: number; rowsFilled: number }

/** Backfill every completed/stalemate game with at least one NULL-result
 *  human seat. Bounded to friend-scale history; not paginated (see the admin
 *  route docstring for the re-run story if a future dataset outgrows this). */
export async function backfillStats(db: D1Database): Promise<BackfillResult> {
  const candidates = await db
    .prepare(
      `SELECT DISTINCT g.game_uuid AS game_uuid
       FROM games g
       JOIN game_players gp ON gp.game_uuid = g.game_uuid
       WHERE g.status IN ('completed','stalemate')
         AND gp.owner_type = 'human'
         AND gp.result IS NULL`,
    )
    .all<{ game_uuid: string }>()

  let gamesProcessed = 0
  let rowsFilled = 0

  for (const { game_uuid } of candidates.results) {
    const gameRow = await db.prepare(`SELECT winner_seat, ended_at FROM games WHERE game_uuid = ?`).bind(game_uuid).first<GamesRow>()
    if (!gameRow) continue

    const seatsRes = await db
      .prepare(`SELECT seat_index, owner_type, final_score, result FROM game_players WHERE game_uuid = ?`)
      .bind(game_uuid)
      .all<SeatDbRow>()
    const movesRes = await db
      .prepare(`SELECT seat_index, type, payload, score_delta, by_ai, created_at FROM moves WHERE game_uuid = ? AND reverted = 0 ORDER BY move_index`)
      .bind(game_uuid)
      .all<MoveDbRow>()

    const seats: ArchiveSeatRow[] = seatsRes.results
    const moves: ArchiveMoveRow[] = movesRes.results
    const gameEnd = gameRow.ended_at ?? Date.now()
    const gameStart = gameStartOf(moves, gameEnd)

    const toFill = seatsRes.results.filter((s) => s.owner_type === 'human' && s.result === null)
    gamesProcessed++
    if (!toFill.length) continue // shouldn't happen given the candidate query, but defensive

    const stmts = toFill.map((s) => {
      const fields = deriveSeatArchiveFields(seats, moves, s.seat_index, s.final_score ?? 0, gameRow.winner_seat, gameStart, gameEnd)
      return db
        .prepare(
          `UPDATE game_players
             SET result = ?, opponent_kind = ?, stats = ?, total_moves = ?, ai_move_count = ?
           WHERE game_uuid = ? AND seat_index = ? AND result IS NULL`,
        )
        .bind(fields.result, fields.opponentKind, fields.stats, fields.totalMoves, fields.aiMoveCount, game_uuid, s.seat_index)
    })
    await db.batch(stmts)
    rowsFilled += toFill.length
  }

  return { gamesProcessed, rowsFilled }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * `POST /admin/backfill-stats` — operator-triggered, mirrors `/admin/merge`'s
 * step-up gate EXACTLY: a SEPARATE admin token (`ADMIN_JWT_SECRET`,
 * `aud:'vgames-admin'`), never the player-facing `JWT_SECRET`. No request
 * body. Safe to call repeatedly (see `backfillStats`'s idempotency note).
 */
export async function handleAdminBackfillStats(request: Request, env: { DB: D1Database } & AdminEnv): Promise<Response> {
  const admin = await verifyAdminToken(request, env)
  if (!admin) return json({ error: 'unauthorized' }, 401)

  const result = await backfillStats(env.DB)
  return json(result)
}
