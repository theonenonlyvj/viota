import { requireCanonicalAccount, type IdentityEnv } from '../identity/authctx'
import { longestWinStreak } from './streak'

/**
 * Phase 5 — GET /leaderboard?game=iota&board=<key> (Task 9) and
 * GET /me/stats (Task 10, Bearer). Read-only aggregates over
 * `game_players`+`games`+`accounts` — see
 * docs/superpowers/specs/2026-07-14-viota-stats-leaderboards-design.md §2/§5.
 *
 * Every board is scoped to `game_type='iota'`, a TERMINAL status that has a
 * resolvable winner (`completed` or `stalemate` — 'stalemate' still resolves
 * by score, it is not a forced draw; see game-do.ts's archiveTick), and
 * `owner_type='human'` (AI seats never carry result/opponent_kind/stats).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

const BASE_WHERE = `g.game_type = 'iota' AND g.status IN ('completed','stalemate') AND gp.owner_type = 'human'`

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

type WinAggRow = { account_id: string; display_name: string; username: string | null; games: number; wins: number }
type StreakSeatRow = { account_id: string; display_name: string; username: string | null; result: 'win' | 'loss' | 'draw'; ended_at: number }
type MaxStatRow = { account_id: string; display_name: string; username: string | null; games: number; value: number | null }

/** Round to 4dp — matches the existing `v_leaderboard_all` view's convention
 *  (`ROUND(...,4)`), computed in JS to avoid SQLite float-formatting quirks. */
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

function sortDesc(rows: LeaderboardRow[]): LeaderboardRow[] {
  return rows.sort((a, b) => b.value - a.value || a.accountId.localeCompare(b.accountId))
}

async function winrateBoard(db: D1Database, opponentKind: 'human' | 'ai'): Promise<LeaderboardRow[]> {
  const { results } = await db
    .prepare(
      `SELECT gp.account_id AS account_id, a.display_name AS display_name, a.username AS username,
              COUNT(*) AS games, SUM(gp.result = 'win') AS wins
       FROM game_players gp
       JOIN games g ON g.game_uuid = gp.game_uuid
       JOIN accounts a ON a.id = gp.account_id
       WHERE ${BASE_WHERE} AND gp.opponent_kind = ?
       GROUP BY gp.account_id
       HAVING COUNT(*) >= ?`,
    )
    .bind(opponentKind, MIN_GAMES_FOR_WINRATE)
    .all<WinAggRow>()
  return sortDesc(
    results.map((r) => ({
      accountId: r.account_id,
      displayName: r.display_name,
      username: r.username,
      games: r.games,
      value: round4(r.wins / r.games),
    })),
  )
}

async function winsBoard(db: D1Database, opponentKind: 'human' | 'ai'): Promise<LeaderboardRow[]> {
  const { results } = await db
    .prepare(
      `SELECT gp.account_id AS account_id, a.display_name AS display_name, a.username AS username,
              COUNT(*) AS games, SUM(gp.result = 'win') AS wins
       FROM game_players gp
       JOIN games g ON g.game_uuid = gp.game_uuid
       JOIN accounts a ON a.id = gp.account_id
       WHERE ${BASE_WHERE} AND gp.opponent_kind = ?
       GROUP BY gp.account_id`,
    )
    .bind(opponentKind)
    .all<WinAggRow>()
  return sortDesc(results.map((r) => ({ accountId: r.account_id, displayName: r.display_name, username: r.username, games: r.games, value: r.wins })))
}

/** Longest win streak vs humans. SQL fetches each account's vs-human results
 *  ordered by ended_at; `longestWinStreak` (pure, unit-tested) does the walk
 *  in JS — friend-scale data, no need for a SQL window-function contortion. */
async function streakFriendsBoard(db: D1Database): Promise<LeaderboardRow[]> {
  const { results } = await db
    .prepare(
      `SELECT gp.account_id AS account_id, a.display_name AS display_name, a.username AS username,
              gp.result AS result, g.ended_at AS ended_at
       FROM game_players gp
       JOIN games g ON g.game_uuid = gp.game_uuid
       JOIN accounts a ON a.id = gp.account_id
       WHERE ${BASE_WHERE} AND gp.opponent_kind = 'human'
       ORDER BY gp.account_id ASC, g.ended_at ASC`,
    )
    .all<StreakSeatRow>()

  const byAccount = new Map<string, { displayName: string; username: string | null; results: ('win' | 'loss' | 'draw')[] }>()
  for (const r of results) {
    let entry = byAccount.get(r.account_id)
    if (!entry) {
      entry = { displayName: r.display_name, username: r.username, results: [] }
      byAccount.set(r.account_id, entry)
    }
    entry.results.push(r.result)
  }

  const rows: LeaderboardRow[] = [...byAccount.entries()].map(([accountId, e]) => ({
    accountId,
    displayName: e.displayName,
    username: e.username,
    games: e.results.length,
    value: longestWinStreak(e.results),
  }))
  return sortDesc(rows)
}

/** `bestplay` (max stats.bestPlay) / `bestgame` (max final_score) — span ALL
 *  opponent kinds (spec §2: "flashy boards ... span everything"). */
async function statBoard(db: D1Database, kind: 'bestplay' | 'bestgame'): Promise<LeaderboardRow[]> {
  const valueExpr = kind === 'bestplay' ? `CAST(json_extract(gp.stats, '$.bestPlay') AS INTEGER)` : `gp.final_score`
  const guard = kind === 'bestplay' ? `gp.stats IS NOT NULL` : `gp.final_score IS NOT NULL`
  const { results } = await db
    .prepare(
      `SELECT gp.account_id AS account_id, a.display_name AS display_name, a.username AS username,
              COUNT(*) AS games, MAX(${valueExpr}) AS value
       FROM game_players gp
       JOIN games g ON g.game_uuid = gp.game_uuid
       JOIN accounts a ON a.id = gp.account_id
       WHERE ${BASE_WHERE} AND ${guard}
       GROUP BY gp.account_id`,
    )
    .all<MaxStatRow>()
  return sortDesc(
    results
      .filter((r): r is MaxStatRow & { value: number } => r.value !== null)
      .map((r) => ({ accountId: r.account_id, displayName: r.display_name, username: r.username, games: r.games, value: r.value })),
  )
}

async function loadBoard(db: D1Database, board: BoardKey): Promise<LeaderboardRow[]> {
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

  const rows = await loadBoard(env.DB, board)

  const meAccountId = await tryResolveAccountId(request, env)
  const idx = meAccountId ? rows.findIndex((r) => r.accountId === meAccountId) : -1
  const me = idx >= 0 ? { rank: idx + 1, value: rows[idx]!.value } : undefined

  return json({ board, rows, ...(me ? { me } : {}) })
}
