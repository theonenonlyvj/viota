import { DurableObject } from 'cloudflare:workers'
import { initGame } from '@viota/engine'
import { assertSecret } from './auth'
import { requireAuth, authenticateToken } from './do/authctx'
import { performVeto } from './do/veto'
import { runMigrations, GameRepository, type SqlLike, type SeatRow } from './do/storage'
import { initGameForOnline, createWaitingRoom, dealInto, type SeatOwner } from './do/init'
import { buildClientView, buildWaitingRoomView } from './do/view'
import { sanitizeDisplayName } from './d1/accounts'
import { toClientMove } from './do/client-move'
import { validateMovePayloadShape } from './do/moves'
import { applyAndPersist, type ApplyParams } from './do/apply'
import { driveIfAI, type DriveDeps } from './do/drive'
import { clearTimer, setTimer, hasTimer, rearmAlarm, dueTimers, minFireAt, creditEvictionGap } from './do/timers'
import { autoCover, seatIndexPresent, isAnyHumanPresent, maxLastSeen, promoteHost, armDisconnectCoverIfAbsent, type CoverDeps } from './do/presence'
import { PRESENCE_MS, HEAL_MS, PAUSE_ABANDON_MS, GLOBAL_SEAT, AI_TAKEOVER_ALLOWED_MS, DEFAULT_AI_TAKEOVER_MS } from './do/constants'
import { flushMove, flushGameCreate, flushGameEnd, touchActivity, upsertGamePlayers, setGameStatus, winnerSeatOf, type GameArchiveRow } from './do/archive'

