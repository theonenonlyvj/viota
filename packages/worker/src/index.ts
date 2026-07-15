import { assertSecret } from './auth'
import { GameDO, type Env } from './game-do'
import { routeIdentity } from './identity/router'
import { resolveActiveGameByCode, listResumableGames, setGameStatus } from './do/archive'
import { requireAuth } from './do/authctx'
import { handleAdminBackfillStats } from './stats/backfill'
import { handleLeaderboard } from './stats/leaderboard'
import { handleMeStats } from './stats/me-stats'
import { handleGamesReport } from './stats/report'
import { ABANDON_MS, WAITING_ABANDON_MS } from './do/constants'
import { handlePreflight, withCors } from './cors'

// Cloudflare resolves the Durable Object class from the entry module's exports.
export { GameDO }
export type { Env }

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Resolve the DO stub for a gameId (gameId is the DO name). */
function stubFor(env: Env, gameId: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(gameId))
}

/** JSON content-type + the caller's Authorization (forwarded to a DO that does
 *  its own requireAuth). Omits Authorization when absent so the DO returns 401. */
function authHeadersFrom(request: Request): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' }
  const auth = request.headers.get('Authorization')
  if (auth) h.Authorization = auth
  return h
}

/** A short, human room code (lobby registry key). Excludes ambiguous glyphs. */
function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
}

