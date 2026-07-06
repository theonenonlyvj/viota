import type { GameState } from '@viota/engine'
import { serializeState, deserializeState } from './state-codec'

/**
 * Durable Object SQLite schema + repository.
 *
 * Uses the SYNCHRONOUS SQLite API (`ctx.storage.sql.exec(...)`) — NOT the async
 * `state.storage.transaction()`. The input gate only stays closed across a
 * synchronous span; an `await` in the middle of a read->write would let a move
 * POST and an alarm interleave onto the same move_index. Every write path in the
 * DO runs as one synchronous span.
 *
 * Columns are TEXT + CHECK, never native ENUM (adding a new status later is an
 * insert, not a painful `ALTER TYPE`). Can't-backfill analytics columns
 * (by_ai, ai_difficulty, controlling_account_id, score_after, client_move_id,
 * reverted, game_uuid, engine_version, ...) all land in this first schema.
 *
 * This is the repository boundary (the exit hatch): the move log is portable
 * SQL that can re-home on Postgres/Turso.
 */

// A structural subset of Cloudflare's SqlStorage (avoids a hard type import).
export interface SqlLike {
  exec(query: string, ...bindings: unknown[]): { [Symbol.iterator](): Iterator<Record<string, unknown>> }
}

export type Migration = (sql: SqlLike) => void

// ---- Migrations ------------------------------------------------------------

const migrateV1: Migration = (sql) => {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      move_index     INTEGER NOT NULL DEFAULT 0,
      status         TEXT    NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','completed','stalemate','abandoned')),
      current_seat   INTEGER NOT NULL DEFAULT 0,
      player_count   INTEGER NOT NULL,
      engine_version TEXT    NOT NULL,
      game_uuid      TEXT    NOT NULL
    )
  `)

  // Immutable, written exactly once: the post-deal GameState (replay anchor).
  sql.exec(`
    CREATE TABLE IF NOT EXISTS initial_state (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL
    )
  `)

  // Rebuildable cache of the current GameState.
  sql.exec(`
    CREATE TABLE IF NOT EXISTS snapshot (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL
    )
  `)

  // Append-only move log — the source of truth for replay + analytics.
  sql.exec(`
    CREATE TABLE IF NOT EXISTS moves (
      move_index             INTEGER PRIMARY KEY,
      turn_number            INTEGER NOT NULL,
      seat_index             INTEGER NOT NULL,
      type                   TEXT    NOT NULL CHECK (type IN ('play','pass','wild_recycle')),
      payload                TEXT    NOT NULL,
      score_delta            INTEGER NOT NULL DEFAULT 0,
      score_after            INTEGER NOT NULL DEFAULT 0,
      by_ai                  INTEGER NOT NULL DEFAULT 0,
      ai_difficulty          TEXT,
      controlling_account_id TEXT,
      client_move_id         TEXT,
      reverted               INTEGER NOT NULL DEFAULT 0,
      created_at             INTEGER NOT NULL,
      UNIQUE (client_move_id)
    )
  `)

  sql.exec(`
    CREATE TABLE IF NOT EXISTS seats (
      seat_index       INTEGER PRIMARY KEY,
      owner_account_id TEXT,
      ghost_id         TEXT,
      owner_type       TEXT    NOT NULL CHECK (owner_type IN ('human','ai','ghost','open')),
      display_name     TEXT,
      ai_difficulty    TEXT,
      controlled_by_ai INTEGER NOT NULL DEFAULT 0,
      disconnected_at  INTEGER,
      last_seen_at     INTEGER,
      final_score      INTEGER
    )
  `)

  // Durable timer-wheel; the single platform alarm is set to min(fire_at).
  sql.exec(`
    CREATE TABLE IF NOT EXISTS timers (
      kind    TEXT    NOT NULL CHECK (kind IN ('grace','turn','ai_step','heal','soft')),
      seat    INTEGER,
      fire_at INTEGER NOT NULL,
      PRIMARY KEY (kind, seat)
    )
  `)
}

/**
 * v2: a single-row `runtime` table holding `last_processed_at` — the wall-clock
 * of the last handler/alarm entry. On the next wake, `gap = now -
 * last_processed_at` reveals how long the DO was evicted (a DO is never told),
 * so a compute gap can be credited to absence deadlines instead of miscounted
 * as player absence.
 */
const migrateV2: Migration = (sql) => {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS runtime (
      id                INTEGER PRIMARY KEY CHECK (id = 1),
      last_processed_at INTEGER
    )
  `)
}

