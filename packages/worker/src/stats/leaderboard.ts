import { requireCanonicalAccount, type IdentityEnv } from '../identity/authctx'
import { AI_TAKEOVER_GUARD } from './aiTakeoverGuard'
import { longestWinStreak } from './streak'
import { lookupAccountNames, resolveDisplayName, resolveUsername } from './nameLookup'

/**
 * Phase 5 — GET /leaderboard?game=iota&board=<key> (Task 9) and
 * GET /me/stats (Task 10, Bearer). Read-only aggregates over
 * `game_players`+`games` (`DB`) with names resolved from `accounts`
 * (`IDENTITY_DB`) — see
 * docs/superpowers/specs/2026-07-14-viota-stats-leaderboards-design.md §2/§5.
 *
 * Identity code/data split (A8): D1 cannot join across two databases, so a
 * board query no longer `JOIN accounts` — it reads game rows from `DB`
 * (carrying `gp.display_name`, the name recorded at play time, as a
 * fallback), then batch-resolves current display names/usernames from
 * `IDENTITY_DB` via `lookupAccountNames` (chunked <=90 ids/statement) and
 * merges in JS. A row whose account has no matching `accounts` row (deleted,
 * or lookup drift) still appears, using the fallback name — a leaderboard row
 * is never silently dropped over a name-resolution miss.
 *
 * Every board is scoped to `game_type='iota'`, a TERMINAL status that has a
 * resolvable winner (`completed` or `stalemate` — 'stalemate' still resolves
 * by score, it is not a forced draw; see game-do.ts's archiveTick), and
 * `owner_type='human'` (AI seats never carry result/opponent_kind/stats), and
 * the AI-takeover guard (`AI_TAKEOVER_GUARD`) — a human seat the AI covered
 * and won for while the owner was away doesn't count either.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

const BASE_WHERE = `g.game_type = 'iota' AND g.status IN ('completed','stalemate') AND gp.owner_type = 'human' AND ${AI_TAKEOVER_GUARD}`

/** Score-ranked boards (Best play / Best game) rank a SELF-REPORTABLE value —
 *  a single-device local game's final_score/bestPlay has no independent judge,
 *  so anyone could top these from an unverified solo game. They therefore count
 *  SERVER-VERIFIED online games only: `client_reported` (and any unsourced) rows
 *  are excluded (source is forced server-side — see stats/report.ts +
 *  do/archive.ts). Participation/outcome boards (wins/winrate/streak) still
 *  count everything — a self-reported game is a real game played, just not a
 *  trustworthy high score. */
const VERIFIED_ONLY = `g.source = 'online_authoritative'`

/** Win-rate boards require this many QUALIFYING games before a rate is
 *  meaningful enough to rank (spec §2: "min-games floor, e.g. 5"). Applies
 *  identically to winrate-friends and winrate-ai — the raw win-COUNT boards
 *  (wins-friends/wins-ai) have no floor. */
const MIN_GAMES_FOR_WINRATE = 5

export const BOARD_KEYS = ['winrate-friends', 'wins-friends', 'streak-friends', 'winrate-ai', 'wins-ai', 'bestplay', 'bestgame'] as const
export type BoardKey = (typeof BOARD_KEYS)[number]
function isBoardKey(v: string | null): v is BoardKey {
  return v !== null && (BOARD_KEYS as readonly string[]).includes(v)
}

export type LeaderboardRow = { accountId: string; displayName: string; username: string | null; value: number; games: number }

/** Pre-name-resolution board row: `gpDisplayName` is `game_players.display_name`
 *  (the name recorded AT PLAY TIME) — the fallback used if the batched
 *  identity-side lookup has no row for this account (A8). */
type RawBoardRow = { accountId: string; gpDisplayName: string | null; games: number; value: number }

