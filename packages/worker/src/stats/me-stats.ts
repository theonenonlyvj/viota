import { requireCanonicalAccount, type IdentityEnv } from '../identity/authctx'
import { AI_TAKEOVER_GUARD } from './aiTakeoverGuard'
import { longestWinStreak } from './streak'

/**
 * Phase 5 — GET /me/stats (Task 10, Bearer). The requester's personal
 * aggregate across their own `game_players` rows — same base scope as the
 * leaderboard boards (game_type='iota', a terminal status with a resolvable
 * winner, owner_type='human', the AI-takeover guard), PLUS `result IS NOT
 * NULL` so a game whose archive/backfill write hasn't landed yet (a brief
 * async window right after game-end) is simply not counted yet rather than
 * half-counted.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

export type MeStatsSourceRow = {
  result: 'win' | 'loss' | 'draw'
  opponent_kind: 'human' | 'ai' | null
  final_score: number | null
  stats: string | null
  created_at: number | null
  ended_at: number | null
  player_count: number | null
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

/** `stats` is a JSON string written by `computeSeatStats` — parsed
 *  defensively (an archived row must never crash a read), same posture as
 *  `computeSeatStats.ts`'s own malformed-payload guard. */
function parseStatsField(statsJson: string | null): { bestPlay: number | null; durationMs: number } {
  if (!statsJson) return { bestPlay: null, durationMs: 0 }
  try {
    const parsed = JSON.parse(statsJson) as { bestPlay?: unknown; durationMs?: unknown }
    return {
      bestPlay: typeof parsed.bestPlay === 'number' ? parsed.bestPlay : null,
      durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : 0,
    }
  } catch {
    return { bestPlay: null, durationMs: 0 }
  }
}

/** Pure aggregator over one account's raw qualifying rows — unit-tested
 *  indirectly via the HTTP route (test/me-stats.test.ts); kept separate from
 *  the D1 read so the derivation itself has no I/O. */
export function computeMeStats(rows: MeStatsSourceRow[]): MeStats {
  const friends = rows.filter((r) => r.opponent_kind === 'human')
  const ai = rows.filter((r) => r.opponent_kind === 'ai')

  const friendsResultsByEndedAt = friends
    .slice()
    .sort((a, b) => (a.ended_at ?? 0) - (b.ended_at ?? 0))
    .map((r) => r.result)
  const friendsWins = friends.filter((r) => r.result === 'win').length
  const aiWins = ai.filter((r) => r.result === 'win').length

  const parsed = rows.map((r) => parseStatsField(r.stats))
  const bestPlays = parsed.map((p) => p.bestPlay).filter((v): v is number => v !== null)
  const totalTimeMs = parsed.reduce((sum, p) => sum + p.durationMs, 0)
  const bestGames = rows.map((r) => r.final_score).filter((v): v is number => v !== null)

  const createdTimes = rows.map((r) => r.created_at).filter((v): v is number => v !== null)
  const endedTimes = rows.map((r) => r.ended_at).filter((v): v is number => v !== null)

  const byPlayerCount: MeStats['byPlayerCount'] = { '2': 0, '3': 0, '4': 0 }
  for (const r of rows) {
    const key = String(r.player_count)
    if (key === '2' || key === '3' || key === '4') byPlayerCount[key]++
  }

  return {
    games: rows.length,
    vsFriends: {
      games: friends.length,
      wins: friendsWins,
      winRate: friends.length ? round4(friendsWins / friends.length) : 0,
      streak: longestWinStreak(friendsResultsByEndedAt),
    },
    vsAI: {
      games: ai.length,
      wins: aiWins,
      winRate: ai.length ? round4(aiWins / ai.length) : 0,
    },
    bestPlay: bestPlays.length ? Math.max(...bestPlays) : 0,
    bestGame: bestGames.length ? Math.max(...bestGames) : 0,
    playerSince: createdTimes.length ? Math.min(...createdTimes) : null,
    lastPlayed: endedTimes.length ? Math.max(...endedTimes) : null,
    byPlayerCount,
    totalTimeMs,
  }
}

/** `GET /me/stats` — Bearer required; canonicalized (post-merge) account id. */
export async function handleMeStats(request: Request, env: IdentityEnv): Promise<Response> {
  const auth = await requireCanonicalAccount(request, env)
  if (auth instanceof Response) return auth

  const { results } = await env.DB.prepare(
    `SELECT gp.result AS result, gp.opponent_kind AS opponent_kind, gp.final_score AS final_score, gp.stats AS stats,
            g.created_at AS created_at, g.ended_at AS ended_at, g.player_count AS player_count
     FROM game_players gp
     JOIN games g ON g.game_uuid = gp.game_uuid
     WHERE g.game_type = 'iota' AND g.status IN ('completed','stalemate')
       AND gp.owner_type = 'human' AND gp.result IS NOT NULL
       AND gp.account_id = ? AND ${AI_TAKEOVER_GUARD}`,
  )
    .bind(auth.accountId)
    .all<MeStatsSourceRow>()

  return json(computeMeStats(results))
}