/**
 * The HTTP router. Returns the raw (pre-CORS) Response; the `fetch` wrapper
 * applies CORS to it. The WebSocket-upgrade branch returns a 101 response, which
 * the wrapper detects (`.webSocket`) and passes through WITHOUT CORS (the WS
 * handshake is not a CORS-governed fetch, and a 101's headers are immutable).
 */
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

    // VGames Identity surface (/auth/*, /claim, /admin/merge) — routed through
    // the SHARED router so viota-worker and the standalone vgames-identity
    // service (src/identity-entry.ts) can't drift. Returns null for a non-
    // identity path, in which case we fall through to gameplay routing below.
    const identity = await routeIdentity(request, env)
    if (identity) return identity

    // POST /admin/backfill-stats -> Phase 3: one-time (idempotent) backfill of
    // result/opponent_kind/stats/total_moves/ai_move_count for online games
    // archived before Task 5 started populating them live. Same admin
    // step-up gate as /admin/merge (ADMIN_JWT_SECRET, aud:'vgames-admin').
    if (request.method === 'POST' && path === '/admin/backfill-stats') {
      return handleAdminBackfillStats(request, env)
    }

    // GET /leaderboard?game=iota&board=<key> -> Phase 5 (Task 9): ranked board
    // rows + the caller's own rank (Bearer optional — public read, `me` is
    // just omitted without a valid token).
    if (request.method === 'GET' && path === '/leaderboard') {
      return handleLeaderboard(request, env)
    }

    // GET /me/stats -> Phase 5 (Task 10): the requester's personal aggregate
    // (Bearer required, canonicalized account).
    if (request.method === 'GET' && path === '/me/stats') {
      return handleMeStats(request, env)
    }

    // POST /games/report -> Phase 4 (Task 7): upload a FINISHED local
    // (client-only, vs-AI) game so it counts toward stats/leaderboards. The
    // client sends raw moves/scores; the server re-derives stats (Bearer
    // required — the reporter must own a human seat in the game).
    if (request.method === 'POST' && path === '/games/report') {
      return handleGamesReport(request, env)
    }

    // GET /my-games -> the authed caller's resumable (waiting/active) games with
    // the seat they own in each. requireAuth (it exposes account-owned data).
    if (request.method === 'GET' && path === '/my-games') {
      const auth = await requireAuth(request, env)
      if (auth instanceof Response) return auth
      const games = await listResumableGames(env.DB, auth.accountId)
      return json({ games })
    }

    // GET /games/resolve?code=CODE -> resolve a room code to its live gameId via
    // the D1 lobby registry (there is no API to enumerate DOs). Public: it only
    // reveals an unguessable gameId; joining still requires auth.
    if (request.method === 'GET' && path === '/games/resolve') {
      const code = (url.searchParams.get('code') ?? '').trim().toUpperCase()
      if (!code) return json({ error: 'missing_code' }, 400)
      const gameId = await resolveActiveGameByCode(env.DB, code)
      if (!gameId) return json({ error: 'not_found' }, 404)
      return json({ gameId })
    }

    // POST /games -> create a game (mint a gameId + room code, init the DO).
    //
    // Authed only, two modes ({ playerCount, mode, displayName }); host = the
    // token account:
    //  - 'solo'        deals immediately (seat 0 host + medium AI fills);
    //  - 'multiplayer' opens a status='waiting' room to join by code, dealt at
    //                  /start by the host.
    // (The legacy unauthed { seatOwners } path was removed in Phase 8.)
    if (request.method === 'POST' && path === '/games') {
      const gameId = crypto.randomUUID()
      let body: any
      try {
        body = await request.json()
      } catch {
        return json({ error: 'bad_json' }, 400)
      }
      const code = generateRoomCode()
      const mode = body?.mode

      if (mode === 'multiplayer') {
        // The DO's /create-room does requireAuth (host = token) + validation, and
        // AWAITS the D1 registry write so an immediate resolve-by-code succeeds.
        const res = await stubFor(env, gameId).fetch(
          new Request('https://do/create-room', {
            method: 'POST',
            headers: authHeadersFrom(request),
            body: JSON.stringify({
              playerCount: body.playerCount,
              displayName: body.displayName,
              aiTakeoverMs: body.aiTakeoverMs, // host's AI-takeover choice (validated in the DO)
              gameUuid: gameId,
              code,
            }),
          }),
        )
        if (!res.ok) return res // surface the DO's 401/validation verbatim
        return json({ gameId, code }, 201)
      }

      if (mode === 'solo') {
        // Seat 0 = the token account; the rest are medium AI (immediate deal).
        const auth = await requireAuth(request, env)
        if (auth instanceof Response) return auth
        const playerCount = body.playerCount
        if (typeof playerCount !== 'number' || playerCount < 2 || playerCount > 4) {
          return json({ error: 'invalid_player_count' }, 400)
        }
        const displayName = typeof body.displayName === 'string' ? body.displayName : ''
        const seatOwners = [
          { ownerType: 'human', accountId: auth.accountId, displayName },
          ...Array.from({ length: playerCount - 1 }, (_, i) => ({
            ownerType: 'ai', aiDifficulty: 'medium', controlledByAi: true, displayName: `AI ${i + 2}`,
          })),
        ]
        const res = await stubFor(env, gameId).fetch(
          new Request('https://do/init', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ playerCount, seatOwners, gameUuid: gameId, code }),
          }),
        )
        if (!res.ok) return res
        return json({ gameId, code }, 201)
      }

      // No recognized mode -> reject (the legacy unauthed seatOwners path is gone).
      return json({ error: 'invalid_mode' }, 400)
    }

    // POST /games/:id/join -> forward to the DO (claim an open waiting-room seat).
    const join = path.match(/^\/games\/([^/]+)\/join$/)
    if (request.method === 'POST' && join) {
      const gameId = decodeURIComponent(join[1]!)
      return stubFor(env, gameId).fetch(new Request('https://do/join', request))
    }

    // POST /games/:id/start -> forward to the DO (deal a waiting room + go live).
    const start = path.match(/^\/games\/([^/]+)\/start$/)
    if (request.method === 'POST' && start) {
      const gameId = decodeURIComponent(start[1]!)
      return stubFor(env, gameId).fetch(new Request('https://do/start', request))
    }

    // POST /games/:id/leave -> forward to the DO (intentional leave = instant cover).
    const leave = path.match(/^\/games\/([^/]+)\/leave$/)
    if (request.method === 'POST' && leave) {
      const gameId = decodeURIComponent(leave[1]!)
      return stubFor(env, gameId).fetch(new Request('https://do/leave', request))
    }

    // POST /games/:id/move -> forward to the DO's authoritative move pipeline.
    const move = path.match(/^\/games\/([^/]+)\/move$/)
    if (request.method === 'POST' && move) {
      const gameId = decodeURIComponent(move[1]!)
      return stubFor(env, gameId).fetch(new Request('https://do/move', request))
    }

    // POST /games/:id/heartbeat -> forward to the DO (presence authority).
    const heartbeat = path.match(/^\/games\/([^/]+)\/heartbeat$/)
    if (request.method === 'POST' && heartbeat) {
      const gameId = decodeURIComponent(heartbeat[1]!)
      return stubFor(env, gameId).fetch(new Request('https://do/heartbeat', request))
    }

    // POST /games/:id/reclaim -> forward to the DO (silent reclaim).
    const reclaim = path.match(/^\/games\/([^/]+)\/reclaim$/)
    if (request.method === 'POST' && reclaim) {
      const gameId = decodeURIComponent(reclaim[1]!)
      return stubFor(env, gameId).fetch(new Request('https://do/reclaim', request))
    }

    // POST /games/:id/veto -> forward to the DO (bounded reversible veto).
    const veto = path.match(/^\/games\/([^/]+)\/veto$/)
    if (request.method === 'POST' && veto) {
      const gameId = decodeURIComponent(veto[1]!)
      return stubFor(env, gameId).fetch(new Request('https://do/veto', request))
    }

    // GET /games/:id/sync?since=k -> forward to the DO (redacted read). The
    // Authorization header MUST be forwarded (the DO resolves the seat from it).
    const sync = path.match(/^\/games\/([^/]+)\/sync$/)
    if (request.method === 'GET' && sync) {
      const gameId = decodeURIComponent(sync[1]!)
      return stubFor(env, gameId).fetch(
        new Request(`https://do/sync${url.search}`, { method: 'GET', headers: request.headers }),
      )
    }

    // WS upgrade for a game -> forward to the DO (Task 6).
    const socket = path.match(/^\/games\/([^/]+)\/socket$/)
    if (socket) {
      const gameId = decodeURIComponent(socket[1]!)
      return stubFor(env, gameId).fetch(request)
    }

    return json({ error: 'not_found' }, 404)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight first — answer OPTIONS for EVERY route (incl. authed ones)
    // before the secret guard, so a browser can complete the real request (which
    // then carries CORS on its own success/error).
    const preflight = handlePreflight(request, env)
    if (preflight) return preflight

    // Request-time fail-closed secret guard — before any routing (with CORS so
    // the browser can read the 503).
    const guard = assertSecret(env)
    if (guard) return withCors(guard, request, env)

    const response = await route(request, env)
    // The WebSocket-upgrade response (101) is exempt from CORS and its headers
    // are immutable — pass it straight through.
    if (response.webSocket) return response
    return withCors(response, request, env)
  },

  /**
   * Cron sweep (1-min trigger) over the lobby-registry index. Two passes:
   *  - stale ACTIVE games (`last_activity_at < now - ABANDON_MS`) → poke each
   *    DO's `/tick`, which re-drives/abandons it and drains unflushed archive
   *    rows (the DO's heal path owns the real 7-day abandon decision);
   *  - stale WAITING rooms (made but never started,
   *    `last_activity_at < now - WAITING_ABANDON_MS`) → mark them 'abandoned' in
   *    D1 (so they drop out of resolve-by-code) and poke `/tick` to freeze.
   * Lightweight: two indexed D1 queries + a fire-and-forget poke per stale game.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (assertSecret(env)) return // fail-closed if misconfigured
    const now = Date.now()

    const active = await env.DB.prepare(
      `SELECT game_uuid FROM games WHERE status = 'active' AND last_activity_at < ?`,
    )
      .bind(now - ABANDON_MS)
      .all<{ game_uuid: string }>()
    for (const { game_uuid } of active.results) {
      ctx.waitUntil(stubFor(env, game_uuid).fetch('https://do/tick', { method: 'POST' }))
    }

    const waiting = await env.DB.prepare(
      `SELECT game_uuid FROM games WHERE status = 'waiting' AND last_activity_at < ?`,
    )
      .bind(now - WAITING_ABANDON_MS)
      .all<{ game_uuid: string }>()
    for (const { game_uuid } of waiting.results) {
      ctx.waitUntil(setGameStatus(env.DB, game_uuid, 'abandoned', now))
      ctx.waitUntil(stubFor(env, game_uuid).fetch('https://do/tick', { method: 'POST' }))
    }
  },
} satisfies ExportedHandler<Env>