/**
 * v3: a DO-local `archive_outbox` — the write-through queue to the D1 archive
 * (must-fix #8; the Cloudflare Queue is deliberately NOT used). A row is
 * enqueued (`flushed=0`) when a move commits; a `ctx.waitUntil` flush to D1
 * marks it `flushed=1`; the cron/`/tick` retries any still-unflushed rows. On
 * veto the reverted rows are re-enqueued (`flushed=0`) so the `reverted` flip
 * re-propagates to D1. A D1 outage only ever leaves rows unflushed — it can
 * never stall the live game (the DO SQLite copy is authoritative).
 */
const migrateV3: Migration = (sql) => {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS archive_outbox (
      move_index INTEGER PRIMARY KEY,
      flushed    INTEGER NOT NULL DEFAULT 0
    )
  `)
}

/**
 * v4: widen `meta.status` to allow `'waiting'` (a lobby room that has not dealt
 * yet) and add a nullable `code` column (the human room code, so `GET /sync` can
 * echo it to the waiting-room roster). SQLite cannot ALTER a CHECK in place, so
 * the table is rebuilt: create the widened table, copy any in-flight row across
 * (code defaults to NULL), drop the old, rename. Version-gated so it runs once;
 * the `DROP TABLE IF EXISTS meta_v4` guard makes a re-run after a partial failure
 * harmless.
 */
const migrateV4: Migration = (sql) => {
  sql.exec(`DROP TABLE IF EXISTS meta_v4`)
  sql.exec(`
    CREATE TABLE meta_v4 (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      move_index     INTEGER NOT NULL DEFAULT 0,
      status         TEXT    NOT NULL DEFAULT 'active'
                       CHECK (status IN ('waiting','active','completed','stalemate','abandoned')),
      current_seat   INTEGER NOT NULL DEFAULT 0,
      player_count   INTEGER NOT NULL,
      engine_version TEXT    NOT NULL,
      game_uuid      TEXT    NOT NULL,
      code           TEXT
    )
  `)
  sql.exec(
    `INSERT INTO meta_v4 (id, move_index, status, current_seat, player_count, engine_version, game_uuid)
     SELECT id, move_index, status, current_seat, player_count, engine_version, game_uuid FROM meta`,
  )
  sql.exec(`DROP TABLE meta`)
  sql.exec(`ALTER TABLE meta_v4 RENAME TO meta`)
}

/** Ordered migration list. Index i is schema version (i+1). */
export const MIGRATIONS: Migration[] = [migrateV1, migrateV2, migrateV3, migrateV4]

/**
 * Idempotent forward migrator. Safe to run on every DO boot: creates the
 * version table, applies only migrations newer than the stored version, and
 * leaves a single up-to-date `schema_version` row. A 2nd-generation binary
 * opens a 1st-generation DO cleanly.
 */
export function runMigrations(sql: SqlLike, migrations: Migration[] = MIGRATIONS): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`)
  const rows = [...sql.exec(`SELECT version FROM schema_version LIMIT 1`)]
  let current = rows.length ? Number((rows[0] as { version: number }).version) : 0
  if (rows.length === 0) {
    sql.exec(`INSERT INTO schema_version (version) VALUES (0)`)
    current = 0
  }
  for (let v = current; v < migrations.length; v++) {
    migrations[v]!(sql)
  }
  sql.exec(`UPDATE schema_version SET version = ?`, migrations.length)
}

