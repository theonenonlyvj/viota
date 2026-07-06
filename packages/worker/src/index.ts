import { assertSecret } from './auth'
import { GameDO, type Env } from './game-do'

// Cloudflare resolves the Durable Object class from the entry module's exports.
export { GameDO }
export type { Env }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Request-time fail-closed secret guard (Task 3) — before any routing.
    const guard = assertSecret(env)
    if (guard) return guard

    // Real routing (POST /games, GET /games/:id/sync, WS upgrade) lands in Task 5/6.
    return new Response('viota worker', { status: 200 })
  },
} satisfies ExportedHandler<Env>
