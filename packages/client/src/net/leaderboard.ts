import { getToken } from './identity'
import { authedFetch } from './http'

/**
 * Leaderboard + personal-stats reads (Phase 6, Tasks 11/12). Mirrors the
 * EXACT worker response shapes — see `packages/worker/src/stats/leaderboard.ts`
 * and `packages/worker/src/stats/me-stats.ts`.
 *
 * `fetchLeaderboard` is a PLAIN (unauthenticated) fetch — a board is public
 * data. Highlighting "my" row is done client-side by the page, comparing
 * `accountId` against the stored device/account id (`identity.ts`'s
 * `getAccountId`) rather than depending on the server's optional `me` field.
 *
 * `fetchMyStats` requires a Bearer token (the server resolves the canonical,
 * post-merge account). With no stored token — or on any failure — it
 * resolves `null` (never throws) so the page can show a friendly empty state
 * instead of an error.
 */

export const BOARD_KEYS = ['winrate-friends', 'wins-friends', 'streak-friends', 'winrate-ai', 'wins-ai', 'bestplay', 'bestgame'] as const
export type BoardKey = (typeof BOARD_KEYS)[number]

export type LeaderboardRow = { accountId: string; displayName: string; username: string | null; value: number; games: number }
export type LeaderboardResponse = { board: BoardKey; rows: LeaderboardRow[]; me?: { rank: number; value: number } }

/** `GET /leaderboard?game=iota&board=<key>` — public, no auth attached. */
export async function fetchLeaderboard(serverUrl: string, board: BoardKey): Promise<LeaderboardResponse> {
  const res = await fetch(`${serverUrl}/leaderboard?game=iota&board=${encodeURIComponent(board)}`)
  if (!res.ok) throw new Error(`leaderboard fetch failed: ${res.status}`)
  return (await res.json()) as LeaderboardResponse
}

export type MeStats = {
  games: number
  vsFriends: { games: number; wins: number; winRate: number; streak: number }
  vsAI: { games: number; wins: number; winRate: number }
  bestPlay: number
  bestGame: number
  playerSince: number | null
  lastPlayed: number | null
  byPlayerCount: { '2': number; '3': number; '4': number }
  totalTimeMs: number
}

/**
 * `GET /me/stats` (Bearer). Returns `null` — never throws — when there's no
 * stored token (a device that never authed has no personal stats yet) or the
 * request fails for any reason, so the page can render a friendly empty
 * state uniformly for "not logged in" and "transient error".
 */
export async function fetchMyStats(serverUrl: string): Promise<MeStats | null> {
  if (!getToken()) return null
  try {
    const res = await authedFetch(serverUrl, '/me/stats', { method: 'GET' })
    if (!res.ok) return null
    return (await res.json()) as MeStats
  } catch {
    return null
  }
}