// ---- Row types -------------------------------------------------------------

export type MetaRow = {
  move_index: number
  status: 'waiting' | 'active' | 'completed' | 'stalemate' | 'abandoned'
  current_seat: number
  player_count: number
  engine_version: string
  game_uuid: string
  /** The human room code (multiplayer waiting rooms); null for solo/legacy games. */
  code: string | null
}

export type SeatRow = {
  seat_index: number
  owner_account_id: string | null
  ghost_id: string | null
  owner_type: 'human' | 'ai' | 'ghost' | 'open'
  display_name: string | null
  ai_difficulty: string | null
  controlled_by_ai: boolean
  disconnected_at: number | null
  last_seen_at: number | null
  final_score: number | null
}

export type MoveRow = {
  move_index: number
  turn_number: number
  seat_index: number
  type: 'play' | 'pass' | 'wild_recycle'
  payload: string
  score_delta: number
  score_after: number
  by_ai: boolean
  ai_difficulty: string | null
  controlling_account_id: string | null
  client_move_id: string | null
  reverted: boolean
  created_at: number
}

// ---- Repository ------------------------------------------------------------

export class GameRepository {
  constructor(private readonly sql: SqlLike) {}

  private all(query: string, ...bindings: unknown[]): Record<string, unknown>[] {
    return [...this.sql.exec(query, ...bindings)]
  }

  getMeta(): MetaRow | null {
    const r = this.all(`SELECT * FROM meta WHERE id = 1`)[0]
    if (!r) return null
    return {
      move_index: Number(r.move_index),
      status: r.status as MetaRow['status'],
      current_seat: Number(r.current_seat),
      player_count: Number(r.player_count),
      engine_version: String(r.engine_version),
      game_uuid: String(r.game_uuid),
      code: r.code == null ? null : String(r.code),
    }
  }

  putMeta(m: MetaRow): void {
    this.sql.exec(
      `INSERT INTO meta (id, move_index, status, current_seat, player_count, engine_version, game_uuid, code)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         move_index = excluded.move_index,
         status = excluded.status,
         current_seat = excluded.current_seat,
         player_count = excluded.player_count,
         engine_version = excluded.engine_version,
         game_uuid = excluded.game_uuid,
         code = excluded.code`,
      m.move_index, m.status, m.current_seat, m.player_count, m.engine_version, m.game_uuid, m.code,
    )
  }

  /** Write the immutable post-deal state exactly once; later writes are no-ops. */
  putInitialState(gs: GameState): void {
    this.sql.exec(
      `INSERT INTO initial_state (id, state_json) VALUES (1, ?) ON CONFLICT(id) DO NOTHING`,
      serializeState(gs),
    )
  }

  /** SERVER-ONLY. There is deliberately NO client-reachable path to this. */
  getInitialState(): GameState | null {
    const r = this.all(`SELECT state_json FROM initial_state WHERE id = 1`)[0]
    return r ? deserializeState(String(r.state_json)) : null
  }

  putSnapshot(gs: GameState): void {
    this.sql.exec(
      `INSERT INTO snapshot (id, state_json) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json`,
      serializeState(gs),
    )
  }

  getSnapshot(): GameState | null {
    const r = this.all(`SELECT state_json FROM snapshot WHERE id = 1`)[0]
    return r ? deserializeState(String(r.state_json)) : null
  }

  private static mapMoveRow(r: Record<string, unknown>): MoveRow {
    return {
      move_index: Number(r.move_index),
      turn_number: Number(r.turn_number),
      seat_index: Number(r.seat_index),
      type: r.type as MoveRow['type'],
      payload: String(r.payload),
      score_delta: Number(r.score_delta),
      score_after: Number(r.score_after),
      by_ai: Number(r.by_ai) === 1,
      ai_difficulty: r.ai_difficulty == null ? null : String(r.ai_difficulty),
      controlling_account_id: r.controlling_account_id == null ? null : String(r.controlling_account_id),
      client_move_id: r.client_move_id == null ? null : String(r.client_move_id),
      reverted: Number(r.reverted) === 1,
      created_at: Number(r.created_at),
    }
  }

