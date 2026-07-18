import { getToken, getAccountId, getDisplayName, quickAuth } from './identity'
import { authedFetch } from './http'

/**
 * Phase 4 (Task 8) — uploads a FINISHED local (client-only, vs-AI) game to
 * `POST /games/report` so it counts toward stats/leaderboards, exactly like an
 * online game does. Local games never touch the server while in progress (the
 * AI runs in a Web Worker) — this is the ONE upload point, fired once by the
 * store when a local game reaches `finished` (see gameStore.ts's
 * `reportLocalIfFinished`).
 *
 * Mirrors the server's `POST /games/report` contract EXACTLY (see
 * packages/worker/src/stats/report.ts) — the server RE-DERIVES
 * result/opponent_kind/stats from the raw `moves`; there is deliberately no
 * pre-computed stats blob in this body.
 *
 * Fire-and-forget: never throws, never blocks the UI. A device that has never
 * gone online (no stored token) is silently minted a real, stats-bearing
 * account first — the SAME `quickAuth` P1 already uses the first time a
 * device plays online — otherwise a purely-local player could never accrue
 * stats at all, defeating the point of this endpoint. Any failure (offline,
 * quickAuth failure, a non-ok response) is swallowed.
 */

export type LocalMove = {
  seat_index: number
  type: 'play' | 'pass' | 'wild_recycle'
  payload: string
  score_delta: number
  created_at: number
}

/** The raw ingredients the store hands off at local-game-finish — no identity
 *  resolution yet (that happens here, since it may need an async quickAuth). */
export type FinishedLocalGame = {
  clientGameId: string
  playerCount: number
  humanSeat: number
  scores: number[]
  moves: LocalMove[]
  startedAt: number
  endedAt: number
}

/** argmax of `scores`, or null on a tie (or empty) — mirrors the worker's pure
 *  `winnerSeatOf` (packages/worker/src/do/archive.ts). Duplicated here rather
 *  than imported (the client can never import the worker package); kept
 *  intentionally tiny so the two stay trivially in sync. */
function winnerSeatOfScores(scores: number[]): number | null {
  if (scores.length === 0) return null
  let best = 0
  for (let i = 1; i < scores.length; i++) if ((scores[i] ?? 0) > (scores[best] ?? 0)) best = i
  const max = scores[best] ?? 0
  return scores.filter((s) => s === max).length > 1 ? null : best
}

/** `AI ${seat}` — matches the existing local game-over label convention
 *  (pages/Game.tsx's result modal: `i === humanIndex ? 'You' : \`AI ${i}\``). */
function aiDisplayName(seat: number): string {
  return `AI ${seat}`
}

/** `POST /games/report` for a finished LOCAL game. Never throws. */
export async function reportLocalGame(serverUrl: string, game: FinishedLocalGame): Promise<void> {
  try {
    if (!getToken()) {
      await quickAuth(getDisplayName())
    }
    const accountId = getAccountId()
    if (!accountId) return // no resolvable identity (quickAuth failed/offline) -> nothing to attribute this to

    const players = game.scores.map((_, seat) =>
      seat === game.humanSeat
        ? { seat, accountId, ownerType: 'human' as const, displayName: getDisplayName() }
        : { seat, ownerType: 'ai' as const, displayName: aiDisplayName(seat) },
    )
    const seats = game.scores.map((finalScore, seat) => ({ seat, finalScore }))

    const body = {
      clientGameId: game.clientGameId,
      playerCount: game.playerCount,
      players,
      winnerSeat: winnerSeatOfScores(game.scores),
      seats,
      moves: game.moves,
      startedAt: game.startedAt,
      endedAt: game.endedAt,
    }

    await authedFetch(serverUrl, '/games/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    // fire-and-forget: never throw, never surface to the UI.
  }
}
