# viota Online (Cloudflare Durable Objects) — Master Implementation Plan

> **For agentic workers:** each Phase below is a sub-project. Its detailed step-level TDD plan (bite-sized steps with complete code, per superpowers:writing-plans) is written just-in-time at the start of that phase, then executed via superpowers:subagent-driven-development. This master plan fixes the file structure, interfaces, sequencing, and test strategy so the phases compose.

**Goal:** Rebuild viota online multiplayer as one Cloudflare Durable Object per game — a warm, single-writer, self-healing actor with durable timers — so games never stall/forfeit and produce a complete, replayable analytics log.

**Architecture:** Authoritative source spec: `docs/superpowers/specs/2026-07-06-viota-online-BEST-architecture.md`. The pure `@viota/engine` (bulletproof) is carried over untouched. One DO per game owns the append-only move log (truth) + rebuildable snapshot (cache) + durable Alarms (liveness). The WebSocket is a one-way "news at index N" nudge; all mutation + recovery is idempotent HTTP. D1 is the queryable archive.

**Tech Stack:** Cloudflare Workers + SQLite-backed Durable Objects + WebSocket Hibernation + Alarms + D1 + Queues + Cron + Pages; `wrangler`; `jose` (JWT); `bcryptjs` (later password path); React + Vite + zustand (client); vitest + `@cloudflare/vitest-pool-workers` (Miniflare) for Worker/DO tests; the existing vitest for `@viota/engine`.

## Global Constraints (every task inherits these)

- **Design on the SQLite-backed DO class only** (the KV-backed class is paid). Verified free: Workers Free plan, 5 GB / 1 GB-per-object, ~100k req/day.
- **`@viota/engine` is immutable here.** It is the sole legality/scoring authority. Never fork or reimplement its rules. Import and call it.
- **Server is authoritative.** Online clients never mutate state optimistically — render a "pending" affordance, commit only on the authoritative echo carrying `moveIndex`.
- **Commit-then-broadcast, always.** Persist inside `state.storage.transaction()`, commit, then fan out. Never broadcast before commit.
- **`move_index` is server-derived** (`meta.moveIndex + 1`), never client-supplied; PK in DO storage; `UNIQUE`.
- **No liveness decision trusts a client timer.** All deadlines are server-side storage columns; Alarms drive them.
- **Token in the WS first-message auth frame + HTTP `Authorization` header — never the URL.**
- **Every read is authorized + per-seat redacted** (`buildClientView`: own hand; others as counts). Never return the raw snapshot.
- **The Worker refuses to boot** if `JWT_SECRET` is unset, a known dev default, or < 32 bytes.
- **Can't-backfill columns land in the first schema:** `initial_state`, `move_index`, `turn_number`, `by_ai`, `ai_difficulty`, `controlling_account_id`, `score_after`, `client_move_id`, `reverted`, `think_ms`, `game_uuid`, `outcome`, `source`, `engine_version`.
- **TDD, DRY, YAGNI, frequent commits.** TEXT+CHECK columns, not native ENUM.

## Repository Shape (target)

