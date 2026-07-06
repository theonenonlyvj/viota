import { DurableObject } from 'cloudflare:workers'
import { initGame } from '@viota/engine'

export interface Env {
  GAME_DO: DurableObjectNamespace<GameDO>
}

/** One Durable Object per game (smoke scaffold — real logic lands in Phase 1+). */
export class GameDO extends DurableObject<Env> {
  /** Proves @viota/engine bundles and runs inside the workerd runtime. */
  ping(): number {
    return initGame(2).drawPile.length
  }

  async fetch(): Promise<Response> {
    return new Response('game-do-ok')
  }
}

export default {
  async fetch(): Promise<Response> {
    return new Response('viota worker')
  },
} satisfies ExportedHandler<Env>