type WinAggRow = { account_id: string; gp_display_name: string | null; games: number; wins: number }
type StreakSeatRow = { account_id: string; gp_display_name: string | null; result: 'win' | 'loss' | 'draw'; ended_at: number }
type MaxStatRow = { account_id: string; gp_display_name: string | null; games: number; value: number | null }

/** Round to 4dp — matches the existing `v_leaderboard_all` view's convention
 *  (`ROUND(...,4)`), computed in JS to avoid SQLite float-formatting quirks. */
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

function sortDescRaw(rows: RawBoardRow[]): RawBoardRow[] {
  return rows.sort((a, b) => b.value - a.value || a.accountId.localeCompare(b.accountId))
}

async function winrateBoard(db: D1Database, opponentKind: 'human' | 'ai'): Promise<RawBoardRow[]> {
  const { results } = await db
    .prepare(
      `SELECT gp.account_id AS account_id, gp.display_name AS gp_display_name,
              COUNT(*) AS games, SUM(gp.result = 'win') AS wins
       FROM game_players gp
       JOIN games g ON g.game_uuid = gp.game_uuid
       WHERE ${BASE_WHERE} AND gp.opponent_kind = ?
       GROUP BY gp.account_id
       HAVING COUNT(*) >= ?`,
    )
    .bind(opponentKind, MIN_GAMES_FOR_WINRATE)
    .all<WinAggRow>()
  return sortDescRaw(
    results.map((r) => ({
      accountId: r.account_id,
      gpDisplayName: r.gp_display_name,
      games: r.games,
      value: round4(r.wins / r.games),
    })),
  )
}

async function winsBoard(db: D1Database, opponentKind: 'human' | 'ai'): Promise<RawBoardRow[]> {
  const { results } = await db
    .prepare(
      `SELECT gp.account_id AS account_id, gp.display_name AS gp_display_name,
              COUNT(*) AS games, SUM(gp.result = 'win') AS wins
       FROM game_players gp
       JOIN games g ON g.game_uuid = gp.game_uuid
       WHERE ${BASE_WHERE} AND gp.opponent_kind = ?
       GROUP BY gp.account_id`,
    )
    .bind(opponentKind)
    .all<WinAggRow>()
  return sortDescRaw(results.map((r) => ({ accountId: r.account_id, gpDisplayName: r.gp_display_name, games: r.games, value: r.wins })))
}

/** Longest win streak vs humans. SQL fetches each account's vs-human results
 *  ordered by ended_at; `longestWinStreak` (pure, unit-tested) does the walk
 *  in JS — friend-scale data, no need for a SQL window-function contortion. */
async function streakFriendsBoard(db: D1Database): Promise<RawBoardRow[]> {
  const { results } = await db
    .prepare(
      `SELECT gp.account_id AS account_id, gp.display_name AS gp_display_name,
              gp.result AS result, g.ended_at AS ended_at
       FROM game_players gp
       JOIN games g ON g.game_uuid = gp.game_uuid
       WHERE ${BASE_WHERE} AND gp.opponent_kind = 'human'
       ORDER BY gp.account_id ASC, g.ended_at ASC`,
    )
    .all<StreakSeatRow>()

  const byAccount = new Map<string, { gpDisplayName: string | null; results: ('win' | 'loss' | 'draw')[] }>()
  for (const r of results) {
    let entry = byAccount.get(r.account_id)
    if (!entry) {
      entry = { gpDisplayName: r.gp_display_name, results: [] }
      byAccount.set(r.account_id, entry)
    }
    entry.results.push(r.result)
  }

  const rows: RawBoardRow[] = [...byAccount.entries()].map(([accountId, e]) => ({
    accountId,
    gpDisplayName: e.gpDisplayName,
    games: e.results.length,
    value: longestWinStreak(e.results),
  }))
  return sortDescRaw(rows)
}