export interface Env {
  GAME_DO: DurableObjectNamespace<GameDO>
  JWT_SECRET?: string
  /** D1 analytics archive (Phase 5). Written through via ctx.waitUntil; a D1
   *  hiccup can never stall the live game (the DO SQLite copy is authoritative). */
  DB: D1Database
  /** VGames identity data (code/data split, Step 1 — A11): a SECOND binding,
   *  pointed at the SAME database as DB initially (two bindings, one DB;
   *  Step 4 flips only the target). Game code reads identity through this
   *  binding (canonicalization, name lookups, merge reconciliation) and NEVER
   *  writes it (see identity/authctx.ts, stats/*, do/reconcile.ts) — the
   *  identity SERVICE (src/identity-entry.ts, wrangler.identity.toml) owns
   *  writes to its own `DB` binding. */
  IDENTITY_DB: D1Database
  /** The exact browser origin allowed by CORS (the Cloudflare Pages URL). Set in
   *  prod via `[vars]` or `wrangler secret put CLIENT_ORIGIN`. Unset only in
   *  local dev, where CORS falls back to a permissive `*`. See `src/cors.ts`. */
  CLIENT_ORIGIN?: string
  /** VGames identity admin step-up secret (`/admin/merge` only) — deliberately
   *  SEPARATE from JWT_SECRET so a leaked/compromised player token can never
   *  authorize an account merge. Unset in prod until an admin merge is needed;
   *  see wrangler.toml. See `src/identity/admin.ts`. */
  ADMIN_JWT_SECRET?: string
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

/** Server-side allowlist gate for the host-chosen AI-takeover patience: a value
 *  on the allowlist passes through (incl. 0 = "wait for me"); anything else
 *  (absent, non-numeric, off-list) coerces to the default — never trust the
 *  client, never fail the create over it. */
function resolveAiTakeoverMs(raw: unknown): number {
  return typeof raw === 'number' && AI_TAKEOVER_ALLOWED_MS.includes(raw) ? raw : DEFAULT_AI_TAKEOVER_MS
}

/** Map an applyAndPersist error string to a 4xx status (never a 500). */
function statusForError(error: string): number {
  switch (error) {
    case 'not_your_seat':
      return 403
    case 'game_over':
    case 'not_your_turn':
    case 'conflict':
    case 'reclaimed':
      return 409
    case 'game_not_found':
    case 'no_snapshot':
      return 404
    default:
      return 400 // engine/illegal-move errors
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
    if (request.method === 'POST' && path === '/create-room') {
      return this.handleCreateRoom(request)
    }
    if (request.method === 'POST' && path === '/join') {
      return this.handleJoin(request)
    }
    if (request.method === 'POST' && path === '/start') {
      return this.handleStart(request)
    }
    if (request.method === 'POST' && path === '/leave') {
      return this.handleLeave(request)
    }
    if (request.method === 'POST' && path === '/move') {
      return this.handleMove(request)
    }
    if (request.method === 'POST' && path === '/heartbeat') {
      return this.handleHeartbeat(request)
    }
    if (request.method === 'POST' && path === '/reclaim') {
      return this.handleReclaim(request)
    }
    if (request.method === 'POST' && path === '/veto') {
      return this.handleVeto(request)
    }
    if (request.method === 'GET' && path === '/sync') {
      return this.handleSync(request, url)
    }
    if (request.method === 'POST' && path === '/tick') {
      return this.handleTick()
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

  /** Generic seat-agnostic fan-out to every attached socket (nudges, toasts). */
  broadcast(payload: unknown): number {
    const data = JSON.stringify(payload)
    const sockets = this.ctx.getWebSockets()
    for (const ws of sockets) {
      try {
        ws.send(data)
      } catch {
        // socket gone; presence rides heartbeats, not socket state
      }
    }
    return sockets.length
  }

  /** "There's news at index N" — never any hand data. */
  nudge(moveIndex: number): number {
    return this.broadcast({ type: 'nudge', moveIndex })
  }

  /** Deps for the drive loop (the ONLY code path that produces AI moves). */
  private driveDeps(): DriveDeps {
    return { ctx: this.ctx, nudge: (i: number) => this.nudge(i) }
  }

  /** Deps for auto-cover (broadcast the dismissible ai_cover toast). */
  private coverDeps(): CoverDeps {
    return { broadcast: (p: unknown) => this.broadcast(p) }
  }

  // ---- D1 archive write-through (must-fix #8) -----------------------------
  //
  // The DO SQLite copy is authoritative live truth; D1 is the rebuildable
  // archive. Every mutating handler ends with `ctx.waitUntil(archiveTick(now))`
  // (NEVER inside a transactionSync span, NEVER blocking the move response). A
  // D1 failure only leaves outbox rows unflushed for the cron/`/tick` to retry.

  /** Drain the DO-local archive_outbox to D1: every enqueued move (human/AI/
   *  floor) is upserted, then the row is marked flushed. Stops on the first D1
   *  error, leaving the rest unflushed for retry. `db` is injectable for tests. */
  async flushOutbox(now: number, db: D1Database = this.env.DB): Promise<void> {
    const meta = this.repo.getMeta()
    if (!meta) return
    const gameUuid = meta.game_uuid
    let flushedAny = false
    for (const idx of this.repo.unflushedOutbox()) {
      const m = this.repo.getMove(idx)
      if (!m) {
        this.repo.markOutboxFlushed(idx) // orphan index — nothing to archive
        continue
      }
      try {
        await flushMove(db, gameUuid, m)
        this.repo.markOutboxFlushed(idx)
        flushedAny = true
      } catch {
        return // D1 down: leave this + later rows unflushed (cron/tick retries)
      }
    }
    if (flushedAny) {
      try {
        await touchActivity(db, gameUuid, now)
      } catch {
        /* best-effort registry touch; never fatal */
      }
    }
  }

  /** Flush the outbox, then finalize the archive game row iff the game ended. A
   *  game-end tick therefore leaves ZERO unflushed outbox rows. Never rejects.
   *  `seats`/`moves` are read from the DO's OWN already-open local SQLite (no
   *  extra D1 round-trip) so `flushGameEnd` can derive each human seat's
   *  result/opponent_kind/stats in the same write-through pass. */
  async archiveTick(now: number, db: D1Database = this.env.DB): Promise<void> {
    await this.flushOutbox(now, db)
    const meta = this.repo.getMeta()
    if (!meta || meta.status === 'active') return
    const scores = this.repo.getSnapshot()?.scores ?? []
    try {
      await flushGameEnd(db, meta.game_uuid, {
        status: meta.status,
        outcome: meta.status,
        // Iota rule: a stalemate ending (all-pass rounds) still resolves by high
        // score, just like a completed game — it is NOT a forced draw. Only
        // truly winner-less terminal statuses (e.g. abandoned) stay null.
        winnerSeat: meta.status === 'completed' || meta.status === 'stalemate' ? winnerSeatOf(scores) : null,
        endedAt: now,
        lastActivityAt: now,
        finalScores: scores,
        seats: this.repo.getSeats(),
        moves: this.repo.getMovesSince(0).filter((m) => !m.reverted),
      })
    } catch {
      /* leave for the cron retry */
    }
  }

  /** Write the games + game_players index rows to D1 at creation (registry). */
  private async archiveGameCreate(now: number, code: string | null): Promise<void> {
    const meta = this.repo.getMeta()
    if (!meta) return
    const game: GameArchiveRow = {
      gameUuid: meta.game_uuid,
      mode: 'online',
      status: meta.status,
      playerCount: meta.player_count,
      source: 'online_authoritative', // forced server-side; never client-settable
      engineVersion: meta.engine_version,
      createdAt: now,
      lastActivityAt: now,
      code,
    }
    try {
      await flushGameCreate(this.env.DB, game, this.repo.getSeats())
    } catch {
      /* the cron re-touches; a missing archive row never stalls the live game */
    }
  }

  /** Write-through a seat change (a /join) to the D1 game_players index + touch
   *  the registry activity. Best-effort; the DO SQLite copy is authoritative. */
  private async archiveSeats(now: number): Promise<void> {
    const meta = this.repo.getMeta()
    if (!meta) return
    try {
      await upsertGamePlayers(this.env.DB, meta.game_uuid, this.repo.getSeats())
      await touchActivity(this.env.DB, meta.game_uuid, now)
    } catch {
      /* best-effort; the cron re-touches */
    }
  }

  /** Sync the D1 registry when a room goes live at /start: flip the status to
   *  'active' and upsert the final roster (AI fills + joiners). Best-effort. */
  private async archiveGameStart(now: number): Promise<void> {
    const meta = this.repo.getMeta()
    if (!meta) return
    try {
      await setGameStatus(this.env.DB, meta.game_uuid, meta.status, now) // 'active'
      await upsertGamePlayers(this.env.DB, meta.game_uuid, this.repo.getSeats())
    } catch {
      /* the cron re-touches; a missing archive row never stalls the live game */
    }
  }

  // ---- Alarm handler (the never-stall floor + timer-wheel dispatch) --------
  //
  // The single platform Alarm fires at min(fire_at). It is wrapped in try/catch
  // and ALWAYS re-arms before returning (CF abandons an alarm after ~6 retries;
  // we never leave it unset while work remains). On a RETRY (`alarmInfo.isRetry`
  // — CF re-fires the SAME alarm after a kill/throw), we take the O(1) pass
  // floor instead of recomputing, so a CPU limit degrades AI quality, never
  // liveness (must-fix #2). A persisted attempt-counter is deliberately NOT
  // used: a rolled-back counter would re-run the killed path forever.

  async alarm(alarmInfo?: { isRetry?: boolean; retryCount?: number }): Promise<void> {
    const sql = this.ctx.storage.sql as unknown as SqlLike
    const now = Date.now()
    try {
      // Boot grace-quarantine: credit any eviction gap to absence deadlines
      // BEFORE evaluating them, so a compute gap is never miscounted as absence.
      const gap = this.onWake(sql, now)

      if (alarmInfo?.isRetry) {
        this.applyFloor(sql, now)
        await rearmAlarm(this.ctx, sql)
        this.ctx.waitUntil(this.archiveTick(now)) // archive the floor move
        return
      }

      // Normal fire: the platform only fires at/after min(fire_at), so when it
      // fires the earliest timer IS due — process everything up to
      // max(now, min). In production min <= now so this is just `<= now`; the
      // max() also makes the timer fire correct when the harness fires an alarm
      // immediately (ignoring its scheduled time). But after a LONG eviction we
      // just credited (pushed out) every absence deadline, so we must NOT sweep
      // up to the (now-future) min — use `now` and let the re-arm reschedule the
      // credited deadlines into the future (the quarantine window).
      const threshold = gap > PRESENCE_MS ? now : Math.max(now, minFireAt(sql) ?? now)
      for (const t of dueTimers(sql, threshold)) {
        switch (t.kind) {
          case 'grace':
          case 'turn': {
            // A returning human (fresh heartbeat within the presence window) is
            // spared; only an actually-absent seat is covered.
            if (seatIndexPresent(this.repo, t.seat, now)) {
              clearTimer(sql, 'grace', t.seat)
              clearTimer(sql, 'turn', t.seat)
            } else {
              autoCover(this.coverDeps(), this.repo, sql, t.seat, now)
            }
            break
          }
          case 'soft':
            // Retired (Phase 8): a CONNECTED player is NEVER auto-covered. Any
            // legacy `soft` timer is simply cleared so it can't re-fire/cover.
            clearTimer(sql, 'soft', t.seat)
            break
          case 'ai_step':
            clearTimer(sql, 'ai_step', t.seat)
            driveIfAI(this.driveDeps(), this.repo, sql, now)
            break
          case 'heal':
            clearTimer(sql, 'heal', t.seat)
            this.healTick(sql, now)
            break
        }
      }
      // If the turn now rests on a silently-absent human (e.g. an AI chain or
      // floor just advanced onto them), arm their cover deadline so the next
      // alarm can take the seat over — the never-stall floor for a dropped seat.
      armDisconnectCoverIfAbsent(this.repo, sql, now)
      await rearmAlarm(this.ctx, sql)
      // Archive any AI/floor moves the wheel just committed (+ finalize on end).
      this.ctx.waitUntil(this.archiveTick(now))
    } catch {
      // Best-effort re-arm so the wheel is never lost, even on an unexpected throw.
      try {
        await rearmAlarm(this.ctx, sql)
      } catch {
        /* nothing more we can safely do here */
      }
    }
  }

  /**
   * On any DO wake: compute the eviction gap from `last_processed_at`, credit it
   * to absence deadlines (grace/turn/soft) when it exceeds one presence window
   * so a returning player gets a fresh window instead of an instant cover, then
   * stamp `last_processed_at = now`. Returns the gap. Idempotent per wake.
   */
  private onWake(sql: SqlLike, now: number): number {
    const last = this.repo.getLastProcessedAt()
    const gap = last == null ? 0 : now - last
    if (gap > PRESENCE_MS) creditEvictionGap(sql, gap)
    this.repo.setLastProcessedAt(now)
    return gap
  }

  /** Ensure the abandon/re-drive self-tick is armed while the game is active. */
  private ensureHeal(sql: SqlLike, now: number): void {
    if (!hasTimer(sql, 'heal', GLOBAL_SEAT)) setTimer(sql, 'heal', GLOBAL_SEAT, now + HEAL_MS)
  }

  /**
   * The `heal` self-tick: while active, keep re-driving as a safety net and,
   * when ZERO humans have been present for longer than the abandon window, mark
   * the game abandoned (recoverable by replay if reopened). While humans are
   * present (or the abandon window has not elapsed) it re-arms itself.
   */
  private healTick(sql: SqlLike, now: number): void {
    const meta = this.repo.getMeta()
    if (!meta || meta.status !== 'active') return // terminal -> stop ticking

    if (isAnyHumanPresent(this.repo, now)) {
      driveIfAI(this.driveDeps(), this.repo, sql, now) // safety re-drive
      // Backstop: if the on-turn seat is a silently-dropped human, arm its cover
      // deadline. This is the guaranteed catch for a player who was present then
      // went dark mid-turn (no socket-close event ever fires for a locked phone).
      armDisconnectCoverIfAbsent(this.repo, sql, now)
      setTimer(sql, 'heal', GLOBAL_SEAT, now + HEAL_MS)
      return
    }

    const seen = maxLastSeen(this.repo)
    if (seen != null && now - seen > PAUSE_ABANDON_MS) {
      this.repo.putMeta({ ...meta, status: 'abandoned' })
      this.ctx.waitUntil(this.archiveTick(now)) // finalize the abandoned game in D1
      return // stop ticking — the game is abandoned
    }
    // Frozen but not yet abandoned -> keep checking.
    setTimer(sql, 'heal', GLOBAL_SEAT, now + HEAL_MS)
  }

  /**
   * The CPU-kill floor: an O(1) always-legal `applyPass([],[])` for the current
   * AI-covered seat. This CANNOT be CPU-killed, so it guarantees the turn
   * advances past a seat whose smart computation was killed mid-invocation. The
   * deterministic `floor:seat:targetMoveIndex` id makes a re-fire benign.
   */
  private applyFloor(sql: SqlLike, now: number): void {
    const meta = this.repo.getMeta()
    if (!meta || meta.status !== 'active') return
    const seat = meta.current_seat
    const seatRow = this.repo.getSeats()[seat]
    if (!seatRow || !seatRow.controlled_by_ai) return // only floor an AI-covered seat
    const snapshot = this.repo.getSnapshot()
    if (!snapshot) return

    const targetMoveIndex = meta.move_index + 1
    const result = this.ctx.storage.transactionSync(() =>
      applyAndPersist(sql, this.repo, {
        seatIndex: seat,
        move: { type: 'pass', trades: [], tradeOrder: [] },
        clientMoveId: `floor:${seat}:${targetMoveIndex}`,
        accountId: null,
        byAi: true,
        aiDifficulty: 'floor',
        expectedSeat: seat,
        requireAiControlled: true,
        now,
      }),
    )
    if ('ok' in result && result.ok) {
      this.nudge(result.moveIndex)
      // Keep the wheel turning: if the new current seat is AI, schedule a drive.
      const after = this.repo.getMeta()
      if (after && after.status === 'active') {
        const nextRow = this.repo.getSeats()[after.current_seat]
        if (nextRow && nextRow.controlled_by_ai) setTimer(sql, 'ai_step', after.current_seat, now)
      }
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att =
      (ws.deserializeAttachment() as
        | { authed?: boolean; seatIndex?: number; accountId?: string | null }
        | null) ?? { authed: false }

    const text = typeof message === 'string' ? message : new TextDecoder().decode(message)
    let frame: { type?: string; token?: unknown } | null
    try {
      frame = JSON.parse(text)
    } catch {
      frame = null
    }

    if (!att.authed) {
      // First-frame auth handshake. The first frame MUST be `{type:'auth', token}`:
      // verify the JWT, then confirm the account owns a seat in THIS game
      // (resolved live from the seats table — never a token claim). On a missing/
      // invalid token OR a non-owner, close 4001. The identity is stashed via
      // serializeAttachment so it survives hibernation.
      if (!frame || frame.type !== 'auth' || typeof frame.token !== 'string') {
        ws.close(4001, 'auth required')
        return
      }
      const auth = await authenticateToken(frame.token, this.env)
      if (!auth) {
        ws.close(4001, 'invalid token')
        return
      }
      const seat = this.repo.seatOwnedBy(auth.accountId)
      if (!seat) {
        ws.close(4001, 'not a seat owner')
        return
      }
      ws.serializeAttachment({ authed: true, seatIndex: seat.seat_index, accountId: auth.accountId })
      ws.send(JSON.stringify({ type: 'auth_ok', seat: seat.seat_index }))
      return
    }

    // Authenticated app frame. Benign ack — correctness never rides the socket
    // (all mutation + recovery is idempotent HTTP); the socket is only a nudge
    // channel. Nudges stay seat-agnostic (no hand data).
    ws.send(JSON.stringify({ type: 'ack', seat: att.seatIndex, echo: frame?.type ?? null }))
  }

  async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // Deliberately a no-op. Presence is HEARTBEAT-based, not socket-based: a
    // socket close is not proof a player is gone (a locked phone / flaky network
    // reconnects without a clean close, and a close often never fires at all).
    // A silently-dropped on-turn seat is covered instead by `armDisconnectCoverIfAbsent`
    // (armed from the heal tick / after each move / the alarm) once its
    // `last_seen_at` goes stale — the reliable trigger. See presence.ts.
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    // No-op: presence is heartbeat-authoritative over socket state (see webSocketClose).
  }

  private async handleInit(request: Request): Promise<Response> {
    let body: {
      playerCount?: number
      seatOwners?: SeatOwner[]
      gameUuid?: string
      engineVersion?: string
      code?: string
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

    // Lobby-registry + analytics index rows to D1 (write-through, non-blocking).
    const code = typeof body.code === 'string' ? body.code : null
    this.ctx.waitUntil(this.archiveGameCreate(Date.now(), code))

    return json({ gameUuid: meta.game_uuid, moveIndex: meta.move_index, playerCount }, 201)
  }

  /**
   * POST /create-room — the multiplayer waiting-room create. The Worker forwards
   * here with the host's Authorization; `requireAuth` resolves the host account
   * from the token (never a body field). The room is written status='waiting'
   * (seat 0 = host, the rest 'open') and NO deal happens. The D1 registry row is
   * written SYNCHRONOUSLY (awaited) before returning so a friend's immediate
   * GET /resolve?code= finds it.
   */
  private async handleCreateRoom(request: Request): Promise<Response> {
    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    let body: {
      playerCount?: number
      displayName?: unknown
      gameUuid?: string
      engineVersion?: string
      code?: string
      aiTakeoverMs?: unknown
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
    const hostDisplayName = sanitizeDisplayName(body.displayName)

    const { meta } = createWaitingRoom(this.repo, {
      playerCount,
      hostAccountId: auth.accountId,
      hostDisplayName: hostDisplayName.length > 0 ? hostDisplayName : null,
      gameUuid: body.gameUuid,
      engineVersion: body.engineVersion,
      code: typeof body.code === 'string' ? body.code : null,
      aiTakeoverMs: resolveAiTakeoverMs(body.aiTakeoverMs), // allowlisted host choice (0=wait-for-me)
    })

    // The lobby-registry row MUST be resolvable immediately (a friend may join
    // within seconds) — AWAIT this D1 write, unlike the move archive.
    await this.archiveGameCreate(Date.now(), meta.code)

    return json(
      { gameId: meta.game_uuid, code: meta.code, playerCount: meta.player_count, room: buildWaitingRoomView(this.repo) },
      201,
    )
  }

  /**
   * POST /join — claim a seat in a `'waiting'` room. requireAuth; the seat is
   * bound to the token account. Idempotent: an account already holding a seat
   * gets it back. Claims the LOWEST 'open' seat (or an explicit open `seatIndex`)
   * and flips it to a human seat. 409 if the room is full or not waiting.
   */
  private async handleJoin(request: Request): Promise<Response> {
    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    let body: { seatIndex?: unknown; displayName?: unknown }
    try {
      body = (await request.json()) as typeof body
    } catch {
      body = {}
    }

    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)

    const seats = this.repo.getSeats()

    // Idempotent-first (must precede the status gate below): an account that
    // ALREADY owns a seat here gets it back regardless of status, so clicking
    // the invite link back into a game you're already in — waiting OR already
    // STARTED — re-enters it instead of a 409 not_waiting. `room` is the
    // waiting-room roster only while still waiting; once active there's no
    // roster shape to return (the client re-syncs the real board instead), so
    // it's null and the caller routes on `status`. A NEW joiner (no existing
    // seat) is still fully status/full gated below — this never opens a
    // started game to anyone but its own seat-holders.
    const already = seats.find((s) => s.owner_account_id === auth.accountId)
    if (already) {
      return json({
        seatIndex: already.seat_index,
        status: meta.status,
        room: meta.status === 'waiting' ? buildWaitingRoomView(this.repo) : null,
      })
    }

    if (meta.status !== 'waiting') return json({ error: 'not_waiting' }, 409)

    // Resolve the target: an explicit OPEN seatIndex, else the lowest open seat.
    let target: SeatRow | undefined
    if (typeof body.seatIndex === 'number' && Number.isInteger(body.seatIndex)) {
      const s = seats[body.seatIndex]
      if (!s || s.owner_type !== 'open') return json({ error: 'seat_unavailable' }, 409)
      target = s
    } else {
      target = seats.find((s) => s.owner_type === 'open')
    }
    if (!target) return json({ error: 'room_full' }, 409)

    const displayName = sanitizeDisplayName(body.displayName)
    // Single synchronous span (no await between the read above and this write) so
    // two racing joins can never resolve to the same seat.
    this.ctx.storage.transactionSync(() => {
      this.repo.putSeat({
        ...target!,
        owner_type: 'human',
        owner_account_id: auth.accountId,
        display_name: displayName.length > 0 ? displayName : null,
        controlled_by_ai: false,
      })
    })

    // Write-through the joined seat to the D1 game_players index (non-blocking).
    this.ctx.waitUntil(this.archiveSeats(Date.now()))

    return json({ seatIndex: target.seat_index, status: meta.status, room: buildWaitingRoomView(this.repo) })
  }

  /**
   * POST /start — deal a waiting room and go live. requireAuth; ONLY the host
   * seat (`meta.host_seat`) may start (else 403 `not_host`). Requires >=2 HUMAN
   * seats. Remaining 'open' seats are filled with medium AI (the host's choice),
   * then `dealInto` runs the engine deal WITHOUT clobbering the claimed seat
   * owners. Flips the D1 registry to 'active', kicks the drive loop (in case the
   * opening seat is AI), and broadcasts `{type:'started'}` so waiting joiners
   * auto-navigate.
   */
  private async handleStart(request: Request): Promise<Response> {
    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)
    if (meta.status !== 'waiting') return json({ error: 'not_waiting' }, 409)

    const ownSeat = this.repo.seatOwnedBy(auth.accountId)
    if (!ownSeat) return json({ error: 'not_your_seat' }, 403)
    // Host-only start: only the seat holding the host role can deal the room.
    if (ownSeat.seat_index !== (meta.host_seat ?? 0)) return json({ error: 'not_host' }, 403)

    const humanCount = this.repo.getSeats().filter((s) => s.owner_type === 'human').length
    if (humanCount < 2) return json({ error: 'need_two_humans' }, 409)

    const sql = this.ctx.storage.sql as unknown as SqlLike
    const now = Date.now()
    this.onWake(sql, now)

    // Fill open seats with medium AI + deal — one synchronous span. The starter
    // is marked present so the (rare) opening-AI-seat path isn't frozen.
    this.ctx.storage.transactionSync(() => {
      for (const s of this.repo.getSeats()) {
        if (s.owner_type === 'open') {
          this.repo.putSeat({
            ...s,
            owner_type: 'ai',
            controlled_by_ai: true,
            ai_difficulty: 'medium',
            display_name: s.display_name ?? `AI ${s.seat_index + 1}`,
          })
        }
      }
      dealInto(this.repo, meta.player_count)
      this.repo.setPresence(ownSeat.seat_index, now)
    })

    this.ensureHeal(sql, now)
    driveIfAI(this.driveDeps(), this.repo, sql, now)
    await rearmAlarm(this.ctx, sql)

    // Flip the D1 registry to active + sync the final roster (AI fills + joiners).
    this.ctx.waitUntil(this.archiveGameStart(now))
    this.ctx.waitUntil(this.archiveTick(now))

    // Waiting joiners are polling / listening — nudge them into the game.
    this.broadcast({ type: 'started', moveIndex: 0 })

    const snapshot = this.repo.getSnapshot()
    if (!snapshot) return json({ error: 'no_snapshot' }, 500)
    return json({ moveIndex: this.repo.getMeta()!.move_index, snapshot: buildClientView(snapshot, ownSeat.seat_index, this.repo.getSeats()) })
  }

  /**
   * POST /leave — intentional leave. requireAuth; the caller's OWN seat is
   * AI-covered IMMEDIATELY (skips the grace window a silent socket drop waits
   * for) and an `ai_cover` toast is broadcast. The seat stays owned so the player
   * can reclaim it if they return.
   */
  private async handleLeave(request: Request): Promise<Response> {
    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)

    const seat = this.repo.seatOwnedBy(auth.accountId)
    if (!seat) return json({ error: 'not_your_seat' }, 403)

    const sql = this.ctx.storage.sql as unknown as SqlLike
    const now = Date.now()
    this.onWake(sql, now)
    // Instant cover (skip grace): flip controlled_by_ai, arm an immediate drive.
    // In a WAITING room, if the host is the one leaving, promote the host role to
    // the next present human so the room isn't left un-startable — one span.
    let newHost: number | null = null
    this.ctx.storage.transactionSync(() => {
      autoCover(this.coverDeps(), this.repo, sql, seat.seat_index, now)
      if (meta.status === 'waiting') newHost = promoteHost(this.repo, seat.seat_index, now)
    })
    if (newHost != null) this.broadcast({ type: 'host_changed', hostSeat: newHost })
    this.ensureHeal(sql, now)
    driveIfAI(this.driveDeps(), this.repo, sql, now)
    await rearmAlarm(this.ctx, sql)
    this.ctx.waitUntil(this.archiveTick(now))
    return json({ ok: true, seat: seat.seat_index })
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
    }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return json({ error: 'bad_json' }, 400)
    }

    // Authenticate BEFORE the sync txn span (the only awaits are here + json()).
    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)

