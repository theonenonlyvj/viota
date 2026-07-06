import { assertSecret } from './auth'
import { GameDO, type Env } from './game-do'

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Request-time fail-closed secret guard — before any routing.
    const guard = assertSecret(env)
    if (guard) return guard

    const url = new URL(request.url)
    const path = url.pathname

    // POST /games -> mint a gameId, init the DO, return { gameId }.
    if (request.method === 'POST' && path === '/games') {
      const gameId = crypto.randomUUID()
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return json({ error: 'bad_json' }, 400)
      }
      const initBody = JSON.stringify({ ...(body as object), gameUuid: gameId })
      const res = await stubFor(env, gameId).fetch(
        new Request('https://do/init', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: initBody,
        }),
      )
      if (!res.ok) return res // surface the DO's validation error verbatim
      return json({ gameId }, 201)
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
  },
} satisfies ExportedHandler<Env>