  getMovesSince(k: number): MoveRow[] {
    return this.all(`SELECT * FROM moves WHERE move_index > ? ORDER BY move_index ASC`, k).map(
      GameRepository.mapMoveRow,
    )
  }

  /** A single move row by index (for the archive write-through), or null. */
  getMove(moveIndex: number): MoveRow | null {
    const r = this.all(`SELECT * FROM moves WHERE move_index = ?`, moveIndex)[0]
    return r ? GameRepository.mapMoveRow(r) : null
  }

  // ---- archive_outbox (DO-local write-through queue to D1) -----------------

  /** Enqueue (or re-arm) a move for D1 flush: sets flushed=0 even if present, so
   *  a veto's reverted rows are re-flushed. Synchronous SQL — safe in a span. */
  enqueueOutbox(moveIndex: number): void {
    this.sql.exec(
      `INSERT INTO archive_outbox (move_index, flushed) VALUES (?, 0)
       ON CONFLICT(move_index) DO UPDATE SET flushed = 0`,
      moveIndex,
    )
  }

  /** Mark an outbox row flushed after its D1 write-through succeeded. */
  markOutboxFlushed(moveIndex: number): void {
    this.sql.exec(`UPDATE archive_outbox SET flushed = 1 WHERE move_index = ?`, moveIndex)
  }

  /** Move indices still awaiting a D1 flush (ascending) — the cron/tick retry set. */
  unflushedOutbox(): number[] {
    return this.all(`SELECT move_index FROM archive_outbox WHERE flushed = 0 ORDER BY move_index ASC`).map(
      (r) => Number(r.move_index),
    )
  }