```
packages/
  engine/                     # UNCHANGED (carried over)
  worker/                     # NEW — Cloudflare Worker + Durable Object
    src/
      index.ts                # Worker entry: routing, boot secret-guard, DO + D1 + Queue bindings
      auth.ts                 # jose JWT sign/verify, quick-account, device_credential, boot guard
      http.ts                 # REST handlers: /move /sync /heartbeat /reclaim /rooms* /auth*
      game-do.ts              # GameDO class: fetch(), webSocketMessage(), alarm()
      do/
        storage.ts            # DO SQLite schema + repository (moves, snapshot, seats, timers, meta, initial_state)
        apply.ts              # applyAndPersist: txn -> engine validate -> write {move,snapshot,meta} -> commit
        drive.ts              # driveIfAI loop + AI floor (attempt-counter) 
        timers.ts             # durable timer-wheel: setTimer/min-alarm/onAlarm dispatch
        presence.ts           # heartbeat/last_seen, disconnect detection, reclaim critical section
        veto.ts               # bounded reversible veto (tail-only, own-seat, mark-reverted, rebuild-by-replay)
        view.ts               # per-seat redacted buildClientView + moveIndex nudge payloads
      archive.ts              # D1 write-through via Queue consumer + end-of-game force-flush + cron sweep
      validate.ts             # inbound message schema/bounds guards (zod-lite or hand-rolled)
    schema/d1.sql             # D1 archive schema (accounts, games, game_players, moves)
    test/                     # Miniflare (@cloudflare/vitest-pool-workers) integration tests
    wrangler.toml
  client/                     # React app -> Cloudflare Pages
    src/
      net/                    # HTTP-first client: sync(), postMove() (outbox), heartbeat, reclaim, ws-nudge
      store/                  # online store: pending affordance, snapshot-replace, reconcile on 4 events
      db/outbox.ts            # IndexedDB move outbox + ghost-game store
      pages/ components/      # reuse/adapt existing Board/Hand/TopBar/etc.
```

---

## Phase 1 — Cloudflare scaffold + engine carryover + hello-DO

**Deliverable:** a deployable Worker with a `GameDO` that creates a game, holds `initial_state`, and returns a redacted snapshot over HTTP; engine imported and green; Pages builds the existing client. No gameplay yet.

**Files:** create `packages/worker/{wrangler.toml,src/index.ts,src/game-do.ts,src/do/storage.ts,src/do/view.ts}`, `packages/worker/test/*`; add worker to `pnpm-workspace.yaml`; wire `@viota/engine` as a workspace dep of the worker.

**Interfaces produced:**
- `class GameDO` with `fetch(req)`; `POST /games` (create) → `{gameId}`; `GET /games/:id/sync?since=k` → `{moveIndex, snapshot, moves}`.
- `initGameForOnline(playerCount, seats) -> {initialState: GameState, meta}` (wraps engine `initGame`, capturing the post-deal state).
- DO storage repo: `getMeta()`, `getSnapshotView(seatIndex)`, `getMovesSince(k)`, `putInitialState(gs)`.

**Tasks:** (1) worker scaffold + `wrangler.toml` + secret-boot-guard test (Worker throws on default/short `JWT_SECRET`). (2) `GameDO` skeleton + DO SQLite schema (meta, initial_state, moves, seats, snapshot, timers). (3) `initGameForOnline` capturing post-deal `initial_state`; test the deal is persisted immutably. (4) `GET /sync` returns a per-seat redacted view + `moveIndex=0`; test redaction (seat sees own hand, others as counts). (5) Pages build of existing client. (6) Miniflare test harness green + commit.

**Tests:** Miniflare: create game → sync → assert redaction + immutable initial_state. Engine suite stays green (unchanged).

## Phase 2 — Authoritative move pipeline (applyAndPersist + idempotency + replay)

**Deliverable:** legal moves apply through the engine, persist atomically (move + snapshot + meta), and are idempotent; a game replays deterministically from `initial_state` + moves.

**Interfaces produced:**
- `applyAndPersist(do, seatIndex, move, clientMoveId) -> {ok, moveIndex, view} | {duplicate, view} | {error}`.
- `POST /games/:id/move` HTTP handler (body: `{seatIndex, move, clientMoveId}`).
- `replay(initialState, moves) -> GameState` (fold through engine; skips `reverted`).

**Tasks:** (1) `applyAndPersist` transaction: read `moveIndex` → idempotency check on `lastClientMoveId` → engine `validatePlay`/`applyPlay`/`applyPass`/`applyWildRecycle` → write `{move(move_index,turn_number,by_ai,controlling_account_id,score_delta,score_after,client_move_id), snapshot, meta}` → commit. (2) idempotency test: same `clientMoveId` twice → one row, benign ack. (3) `UNIQUE(move_index)` + server-derived index test. (4) `replay()` determinism test: replay == live snapshot, hidden hands reconstructed. (5) `POST /move` handler + authz + bounds-validate. (6) commit-then-broadcast ordering test (broadcast only after txn commit). Commit each.

