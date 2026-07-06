import { DurableObject } from 'cloudflare:workers'
import { initGame } from '@viota/engine'
import { assertSecret } from './auth'
import { runMigrations, GameRepository, type SqlLike, type MoveRow } from './do/storage'
import { initGameForOnline, type SeatOwner } from './do/init'
import { buildClientView } from './do/view'

export interface Env {
  GAME_DO: DurableObjectNamespace<GameDO>
  JWT_SECRET?: string
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Public, redacted projection of a persisted move row (no hidden-hand data). */
function toClientMove(m: MoveRow) {
  return {
    moveIndex: m.move_index,
    turnNumber: m.turn_number,
    seatIndex: m.seat_index,
    type: m.type,
    payload: JSON.parse(m.payload) as unknown,
    scoreDelta: m.score_delta,
    scoreAfter: m.score_after,
    byAi: m.by_ai,
  }
}

/**
 * One Durable Object per game — the warm, single-writer, self-healing actor.
 *
 * Phase 1 surface: schema init (constructor), request-time secret guard,
 * `POST /init` (create), `GET /sync` (redacted recovery read), and the
 * WebSocket Hibernation scaffold.
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
    // Fail closed before doing anything else.
    const guard = assertSecret(this.env)
    if (guard) return guard

    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === 'POST' && path === '/init') {
      return this.handleInit(request)
    }
    if (request.method === 'GET' && path === '/sync') {
      return this.handleSync(url)
    }

    return json({ error: 'not_found' }, 404)
  }

  private async handleInit(request: Request): Promise<Response> {
    let body: {
      playerCount?: number
      seatOwners?: SeatOwner[]
      gameUuid?: string
      engineVersion?: string
    }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return json({ error: 'bad_json' }, 400)
    }

    const playerCount = body.playerCount
    if (typeof playerCount !== 'number' || playerCount < 2 || playerCount > 4) {
      return json({ error: 'invalid_player_count' }, 400)
    }
    const seatOwners = Array.isArray(body.seatOwners) ? body.seatOwners : []
    if (seatOwners.length !== playerCount) {
      return json({ error: 'seat_owner_count_mismatch' }, 400)
    }

    const { meta } = initGameForOnline(this.repo, playerCount, seatOwners, {
      engineVersion: body.engineVersion,
      gameUuid: body.gameUuid,
    })

    return json({ gameUuid: meta.game_uuid, moveIndex: meta.move_index, playerCount }, 201)
  }

  private handleSync(url: URL): Response {
    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)

    // Bounds-validate the requesting seat (Phase 4 resolves this from identity;
    // for now it is a declared query param, still range-checked here).
    const seatRaw = url.searchParams.get('seat')
    if (seatRaw === null || seatRaw === '') return json({ error: 'missing_seat' }, 400)
    const seat = Number(seatRaw)
    if (!Number.isInteger(seat) || seat < 0 || seat >= meta.player_count) {
      return json({ error: 'invalid_seat' }, 400)
    }

    const sinceRaw = url.searchParams.get('since')
    const since = sinceRaw == null ? 0 : Number(sinceRaw)
    if (!Number.isInteger(since) || since < 0) {
      return json({ error: 'invalid_since' }, 400)
    }

    const snapshot = this.repo.getSnapshot()
    if (!snapshot) return json({ error: 'no_snapshot' }, 404)

    const moves = this.repo
      .getMovesSince(since)
      .filter((m) => !m.reverted)
      .map(toClientMove)

    return json({
      moveIndex: meta.move_index,
      snapshot: buildClientView(snapshot, seat),
      moves,
    })
  }
}