/** `bestplay` (max stats.bestPlay) / `bestgame` (max final_score) — span ALL
 *  opponent kinds (spec §2: "flashy boards ... span everything"), but ONLY
 *  server-verified online games (`VERIFIED_ONLY`): the ranked value is
 *  self-reportable, so an unverified local game must not top the board. */
async function statBoard(db: D1Database, kind: 'bestplay' | 'bestgame'): Promise<RawBoardRow[]> {
  const valueExpr = kind === 'bestplay' ? `CAST(json_extract(gp.stats, '$.bestPlay') AS INTEGER)` : `gp.final_score`
  const guard = kind === 'bestplay' ? `gp.stats IS NOT NULL` : `gp.final_score IS NOT NULL`
  const { results } = await db
    .prepare(
      `SELECT gp.account_id AS account_id, gp.display_name AS gp_display_name,
              COUNT(*) AS games, MAX(${valueExpr}) AS value
       FROM game_players gp
       JOIN games g ON g.game_uuid = gp.game_uuid
       WHERE ${BASE_WHERE} AND ${VERIFIED_ONLY} AND ${guard}
       GROUP BY gp.account_id`,
    )
    .all<MaxStatRow>()
  return sortDescRaw(
    results
      .filter((r): r is MaxStatRow & { value: number } => r.value !== null)
      .map((r) => ({ accountId: r.account_id, gpDisplayName: r.gp_display_name, games: r.games, value: r.value })),
  )
}

async function loadBoard(db: D1Database, board: BoardKey): Promise<RawBoardRow[]> {
  switch (board) {
    case 'winrate-friends':
      return winrateBoard(db, 'human')
    case 'wins-friends':
      return winsBoard(db, 'human')
    case 'streak-friends':
      return streakFriendsBoard(db)
    case 'winrate-ai':
      return winrateBoard(db, 'ai')
    case 'wins-ai':
      return winsBoard(db, 'ai')
    case 'bestplay':
      return statBoard(db, 'bestplay')
    case 'bestgame':
      return statBoard(db, 'bestgame')
  }
}

/** Best-effort Bearer resolution for the OPTIONAL `me` field. Unlike
 *  `requireCanonicalAccount`, a missing/invalid token never fails the
 *  request — the board itself is public; `me` is just omitted. */
async function tryResolveAccountId(request: Request, env: IdentityEnv): Promise<string | null> {
  if (!request.headers.get('Authorization') && !request.headers.get('authorization')) return null
  const auth = await requireCanonicalAccount(request, env)
  return auth instanceof Response ? null : auth.accountId
}

/** `GET /leaderboard?game=iota&board=<key>` */
export async function handleLeaderboard(request: Request, env: IdentityEnv): Promise<Response> {
  const url = new URL(request.url)
  const game = url.searchParams.get('game') ?? 'iota'
  if (game !== 'iota') return json({ error: 'unsupported_game' }, 400)

  const board = url.searchParams.get('board')
  if (!isBoardKey(board)) return json({ error: 'invalid_board' }, 400)

  const rawRows = await loadBoard(env.DB, board)

  // A8: batch-resolve current names from IDENTITY_DB (chunked <=90 ids/stmt),
  // falling back to the game-time display_name when an accounts row is
  // missing. Never a second query when the board is empty.
  const names = await lookupAccountNames(
    env.IDENTITY_DB,
    rawRows.map((r) => r.accountId),
  )
  const rows: LeaderboardRow[] = rawRows.map((r) => ({
    accountId: r.accountId,
    displayName: resolveDisplayName(names, r.accountId, r.gpDisplayName),
    username: resolveUsername(names, r.accountId),
    games: r.games,
    value: r.value,
  }))

  const meAccountId = await tryResolveAccountId(request, env)
  const idx = meAccountId ? rows.findIndex((r) => r.accountId === meAccountId) : -1
  const me = idx >= 0 ? { rank: idx + 1, value: rows[idx]!.value } : undefined

  return json({ board, rows, ...(me ? { me } : {}) })
}