**Tests:** Miniflare: play a scripted 2-seat game via `/move`; assert exactly-once, idempotent retry, replay equality, redaction on echo.

## Phase 3 — Never-stall engine (drive loop + durable timer wheel + auto-cover + floor)

**Deliverable:** an AI-controlled seat is driven every turn, chains across seats, survives DO eviction/redeploy, and can never stall — proven by test.

**Interfaces produced:**
- `driveIfAI(do)` (only AI path); `timers`: `setTimer(kind,seat,fireAt)`, `alarm()` dispatch to `min(fire_at)`.
- seat control: `controlled_by_ai`, `disconnected_at`, `last_seen_at` columns; `autoCover(seat)`.
- AI floor: attempt-counter + `applyPass([],[])` on detected CPU-kill.

**Tasks:** (1) durable timer-wheel (setTimer/min-alarm/onAlarm) + test alarm re-fire after simulated eviction. (2) `driveIfAI` medium-AI chained-alarm loop; test one AI seat drives a full game to end (kills the one-move-stall). (3) chain across two consecutive AI seats. (4) two-clock timers (grace 120s off-turn, away-turn 25–30s on-turn) + soft per-turn; test present players aren't held hostage. (5) auto-cover via toast event (no blocking vote). (6) attempt-counter floor: simulate a killed smart step → pass floor advances the turn. (7) freeze when zero humans; boot grace-quarantine on wake. Commit each.

**Tests:** Miniflare integration: 4-seat game, one seat AI-driven through multiple wrap-arounds to completion; eviction mid-game (alarm resumes); CPU-kill floor; freeze/resume.

## Phase 4 — Identity, auth, presence, silent reclaim

**Deliverable:** quick-account identity with a durable device credential; JWT via jose; heartbeat presence; seat-bound silent reclaim; the bounded reversible veto.

**Interfaces produced:**
- `auth.ts`: `mintQuickAccount(displayName, deviceCredential)`, `signToken(account)`, `verifyToken`, boot guard.
- `POST /auth/quick`, `POST /heartbeat`, `POST /games/:id/reclaim`, `POST /games/:id/veto`.
- reclaim critical section; veto (`reverted` + `rebuild-by-replay`).

**Tasks:** (1) quick-account mint + device_credential mapping + jose sign/verify tests; boot guard test. (2) `/heartbeat` presence (45s window) authoritative over ws ping. (3) disconnect detection → grace timer. (4) `/reclaim` critical section: cancel grace/away/ai_step, `controlled_by_ai=false`, snapshot last; test reclaim mid-AI-chain is a no-op next iteration. (5) bounded veto: tail-only + own-seat guard, mark `reverted`, rebuild snapshot by replay, next `move_index` for the human; tests incl. the "someone built on top → no undo" case. (6) read-authz on every endpoint. Commit each.

**Tests:** Miniflare: drop→cover→reclaim happy path; reclaim during AI chain; veto accept/reject; unauthorized read rejected; forged/short secret refused at boot.

## Phase 5 — D1 archive + Queue + cron sweep

**Deliverable:** every committed move write-through to D1 (idempotent), end-of-game force-flush, cron sweeper for stale games; live play never blocked by D1.

**Interfaces produced:** `enqueueArchive(gameId, move)`, Queue consumer upserting `ON CONFLICT DO NOTHING`, `forceFlush(gameId)`, cron `sweepStaleGames()`.

**Tasks:** (1) `schema/d1.sql` (accounts, games, game_players, moves — all analytics dims). (2) Queue producer on commit + consumer upsert; test idempotent re-flush. (3) end-of-game force-flush + `outcome`/`winner_seat`. (4) cron sweep marks `abandoned`, pokes stale active games. (5) archive lag never stalls live game (test D1 unavailable → game proceeds). Commit each.

## Phase 6 — Client rewrite (HTTP-first net + reconcile + outbox + UI)