    // Bounds-validate seatIndex ∈ [0, player_count).
    const seatIndex = body.seatIndex
    if (typeof seatIndex !== 'number' || !Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= meta.player_count) {
      return json({ error: 'invalid_seat' }, 400)
    }

    // Defense-in-depth (audit): a caller may only move its OWN seat. The seat is
    // resolved LIVE from the token and body.seatIndex must match it, so a client
    // can never even NAME a foreign seat — closing the hand-leak at the HTTP door
    // in addition to the in-txn ownership check inside applyAndPersist. (AI/floor
    // moves bypass this path entirely; they call applyAndPersist directly.)
    const ownSeat = this.repo.seatOwnedBy(auth.accountId)
    if (!ownSeat || seatIndex !== ownSeat.seat_index) return json({ error: 'not_your_seat' }, 403)

    // clientMoveId is a uuid or null (server-minted AI ids never come via HTTP).
    const clientMoveId = body.clientMoveId ?? null
    if (clientMoveId !== null && !(typeof clientMoveId === 'string' && isUuid(clientMoveId))) {
      return json({ error: 'invalid_client_move_id' }, 400)
    }

    // Move payload shape/bounds (the engine remains the legality gate).
    const shape = validateMovePayloadShape(body.move)
    if (!shape.ok) return json({ error: shape.error }, 400)

