import { DurableObject } from 'cloudflare:workers'
import { initGame } from '@viota/engine'
import { assertSecret } from './auth'
import { runMigrations, GameRepository, type SqlLike } from './do/storage'

export interface Env {
  GAME_DO: DurableObjectNamespace<GameDO>
  JWT_SECRET?: string
}

/**
 * One Durable Object per game — the warm, single-writer, self-healing actor.
 *
 * Phase 1: schema init in the constructor, request-time secret guard, and the
 * HTTP + WebSocket surface (create / sync / socket) built out task by task.
 */
export class GameDO extends DurableObject<Env> {
  private readonly repo: GameRepository

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Boot smoke-assert: this must be the SQLite-backed DO (new_sqlite_classes),
    // not the paid KV-backed class. `sql` is absent on the KV backend.
    if (!ctx.storage.sql) {
      throw new Error('GameDO requires a SQLite-backed Durable Object (new_sqlite_classes)')
    }
    // Idempotent schema init/rehydration on every boot. blockConcurrencyWhile
    // guarantees no request/alarm runs until migrations complete.
    ctx.blockConcurrencyWhile(async () => {
      runMigrations(ctx.storage.sql as unknown as SqlLike)
    })
    this.repo = new GameRepository(ctx.storage.sql as unknown as SqlLike)
  }

  /** Proves @viota/engine bundles and runs inside the workerd runtime. */
  ping(): number {
    return initGame(2).drawPile.length
  }

  async fetch(request: Request): Promise<Response> {
    // Fail closed before doing anything else (Task 3).
    const guard = assertSecret(this.env)
    if (guard) return guard

    // Real routing lands in Task 5.
    return new Response('game-do-ok', { status: 200 })
  }
}