**Deliverable:** the React client plays online over the HTTP-first protocol with instant reconcile on all four foreground events, an IndexedDB outbox, silent reclaim, pending affordance, Rematch/Leave; ghost solo games claim on login.

**Interfaces consumed:** all Phase 1–5 HTTP endpoints + ws nudge.

**Tasks:** (1) `net/`: `sync(since)`, `postMove` (via outbox), `heartbeat`, `reclaim`, ws-nudge with infinite capped backoff (remove MAX_RETRIES); token out of URL. (2) reconcile on `visibilitychange`, `pageshow`, `online`, ws `onopen` → `/sync` replace-wholesale → drain outbox. (3) online store: pending affordance, snapshot-replace on `moveIndex`. (4) quick-account UI (name → account) + device_credential in localStorage. (5) wire OnlineGame fully (state/gameOver/error/toast-cover/reclaim/veto banners; real draw-pile count). (6) Rematch + Leave. (7) ghost solo IndexedDB store + end-of-game push + claim-on-login. Commit each.

**Tests:** component/store tests (jsdom); a scripted drop→cover→reclaim in the store against a mock net; outbox idempotent drain.

## Phase 7 — End-to-end + analytics capture verification + deploy

**Deliverable:** full two-client game via Miniflare + a deployed Pages+Worker; verified complete replayable analytics.

**Tasks:** (1) E2E: two simulated clients, one backgrounds/drops and returns, game completes and persists; assert move log completeness + replay equality + human-vs-AI separability (`by_ai`/`controlling_account_id`). (2) deploy Worker + DO + D1 + Pages; smoke test on real Cloudflare free tier. (3) confirm cold-path (first request wakes DO sub-second). Commit + tag.

## Sequencing & dependencies

P1 → P2 → P3 depend in order (state → moves → liveness). P4 depends on P2 (moves) + P3 (timers). P5 depends on P2. P6 depends on P1–P5 endpoints. P7 integrates all. Each phase is independently testable and leaves the tree green.

## Testing strategy (whole plan)

- Engine suite unchanged and green throughout (regression guard).
- Worker/DO: `@cloudflare/vitest-pool-workers` (Miniflare) with real DO storage + a local D1 — NOT a Postgres/pglite stand-in.
- The never-stall guarantee is the flagship integration test (Phase 3) and the E2E (Phase 7): a game with AI-covered seats through wrap-arounds, an eviction, a CPU-kill floor, and a drop→cover→reclaim, all reaching a correct persisted end.

## Risks / open items

- **Cloudflare go/no-go (Vijay).** Everything here assumes the platform decision in §0 of the spec. The Neon+Render fallback (spec §11) reuses P2's data model, P4 identity, P6 client, and P7 analytics; only the DO-specific liveness (P3) and storage (P1/P2 txn) change to the SELECT-FOR-UPDATE + advisory-lock + watchdog form.
- Detailed per-phase TDD plans are authored JIT at each phase start (bite-sized steps + complete code) per superpowers:writing-plans, then executed via superpowers:subagent-driven-development.

---

# COUNCIL CORRECTIONS v1 (authoritative — override the above where they conflict)

A 5-expert plan council (Cloudflare/DO platform, distributed-correctness, buildability, security + chair) reviewed this plan. **Verdict: keep the DO-per-game architecture (no fatal flaw); fold these in before writing code.** Full review: `tasks/wga66hw0i.output`.

## Amended Global Constraints (replace/augment the originals)