    // The acting account is JWT-derived (never a request-body field) — this is
    // what makes the in-txn authz `accountId === seat.owner_account_id` real.
    const params: ApplyParams = { seatIndex, move: shape.move, clientMoveId, accountId: auth.accountId }
    const sql = this.ctx.storage.sql as unknown as SqlLike
    this.onWake(sql, Date.now()) // credit any eviction gap + stamp last_processed_at
    const result = this.ctx.storage.transactionSync(() => applyAndPersist(sql, this.repo, params))

    // Commit-then-broadcast: handle error/duplicate first (clean union narrowing),
    // then the success path nudges ONLY after the sync txn returned (committed).
    if ('error' in result) {
      return json(result, statusForError(result.error))
    }
    if ('duplicate' in result) {
      return json(result, 200) // benign ack, no new move -> no nudge
    }
    // result is { ok: true }
    this.nudge(result.moveIndex)
    // Drive trigger: the mover took their turn (drop their soft deadline), then
    // let the drive loop carry any now-current AI seat. Re-arm the platform
    // alarm to the new min after the (possible) AI drive.
    const now = Date.now()
    clearTimer(sql, 'soft', seatIndex)
    this.ensureHeal(sql, now) // keep the abandon/re-drive self-tick alive
    driveIfAI(this.driveDeps(), this.repo, sql, now)
    // If the move handed the turn to an already-absent human, arm their cover now
    // (honors the host's patience promptly instead of waiting for the heal tick).
    armDisconnectCoverIfAbsent(this.repo, sql, now)
    await rearmAlarm(this.ctx, sql)
    // Write-through to D1 AFTER the sync commit — never inside it, never blocking
    // the response. Drains this move + any AI move the drive loop just committed,
    // and finalizes the game row if this move ended the game.
    this.ctx.waitUntil(this.archiveTick(now))
    return json(result, 200)
  }

  /**
   * POST /heartbeat {seatIndex} — presence is the SOLE authority for the
   * drive/freeze decision (must-fix #5). Refresh `last_seen_at`, clear any
   * disconnect mark, cancel this seat's absence deadlines (a returning human),
   * and re-run the drive loop (unfreezes a game / hands a covered-but-returned
   * table back on the next iteration). Full silent reclaim is Phase 4.
   */
  private async handleHeartbeat(request: Request): Promise<Response> {
    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)

    // The seat is resolved LIVE from account ownership — a client can never
    // heartbeat (fake presence for) a seat it does not own.
    const seat = this.repo.seatOwnedBy(auth.accountId)
    if (!seat) return json({ error: 'not_your_seat' }, 403)
    const seatIndex = seat.seat_index

    const sql = this.ctx.storage.sql as unknown as SqlLike
    const now = Date.now()
    // A heartbeat is the credit trigger too: it refreshes THIS seat's presence
    // first, so onWake's eviction credit protects the OTHER seats' deadlines.
    this.repo.setPresence(seatIndex, now)
    this.onWake(sql, now)
    clearTimer(sql, 'grace', seatIndex)
    clearTimer(sql, 'turn', seatIndex)
    this.ensureHeal(sql, now)
    driveIfAI(this.driveDeps(), this.repo, sql, now)
    await rearmAlarm(this.ctx, sql)
    // A heartbeat can un-freeze the drive loop and commit an AI move — archive it.
    this.ctx.waitUntil(this.archiveTick(now))
    return json({ ok: true, seat: seatIndex })
  }

  /**
   * POST /reclaim — atomic SILENT reclaim (must-fix "reclaim atomic ordered
   * checklist"). The authed account's own seat is taken back from AI cover in
   * ONE synchronous critical section, in order:
   *   1. cancel this seat's grace/turn/ai_step/soft timers;
   *   2. clear controlled_by_ai;
   *   3. clear disconnected_at + set last_seen_at = now (a fresh heartbeat);
   * then re-arm the platform alarm to the new min(fire_at).
   *
   * A committed AI move is NEVER rolled back here — the human resumes from the
   * CURRENT snapshot (that is the veto's job, not reclaim's). If the reclaimed
   * seat is the current turn, control is now the human's: no auto-cover re-fires
   * (controlled_by_ai is cleared) and driveIfAI is a no-op for it. The redacted
   * snapshot is returned LAST.
   */
  private async handleReclaim(request: Request): Promise<Response> {
    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)

    // Owner-first authz: you may only reclaim the seat you own.
    const seat = this.repo.seatOwnedBy(auth.accountId)
    if (!seat) return json({ error: 'not_your_seat' }, 403)
    const seatIndex = seat.seat_index

    const snapshot = this.repo.getSnapshot()
    if (!snapshot) return json({ error: 'no_snapshot' }, 404)

    const sql = this.ctx.storage.sql as unknown as SqlLike
    const now = Date.now()
    this.onWake(sql, now) // credit any eviction gap + stamp last_processed_at

    // ONE critical section, zero awaits inside — ordered checklist.
    this.ctx.storage.transactionSync(() => {
      clearTimer(sql, 'grace', seatIndex)
      clearTimer(sql, 'turn', seatIndex)
      clearTimer(sql, 'ai_step', seatIndex)
      clearTimer(sql, 'soft', seatIndex)
      this.repo.setControlledByAi(seatIndex, false)
      this.repo.setPresence(seatIndex, now) // last_seen_at = now, disconnected_at = NULL
    })

    // Keep the abandon/re-drive self-tick alive, then re-arm the platform alarm.
    this.ensureHeal(sql, now)
    await rearmAlarm(this.ctx, sql)

    // Redacted snapshot LAST — the human resumes from the current board.
    return json({ moveIndex: meta.move_index, snapshot: buildClientView(snapshot, seatIndex, this.repo.getSeats()) })
  }

  /**
   * POST /veto — the bounded reversible veto (spec §4). Owner-first authz (you
   * veto only the seat you own -> 403). In ONE transactionSync span, `performVeto`
   * reverts the maximal trailing AI run on that seat (only if it forms the global
   * trailing run, else nothing is reverted), rebuilds the snapshot by replay,
   * returns control to the seat, and reclaims it. `meta.move_index` stays at the
   * max — the human's next POST /move lands at max+1. If there is no reversible
   * tail (someone/something committed on top), returns 409 {vetoable:false}.
   */
  private async handleVeto(request: Request): Promise<Response> {
    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)

    // Owner-first authz: you may only veto the seat you own.
    const seat = this.repo.seatOwnedBy(auth.accountId)
    if (!seat) return json({ error: 'not_your_seat' }, 403)
    const seatIndex = seat.seat_index

    const sql = this.ctx.storage.sql as unknown as SqlLike
    const now = Date.now()
    this.onWake(sql, now) // credit any eviction gap + stamp last_processed_at

    // ONE transactionSync: revert the tail, rebuild by replay, reclaim the seat.
    const result = this.ctx.storage.transactionSync(() => performVeto(this.repo, sql, seatIndex, now))
    if (!result.ok) return json({ vetoable: false }, 409)

    // Re-enqueue the reverted rows so their `reverted=1` flip re-propagates to D1
    // (the archive upsert DOes UPDATE reverted — never DO NOTHING for it, or D1
    // replay would re-apply the reverted AI moves).
    for (const idx of result.revertedIndices) this.repo.enqueueOutbox(idx)

    this.ensureHeal(sql, now)
    await rearmAlarm(this.ctx, sql)
    this.ctx.waitUntil(this.archiveTick(now))
    // Seat-agnostic news: the board rolled back (no hand data). Clients re-sync.
    this.broadcast({ type: 'veto', seat: seatIndex, moveIndex: result.moveIndex })

    return json({
      ok: true,
      moveIndex: result.moveIndex, // unchanged max — the human's next /move is +1
      reverted: result.revertedIndices,
      snapshot: buildClientView(result.rebuilt, seatIndex, this.repo.getSeats()),
    })
  }

  /**
   * POST /tick — the cron sweep's self-heal poke (task 5, unauthenticated: only
   * reachable via the DO stub, never the public Worker router). On wake it
   * credits any eviction gap, runs the heal path (safety re-drive while humans
   * are present, or abandon after a long absence), re-arms the wheel, and — since
   * a cron tick is not latency-sensitive — AWAITS the archive drain so any
   * archive_outbox rows a prior D1 hiccup left behind are retried synchronously.
   */
  private async handleTick(): Promise<Response> {
    const sql = this.ctx.storage.sql as unknown as SqlLike
    const now = Date.now()
    this.onWake(sql, now)
    const meta = this.repo.getMeta()
    if (meta && meta.status === 'active') this.healTick(sql, now)
    await rearmAlarm(this.ctx, sql)
    await this.archiveTick(now) // drain unflushed outbox + finalize on end
    return json({ ok: true })
  }

  private async handleSync(request: Request, url: URL): Promise<Response> {
    const auth = await requireAuth(request, this.env)
    if (auth instanceof Response) return auth

    const meta = this.repo.getMeta()
    if (!meta) return json({ error: 'game_not_found' }, 404)

    // The requesting seat is resolved from the account's seat ownership — the
    // read is authorized (403 if the account owns no seat in this game) and the
    // view is then redacted to THAT seat (own hand full, others as counts).
    const ownSeat = this.repo.seatOwnedBy(auth.accountId)
    if (!ownSeat) return json({ error: 'not_your_seat' }, 403)
    const seat = ownSeat.seat_index

    // A 'waiting' room has no deal/board yet — return the roster so the client's
    // WaitingRoom can poll for joiners + the shared code (no redacted board).
    if (meta.status === 'waiting') {
      return json(buildWaitingRoomView(this.repo))
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
      snapshot: buildClientView(snapshot, seat, this.repo.getSeats()),
      moves,
    })
  }
}
