import { DurableObject } from 'cloudflare:workers'
import { initGame } from '@viota/engine'
import { assertSecret } from './auth'
import { runMigrations, GameRepository, type SqlLike, type MoveRow } from './do/storage'
import { initGameForOnline, type SeatOwner } from './do/init'
import { buildClientView } from './do/view'
import { validateMovePayloadShape } from './do/moves'
import { applyAndPersist, type ApplyParams } from './do/apply'

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(s: string): boolean {
  return UUID_RE.test(s)
}

/** Map an applyAndPersist error string to a 4xx status (never a 500). */
function statusForError(error: string): number {
  switch (error) {
    case 'not_your_seat':
      return 403
    case 'game_over':
    case 'not_your_turn':
    case 'conflict':
      return 409
    case 'game_not_found':
    case 'no_snapshot':
      return 404
    default:
      return 400 // engine/illegal-move errors
  }
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

    // WebSocket upgrade (path-agnostic: the Worker forwards the original
    // /games/:id/socket request unchanged).
    if ((request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket') {
      return this.handleWebSocketUpgrade()
    }

    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === 'POST' && path === '/init') {
      return this.handleInit(request)
    }
    if (request.method === 'POST' && path === '/move') {
      return this.handleMove(request)
    }
    if (request.method === 'GET' && path === '/sync') {
      return this.handleSync(url)
    }

    return json({ error: 'not_found' }, 404)
  }

  // ---- WebSocket Hibernation API -----------------------------------------
  //
  // Sockets are accepted via ctx.acceptWebSocket (hibernatable) and handled by
  // the webSocket* DO METHODS below — NEVER server.accept()/addEventListener,
  // which pin the DO in memory and defeat hibernation. Per-socket identity is
  // stashed via serializeAttachment (survives hibernation); fan-out enumerates
  // ctx.getWebSockets() rather than any in-memory Map.

  private handleWebSocketUpgrade(): Response {
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    // Unauthenticated until the first-frame auth handshake succeeds.
    server.serializeAttachment({ authed: false })
    return new Response(null, { status: 101, webSocket: client })
  }

  /** Seat-agnostic broadcast: "there's news at index N" — never any hand data. */
  nudge(moveIndex: number): number {
    const payload = JSON.stringify({ type: 'nudge', moveIndex })
    const sockets = this.ctx.getWebSockets()
    for (const ws of sockets) {
      try {
        ws.send(payload)
      } catch {
        // socket gone; presence handling lands in Phase 4
      }
    }
    return sockets.length
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att =
      (ws.deserializeAttachment() as
        | { authed?: boolean; seatIndex?: number; accountId?: string | null }
        | null) ?? { authed: false }

    const text = typeof message === 'string' ? message : new TextDecoder().decode(message)
    let frame: { type?: string; seatIndex?: number; accountId?: string | null } | null
    try {
      frame = JSON.parse(text)
    } catch {
      frame = null
    }

    if (!att.authed) {
      // First-frame auth handshake. STUB for Phase 1 — Phase 4 verifies the JWT
      // and confirms seat ownership. A missing/invalid frame closes 4001.
      if (frame && frame.type === 'auth' && Number.isInteger(frame.seatIndex) && (frame.seatIndex as number) >= 0) {
        ws.serializeAttachment({ authed: true, seatIndex: frame.seatIndex, accountId: frame.accountId ?? null })
        ws.send(JSON.stringify({ type: 'auth_ok', seat: frame.seatIndex }))
      } else {
        ws.close(4001, 'auth required')
      }
      return
    }

    // Authenticated app frame. Phase 1 scaffold: benign ack (real move/heartbeat
    // handling arrives in later phases; correctness never rides the socket).
    ws.send(JSON.stringify({ type: 'ack', seat: att.seatIndex, echo: frame?.type ?? null }))
  }

  async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // Presence/disconnect + grace-timer arming lands in Phase 4. The socket is
    // already closing; no explicit close call here.
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    // No-op for Phase 1; presence is authoritative over socket state (Phase 4).
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

  /**
   * POST /move — the authoritative move endpoint.
   *
   * The ONLY await is `request.json()`, done BEFORE the synchronous txn span so
   * the input gate stays closed across read->validate->write and a move can
   * never interleave with an alarm onto the same move_index. After the txn
   * commits we `nudge` (commit-then-broadcast — never before commit).
   */
  private async handleMove(request: Request): Promise<Response> {
    let body: {
      seatIndex?: unknown
      move?: unknown
      clientMoveId?: unknown
      accountId?: unknown
    }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return json({ error: 'bad_json' }, 400)
    }

    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)

    // Bounds-validate seatIndex ∈ [0, player_count).
    const seatIndex = body.seatIndex
    if (typeof seatIndex !== 'number' || !Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= meta.player_count) {
      return json({ error: 'invalid_seat' }, 400)
    }

    // clientMoveId is a uuid or null (server-minted AI ids never come via HTTP).
    const clientMoveId = body.clientMoveId ?? null
    if (clientMoveId !== null && !(typeof clientMoveId === 'string' && isUuid(clientMoveId))) {
      return json({ error: 'invalid_client_move_id' }, 400)
    }

    // Move payload shape/bounds (the engine remains the legality gate).
    const shape = validateMovePayloadShape(body.move)
    if (!shape.ok) return json({ error: shape.error }, 400)

    // accountId: a validated input for now; Phase 4 resolves it from the JWT.
    const accountId = typeof body.accountId === 'string' ? body.accountId : null

    const params: ApplyParams = { seatIndex, move: shape.move, clientMoveId, accountId }
    const sql = this.ctx.storage.sql as unknown as SqlLike
    const result = this.ctx.storage.transactionSync(() => applyAndPersist(sql, this.repo, params))

    // Commit-then-broadcast: nudge ONLY after the sync txn returns (committed).
    if ('ok' in result && result.ok) {
      this.nudge(result.moveIndex)
      return json(result, 200)
    }
    if ('duplicate' in result) {
      return json(result, 200) // benign ack, no new move -> no nudge
    }
    return json(result, statusForError(result.error))
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