- **Atomic commit uses the SYNCHRONOUS SQLite API, not `state.storage.transaction()`.** Parse the request body first (`await request.json()`), then run read(moveIndex)→engine-validate→write{move,snapshot,meta} as ONE synchronous span via `ctx.storage.sql.exec(...)` inside `ctx.storage.transactionSync(...)` with **zero awaits** (input gates only close during a synchronous span; an await opens the gate and lets a move POST and an alarm interleave onto the same move_index). `UNIQUE(move_index)` is an **explicitly-handled** backstop: on violation, re-read meta + re-derive, or return a benign 409 → client re-syncs.
- **Identity is threaded from Phase 1/2, not Phase 4.** Signature: `applyAndPersist(ctx, accountId, seatIndex, move, clientMoveId)`. `seats.owner_account_id` is a first-schema column. Inside the write txn, assert `seats[seatIndex].owner_account_id === accountId` before validating. Authz + redaction + bounds-validation are per-handler guarded steps co-designed with every endpoint, never a retrofit.
- **Heartbeat (`last_seen_at` within 45s) is the SOLE presence authority** for BOTH `driveIfAI` and freeze/abandon. NEVER gate on `ctx.getWebSockets()` count (it counts hibernated sockets and disagrees with a mid-reconnect present player). Socket state decides only *who receives nudges*. Add `POST /heartbeat` to the `driveIfAI` trigger list.
- **Secret guard is a request-time fail-closed 503**, not a module-scope throw (Workers has no boot; secret bindings exist only inside `fetch()`/the DO constructor). At the top of `fetch()` and the DO constructor: `if (!env.JWT_SECRET || knownDevDefaults.has(env.JWT_SECRET) /*constant-time*/ || byteLength(env.JWT_SECRET) < 32) return 503`. `JWT_SECRET` is a `wrangler secret put` binding, never a `[vars]` entry.
- **`wrangler.toml` migration MUST use `new_sqlite_classes = ["GameDO"]`** (NOT `new_classes` → that requests the paid KV backend). Include explicit `[[durable_objects.bindings]]` (`GAME_DO`), `[[d1_databases]]`, `[triggers] crons = ["* * * * *"]` (1-min CF floor), and a 2025+ `compatibility_date`. Boot smoke-asserts `ctx.storage.sql` exists.
- **Everything is behind a repository interface**; the move log is portable SQL (exit hatch to Postgres/Turso + the Neon fallback in spec §11).

## Amended Interfaces (pin these before phases compose)

- **GameState codec (Phase 1):** `serializeState(gs): string` / `deserializeState(s): GameState`, porting `server/gameState.ts` grid `[...entries()] ⇄ new Map`. **`grid` is a JS Map — `JSON.stringify` yields `{}` and silently loses the board.** Route EVERY GameState read/write (initial_state, snapshot) + `buildClientView` through it. Round-trip test with wilds asserts grid membership + byte-equal drawPile survive.
- **MovePayload discriminated union (Phase 2):** `play{placements}` | `pass{trades,tradeOrder}` | `wild_recycle{wildPosition,replacement}`. `moves.type CHECK IN('play','pass','wild_recycle')`. `replay()` dispatches all three. `applyWildRecycle` is a real committed action that does NOT advance turnIndex — model it everywhere or replay diverges and the heal detector false-positives.
- **`replay(initialState, moves): GameState`** — fold non-`reverted` rows through the pure engine; assert `reverted` rows form a contiguous suffix per affected seat (throw on violation); refuse/flag on `engine_version` mismatch (source `engine_version` from the engine package into `meta` at create).
- **DO-local `archive_outbox` table (replaces the Cloudflare Queue):** on commit, `ctx.waitUntil(env.DB.prepare(upsert).run())` write-through to D1, mark the outbox row flushed; the ~60s cron sweeps unflushed rows. On veto, re-flush reverted rows with `ON CONFLICT DO UPDATE SET reverted=excluded.reverted` (never DO NOTHING for that column, or D1 replay applies the reverted AI moves).
- **Idempotency:** `UNIQUE(client_move_id)` + in-txn `SELECT 1 exists` (SQLite allows multiple NULLs). AI/floor moves get a **server-minted deterministic id** (`ai:${seat}:${targetMoveIndex}`, `floor:${...}`) so an alarm re-fire produces the identical id → benign no-op. (Do NOT rely on a single last-clientMoveId — a turn is multiple rows.)

## The 13 must-fixes (each maps to a phase)