  /**
   * Append one move row. `move_index` is the PK and `client_move_id` is UNIQUE,
   * so a duplicate index (impossible in a sync span — a backstop) or a duplicate
   * client id will THROW; the caller catches it and returns a benign conflict.
   */
  insertMove(m: MoveRow): void {
    this.sql.exec(
      `INSERT INTO moves
         (move_index, turn_number, seat_index, type, payload, score_delta,
          score_after, by_ai, ai_difficulty, controlling_account_id,
          client_move_id, reverted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      m.move_index,
      m.turn_number,
      m.seat_index,
      m.type,
      m.payload,
      m.score_delta,
      m.score_after,
      m.by_ai ? 1 : 0,
      m.ai_difficulty,
      m.controlling_account_id,
      m.client_move_id,
      m.reverted ? 1 : 0,
      m.created_at,
    )
    // Queue this move for the D1 archive write-through in the SAME sync span it
    // committed in, so EVERY path that appends a move (human, AI drive, CPU-kill
    // floor) is captured atomically — the ctx.waitUntil flush drains it later.
    this.enqueueOutbox(m.move_index)
  }

  /** In-txn idempotency probe (SQLite permits multiple NULL client_move_id). */
  moveExistsByClientId(clientMoveId: string): boolean {
    return this.all(`SELECT 1 FROM moves WHERE client_move_id = ? LIMIT 1`, clientMoveId).length > 0
  }

  /**
   * Count of committed turn-completing moves (play/pass, not reverted). A
   * wild_recycle does NOT complete a turn. `turn_number` for the next move is
   * this count + 1, so a recycle and the play/pass that follows it share a turn.
   */
  countTurnCompletingMoves(): number {
    const r = this.all(`SELECT COUNT(*) AS c FROM moves WHERE type IN ('play','pass') AND reverted = 0`)[0]
    return r ? Number(r.c) : 0
  }

  /**
   * The seat this account owns in THIS game, or null. Ownership is resolved
   * LIVE per request (never trusted from a token claim). A game binds at most
   * one seat per account, so the first match is authoritative.
   */
  seatOwnedBy(accountId: string): SeatRow | null {
    return this.getSeats().find((s) => s.owner_account_id === accountId) ?? null
  }

  /**
   * Mark a move row reverted (NEVER delete — audit + data fidelity). Used only
   * by the bounded veto; replay then skips it. Idempotent.
   */
  markReverted(moveIndex: number): void {
    this.sql.exec(`UPDATE moves SET reverted = 1 WHERE move_index = ?`, moveIndex)
  }

  getSeats(): SeatRow[] {
    return this.all(`SELECT * FROM seats ORDER BY seat_index ASC`).map((r) => ({
      seat_index: Number(r.seat_index),
      owner_account_id: r.owner_account_id == null ? null : String(r.owner_account_id),
      ghost_id: r.ghost_id == null ? null : String(r.ghost_id),
      owner_type: r.owner_type as SeatRow['owner_type'],
      display_name: r.display_name == null ? null : String(r.display_name),
      ai_difficulty: r.ai_difficulty == null ? null : String(r.ai_difficulty),
      controlled_by_ai: Number(r.controlled_by_ai) === 1,
      disconnected_at: r.disconnected_at == null ? null : Number(r.disconnected_at),
      last_seen_at: r.last_seen_at == null ? null : Number(r.last_seen_at),
      final_score: r.final_score == null ? null : Number(r.final_score),
    }))
  }

  /** Wall-clock of the last handler/alarm entry (null before the first one). */
  getLastProcessedAt(): number | null {
    const r = this.all(`SELECT last_processed_at FROM runtime WHERE id = 1`)[0]
    return r && r.last_processed_at != null ? Number(r.last_processed_at) : null
  }

  setLastProcessedAt(now: number): void {
    this.sql.exec(
      `INSERT INTO runtime (id, last_processed_at) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET last_processed_at = excluded.last_processed_at`,
      now,
    )
  }

  /** Targeted AI-control flip (avoids a full read-modify-write of the seat). */
  setControlledByAi(seat: number, value: boolean): void {
    this.sql.exec(`UPDATE seats SET controlled_by_ai = ? WHERE seat_index = ?`, value ? 1 : 0, seat)
  }

  /** Heartbeat: refresh presence and clear any disconnect mark for a seat. */
  setPresence(seat: number, now: number): void {
    this.sql.exec(`UPDATE seats SET last_seen_at = ?, disconnected_at = NULL WHERE seat_index = ?`, now, seat)
  }

  /** Mark a seat disconnected (arming grace/turn is the caller's job). */
  setDisconnectedAt(seat: number, now: number): void {
    this.sql.exec(`UPDATE seats SET disconnected_at = ? WHERE seat_index = ?`, now, seat)
  }

  putSeat(s: SeatRow): void {
    this.sql.exec(
      `INSERT INTO seats
         (seat_index, owner_account_id, ghost_id, owner_type, display_name,
          ai_difficulty, controlled_by_ai, disconnected_at, last_seen_at, final_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(seat_index) DO UPDATE SET
         owner_account_id = excluded.owner_account_id,
         ghost_id = excluded.ghost_id,
         owner_type = excluded.owner_type,
         display_name = excluded.display_name,
         ai_difficulty = excluded.ai_difficulty,
         controlled_by_ai = excluded.controlled_by_ai,
         disconnected_at = excluded.disconnected_at,
         last_seen_at = excluded.last_seen_at,
         final_score = excluded.final_score`,
      s.seat_index,
      s.owner_account_id,
      s.ghost_id,
      s.owner_type,
      s.display_name,
      s.ai_difficulty,
      s.controlled_by_ai ? 1 : 0,
      s.disconnected_at,
      s.last_seen_at,
      s.final_score,
    )
  }
}