1. **P1** — `new_sqlite_classes` migration + bindings + cron + 2025 compat_date + boot `ctx.storage.sql` assert.
2. **P3** — CPU-kill floor via `async alarm(alarmInfo)`: on `alarmInfo.isRetry`/`retryCount>=1` take the O(1) `applyPass(state,seat,[],[])` floor instead of recomputing. Drop the heal-alarm + persisted attempt-counter (CF retries the SAME alarm; a rolled-back counter re-runs the killed path forever → permanent stall). Wrap `alarm()` in try/catch and re-arm the next alarm before returning.
3. **P2 + Global** — synchronous `transactionSync` commit span (see Amended Constraints); explicit UNIQUE(move_index)-violation handling.
4. **P3/P4** — inside the AI/floor write txn, re-read `turnIndex` AND `controlled_by_ai`; ABORT if changed (level-triggered reclaim-race guard). Test: fire ai_step, deliver reclaim before the txn, assert the AI move is NOT committed.
5. **P3/P4 + Global** — heartbeat as sole presence authority for drive+freeze (see Amended Constraints).
6. **P1** — GameState Map↔JSON codec (see Amended Interfaces); round-trip test first.
7. **P2 + P3** — model `wild_recycle` in MovePayload/CHECK/replay; heal detector distinguishes "no row since ai_step" (CPU-kill → floor) from "a wild_recycle committed, no play yet" (progress → re-arm, don't floor).
8. **P5 + P7** — DO-local `archive_outbox` + `ctx.waitUntil` write-through instead of the Queue (Queue is 10k ops/day + 24h retention); veto re-flush `reverted` to D1. Test: replay from D1 with a vetoed game asserts equality.
9. **P1/P2 (not P4)** — thread `accountId` through `applyAndPersist`; `owner_account_id` first-schema; in-txn seat-ownership authz.
10. **P6 + server** — authenticated `POST /claim {ghost_id}` verifies the device_credential (or a JWT minted from it) owns that ghost_id BEFORE reassigning rows; `ON CONFLICT DO NOTHING`. Test: account B cannot claim account A's ghost_id.
11. **P1** — redaction boundary: `buildClientView` = own hand full, others as counts, **drawPile as a COUNT only**; `initial_state` has no client-reachable getter. Test: no client payload (sync/echo/nudge/veto) ever contains `initial_state` or an ordered drawPile.
12. **P4** — device_credential: 32 bytes from `crypto.getRandomValues` (assert 256-bit, never Math.random); store only a SHA-256 hash; lookup/uniqueness key is the credential hash, NOT displayName; `/auth/quick` has mint-new vs authenticate-existing branches.
13. **P1** — secret-guard as a per-request 503 (see Amended Constraints); test asserts a per-request 503, not a module throw.

## Key should-changes (fold into the relevant phases)

- **P1 WebSocket Hibernation API (mandatory):** accept via `ctx.acceptWebSocket(server)`; implement `webSocketMessage/webSocketClose/webSocketError` as DO methods (never `addEventListener`/`server.accept` — they pin the DO in memory and defeat hibernation); stash `{seatIndex,accountId}` via `ws.serializeAttachment`, recover via `ws.deserializeAttachment`; fan-out via `ctx.getWebSockets()` (never an in-memory Map); `ctx.setWebSocketAutoResponse` for ping/pong. WS first-frame auth: accept, await an auth frame (verify JWT + seat ownership) within ~5s or `close(4001)`; nudges stay seat-agnostic ("news at index N", no hand data).
- **P1 schema init/rehydration in the DO constructor** via `ctx.blockConcurrencyWhile(async () => runMigrations(ctx.storage.sql))`: `CREATE TABLE IF NOT EXISTS`, a `schema_version` row, idempotent forward ALTERs each boot. Test: a 2nd-gen schema opens a 1st-gen DO cleanly.
- **Lobby registry:** a synchronously-written `code→gameId + last_activity` index (a small D1 table or index DO written at create and on each commit's activity-touch) — there is NO API to enumerate DOs and a room CODE ≠ gameId; `/join` resolves the DO through it and the cron queries it for stale active games.
- **`last_processed_at`** persisted on every handler entry; on wake compute `gap = now - last_processed_at`; if `gap > threshold` enter a one-presence-window quarantine and extend all deadline columns by `gap` before evaluating any cover (a DO isn't told how long it was evicted). Test: simulate a long eviction, assert a present-heartbeating seat is NOT covered on wake.
- **Veto in one `transactionSync`; owner-first authz** (`token.account_id === seats[targetSeat].owner_account_id` else 403) THEN state guards; reversible tail = maximal contiguous `by_ai` run on the reclaiming seat with nothing after, spanning WHOLE turns (include that turn's wild_recycle rows). Same owner-first check on `/reclaim`.
- **jose verify pinned:** `jwtVerify(token, key, { algorithms:['HS256'], issuer:'viota', audience:'viota-web' })`; token carries ONLY `account_id` (+iss/aud/exp); all seat/room ownership resolved live per request, never from token claims; refresh re-presents the device_credential. Test alg:none/swapped-alg rejected.
- **Rate-limit** `/auth/quick`, `/claim`, game-create (per-IP via `CF-Connecting-IP`, DO-backed counter or CF Rate Limiting binding); require a valid account token to create a game; cap games-in-flight per account.
- **`validate.ts` mandatory first step in EVERY handler** (disconnectTimeout ∈ {30,60,120,300}; clientMoveId uuid+cap; seatIndex ∈ [0,playerCount); placements ≤4 shape-capped; displayName sanitized ≤24, strip control/zero-width, unicode-normalize, at mint). Force `source` server-side (client can never set it); store `client_reported` rows separately (or `verified=false`) so cross-player queries physically exclude them.
- **CORS middleware on ALL routes** echoing Origin only if it exactly equals the env Pages origin, `Vary: Origin`, preflight for the Authorization header. **Origin story:** on pure free tier `workers.dev` and `pages.dev` are DIFFERENT origins → either accept cross-origin (delete the spec's "same origin" language) or use one custom domain (~$10/yr). (Fixes today's `Access-Control-Allow-Origin: *` on auth'd responses.)

## Plan gaps to add

- **Eviction tests can't force-evict a live DO in Miniflare.** Prove liveness rehydration by: (a) drive state+timers to storage, get a fresh stub, assert liveness rehydrates from storage alone; (b) invoke `alarm()` via `runDurableObjectAlarm()`/`runInDurableObject()` + advance time to prove the timer-wheel refires from the `timers` table; (c) simulate redeploy by discarding + re-fetching.
- Add the **soft per-turn deadline** as a first-schema column + a distinct timer kind + the client "AI this turn" button.
- Add a P6 task for the **WS-blocked → 5s `/sync` polling** fallback.
- Add a P6 task to **DELETE the existing vote system** (client `VoteBanner.tsx` + server vote maps/handlers) that auto-cover replaces; enumerate reused-as-is (Board/Hand/Card/Cell/TopBar) vs rewritten (`net/connection.ts`, `gameStore`→online store) vs deleted.
- **P1 engine-bundling checkpoint (first green gate):** import a real `@viota/engine` call inside the DO and confirm it bundles+runs under `wrangler build` AND `vitest-pool-workers` (engine ships raw `src/*.ts` with `moduleResolution:bundler`, no dist step).
- Name the **background integrity check** (replay+rebuild on mismatch) and **server-side replay-verification of client_reported logs** as DEFERRED fast-follows (not silently dropped).
- **Request-budget sizing** paragraph: heartbeat 20s (~180 req/hr/player) × concurrent players + /sync + reconnects + 60s cron vs ~100k/day; consider adaptive heartbeat cadence.
- **Concurrency tests:** two devices same seat (exactly one move/turn; other benign no-op); concurrent reclaims idempotent; veto single-use; AI exactly-once-under-alarm-retry (throw AFTER a successful commit, assert no dup move_index).
- **P1 CPU micro-benchmark:** worst-case medium move (full board, 2 connected wilds) within the 30s CPU budget; reframe the floor rationale — the O(1) pass floor survives ANY alarm-invocation failure (throw/memory/transient), not a medium-AI overrun (medium is sub-ms).
