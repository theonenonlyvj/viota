# viota Online — The Most-Robust-Free Architecture (authoritative)

**Date:** 2026-07-06
**Supersedes:** v1 and v2 for transport/hosting/consistency. The v2 correctness must-fixes are all incorporated here.
**Produced by:** a design council of 4 independent architects + per-design red-team evaluators + 2 cross-cutting specialists (mobile-reliability, consistency/free-infra) + a chief architect synthesis. Mandate: *the single most robust architecture that runs on free infrastructure — ignore this-week timeline, build the best.*
**Status:** Design complete. **One platform decision flagged for Vijay (§0).**

## 0. The decision, up front

**Recommendation: make each viota game a single Cloudflare Durable Object.** The whole realtime + timers + authoritative-state stack moves to Cloudflare's free tier; the pure `@viota/engine` (already bulletproof) is carried over untouched. **This is a deliberate rewrite off the current Render + Express + `ws` + better-sqlite3 stack** — justified by the "best design, ignore timeline" mandate.

Why it wins: the project's #1 goal (never stall/forfeit under real mobile + restarts) is a **liveness problem**, and a Durable Object (DO) solves it *structurally* where a free Node dyno can only paper over it:
- **No spin-down.** A DO hibernates but wakes in ~milliseconds, so the reconnect target is *always warm* — the 30–60s cold-start-on-reconnect that plagues a Render free dyno (and caused the prior game's freezes) is gone.
- **Durable Alarms re-fire across eviction AND redeploy** — so grace/turn/AI-drive timers can never be silently lost. "Boot rehydration of liveness" becomes the default, not a routine you must remember to run.
- **Exactly one live DO per game id** — single-writer ordering, "who drives after restart," and split-brain stop being problems to defend against and become *impossible by construction*. No locks, no CRDTs.

**Verified free (2026-07-06):** SQLite-backed DOs are on the Workers Free plan (per [Cloudflare's 2025-04-07 changelog](https://developers.cloudflare.com/changelog/post/2025-04-07-durable-objects-free-tier/) and [DO pricing docs](https://developers.cloudflare.com/durable-objects/platform/pricing/)): 5 GB total / 1 GB per object, no storage charge for free-plan users, ~100k requests/day. Design strictly on the **SQLite-backed** class (the legacy KV-backed class is paid-only).

**If you'd rather not adopt Cloudflare**, the documented fallback is Render + `ws` + **Neon** Postgres (§11) — it works but is strictly weaker (irreducible cold-reconnect residual; liveness bolted on via boot-scan + watchdog + external pinger). Neon over Supabase is non-negotiable there (Supabase free hard-pauses after ~7 days idle).

## 1. Stack

- **Compute + realtime + timers:** Cloudflare **Workers** + **SQLite-backed Durable Objects** (one DO per game) + **WebSocket Hibernation** + **Alarms**.
- **Durable analytics archive:** **D1** (managed SQLite), written through a **Cloudflare Queue** + end-of-game force-flush.
- **Static client:** **Cloudflare Pages** (same origin as the Worker) — React + Vite + zustand, reusing the existing UI where possible.
- **Backstop:** a **Cron Trigger** (~60s) sweeps stale active games (catches a rare lost alarm). No external uptime pinger needed for correctness.
- **Libraries:** `jose` for JWT (replaces `jsonwebtoken`); `bcryptjs` stays for the eventual password path. `@viota/engine` unchanged.

## 2. Correctness never rides the WebSocket (transport inversion)

The socket is **demoted to a one-way "there's news at index N" nudge**. Every mutation and every recovery is **idempotent HTTP**:
- `POST /games/:id/move` — body carries a **client-minted `clientMoveId` (uuid)**. The DO checks it against the seat's `lastClientMoveId` *inside the write transaction*; a duplicate does **not** re-apply and re-sends the current snapshot as a benign ack (kills double-submits and the false "not your turn" toast after a reconnect race).
- `GET /games/:id/sync?since=k` — returns `{ moveIndex, snapshot (per-seat redacted), moves:[k+1..] }`. This is the **recovery primitive** — a stateless HTTP GET that needs no live socket, no Socket.IO `connectionStateRecovery` (void after any restart anyway), no server-side per-connection buffer.
- A phone whose iOS socket is suspended can still **take its turn** (POST) and **recover** (GET) over plain HTTP. WS blocked entirely → degrade to 5s `/sync` polling while foregrounded — higher latency, never frozen.

Token rides in the WS first-message auth frame + HTTP `Authorization` header — **never the URL** (fixes the live `connection.ts:12 ?token=` leak into CDN/proxy logs).

## 3. Never-stall protocol (the heart)

An active game can **freeze deliberately** (when zero humans are watching, to save compute) but can **provably never** sit with a live human waiting on a seat nobody drives — and never flip-flops or forfeits.

1. **One drive loop (`driveIfAI`) is the only AI path.** Runs on the DO after every applied move, on game start, on resume/reclaim, on every alarm fire, and on DO wake. While `status=='active'` and the current seat is `controlled_by_ai` and ≥1 human socket is attached: compute a **medium** AI move, `applyAndPersist` (atomic, `by_ai=true`, `controlling_account_id` = seat owner), broadcast, then **re-read** the current seat + `controlled_by_ai`. Pacing is by **chained durable alarms** (~700–900ms apart), not a tight loop — so humans see each play land, and a reclaim mid-chain makes the next iteration a no-op and hands control straight back. Chains consecutive AI seats automatically. **This kills the current `triggerAiFillIn` one-move-then-stall bug.**
2. **Liveness = durable alarms, not memory.** A `timers(kind, seat, fire_at)` table in DO storage is a durable timer-wheel; the single platform alarm is always set to `min(fire_at)`. Kinds: `grace`, `turn`, `ai_step`, `heal`. Alarms persist and re-fire across eviction and redeploy — so rehydration is structural (the alarm *is* the rehydration trigger).
3. **Two clocks + a soft one.** (a) **grace** 120s from disconnect (host-config {30,60,120,300}) before an absent *off-turn* seat is AI-covered; (b) **away-turn fast-track** ~25–30s if the disconnected seat is *on* turn, so present players are never held hostage by one locked phone; (c) a **soft visible per-turn countdown** (~60–90s) even for a *connected-but-AFK* seat, with a table "AI this turn" button, so a present idler can't freeze the table. All deadlines are server-side columns; no liveness decision ever trusts a client timer.
4. **Auto-cover, not a blocking vote.** On expiry, auto-cover with a fixed **medium** AI via a **dismissible toast** ("AI is holding Alice's seat — she can rejoin anytime"). Deletes the entire current vote-tally-against-live-socket-count failure class (which races and can never complete).
5. **The never-stall floor (CPU-kill proof).** Cover uses **medium** (verified cheap — single-card enumeration, sub-ms to low-ms; won't blow the Workers per-invocation CPU cap). **Expert is never used for cover** (it's the only unbounded agent). Guaranteed floor: `applyPass(state, seat, [], [])` is an O(1) always-legal move. It's invoked via an **attempt counter** (a `heal` alarm shortly after `ai_step`: if the turn hasn't advanced — evidence the smart computation was CPU-killed mid-invocation — the second attempt plays the O(1) pass floor). So a CPU limit can only degrade AI **quality**, never liveness, with no per-turn flip-flop.
6. **Freeze + abandon.** Zero humans attached → don't drive (save compute), cancel `ai_step`. First reconnect re-arms + re-drives. Zero humans for N minutes → `status='abandoned'` in D1 (recoverable by replay if reopened).
7. **Boot grace-quarantine.** On any DO wake, don't AI-cover a present-looking seat for one presence window (~45s), and credit each grace deadline by `(now - wake_time)` so a compute gap is never miscounted as absence. A seat with a queued/in-flight human move always beats a watchdog AI-cover.

## 4. Reconnect protocol (mobile physics, honestly)

**Core admission:** no transport keeps a backgrounded iOS page alive — not WebSocket, SSE, long-poll, or a service worker (only installed-PWA Web Push, out of scope). So we **don't try to keep the phone live** — we assume the backgrounded phone is dead, cover its seat with AI, and make the **foreground reconcile instant and correct**.

- **Reconcile fires on all four of:** `visibilitychange→visible`, **`pageshow`** (catches iOS Safari bfcache restore that focus/visibility handlers miss — the most commonly dropped mobile detail), `online` (wifi↔cellular handoff), and WS `onopen`. On each: (1) `GET /sync?since=localIndex` → if server `moveIndex ≥ local`, **replace state wholesale** (never merge a delta); (2) drain the **IndexedDB move outbox** via idempotent `POST /move` (deduped by `clientMoveId`); (3) then lazily reopen WS. Because the reconnect target is a **warm DO**, this is sub-second.
- **Presence decoupled from the socket.** App-level heartbeat `POST /heartbeat` every 20s while foregrounded — **authoritative over ws ping/pong** (Safari leaves zombie half-open sockets that pong at TCP while JS is frozen). Present if `last_seen_at` within 45s. Detection latency (~45s) is cosmetic because correctness rides HTTP.
- **Silent reclaim (never a mid-game login prompt).** A 256-bit `device_credential` minted at first open, stored in **localStorage** (survives tab death, lock, reboot, bfcache — not sessionStorage), maps to a durable account and mints a 24h JWT, silently refreshed at ~50% life. On any 401 during reconnect, silently re-auth from the credential and re-join the seat. **The seat is bound to `account_id`/`ghost_id`, never to display name/IP/socket** — so a handoff loses nothing and reclaim can't be spoofed. Fix `connection.ts`: remove the `MAX_RETRIES=5` give-up → infinite backoff capped at 10s while visible, immediate reconnect on every foreground/online event.
- **Turn-theft cure — bounded reversible veto.** Default: resume from the current board, never touching committed history. **But** on reclaim, if the tail of the log is a contiguous run of `by_ai` moves *all on the reclaiming seat* and nothing else was committed on top, the player is offered a one-tap **"undo the AI's turn and play."** Accepting marks those moves `reverted=true` (never deletes — audit + data fidelity), rebuilds the snapshot by replaying non-reverted moves through the pure engine; the human's real move gets the next `move_index` (indices stay strictly increasing; UNIQUE holds; draws re-derive correctly). Strictly tail-only, own-seat-only, deterministic. Cures the dominant regret ("I glanced away 30s and the computer played my hand") without any speculative mid-history rollback.

## 5. Consistency & persistence

- **Single authoritative writer per game, enforced structurally** (one DO per gameId, single-threaded). No in-process mutex (evaporates at 2 instances), no CRDT (solves a multi-writer conflict this single-legal-writer-per-turn game doesn't have). Online clients **never mutate optimistically** — render a "pending" affordance, commit only on the authoritative echo → nothing to diverge, nothing to reconcile.
- `move_index = meta.moveIndex + 1` assigned by the one writer; `UNIQUE(game_id, move_index)` and exactly-once hold by construction. Divergence is **detected** (every nudge/snapshot carries the monotonic `moveIndex`; any gap → `GET /sync`; a background integrity check can replay + rebuild on hash/score mismatch).
- **Two tiers:** Tier-1 = **DO SQLite** (live truth, colocated, survives hibernation): `initial_state` (immutable), `snapshot` (rebuildable cache), `moves` (append-only, PK `move_index`, incl `reverted`), `seats`, `timers`, `meta`. `applyAndPersist` runs in `state.storage.transaction()`: read moveIndex → idempotency check → validate via pure engine → write {move, snapshot, meta} atomically → **commit, THEN broadcast** (never before) → enqueue D1 write. Tier-2 = **D1** archive via Queue (write-through + retries) + end-of-game force-flush, `ON CONFLICT DO NOTHING` (idempotent re-flush). A D1 hiccup can never stall a live game (DO copy is authoritative).
- **Replay determinism (cannot be backfilled — lands in the first schema):** `initial_state` captures the **post-deal** GameState (starter cell, every seat's hand, the **exact drawPile order**, seat→owner) — mandatory because `initGame` uses `Math.random` (shuffle + wild-starter reinsert), so the deal is *not* seed-reproducible. Replay applies recorded move payloads in `move_index` order through the pure engine, recomputing nothing nondeterministic (draws come off the persisted pile; `by_ai` moves replayed as data). Reconstructs every hidden hand + the pile byte-exactly.
- **Columns use TEXT + CHECK, not native ENUM** (adding `abandoned`/`stalemate` later is an insert, not a painful `ALTER TYPE`).

## 6. Identity, auth, security

- **Quick-account by default:** typing a display name mints a real `accounts` row keyed to the 256-bit localStorage `device_credential` (durable identity for reclaim + analytics, zero keyboard wall). Optional game-over upgrade (claim username + password) for cross-device login; real passwords + email recovery are a fast-follow (no free email on-stack → recovery leans on the credential). Solo-vs-AI free under a device `ghost_id`; logged-out solo games claim into the account on first login (idempotent `ON CONFLICT DO NOTHING`; clear IndexedDB only after 2xx).
- **JWT via `jose`** signed by a Wrangler SECRET. **The Worker refuses to boot** if the secret is unset, a known dev default, or <32 bytes — closes today's highest-severity live bug (`index.ts` falls back to a source-committed `'dev-secret-change-in-production'` → anyone can forge any token). 24h TTL + silent refresh.
- **Read-authz as a first-class rule** on every `state`/`sync`/`move`/`heartbeat` read: the DO confirms the account owns a seat in *that* game and returns only the per-seat **redacted** `buildClientView` (your hand; others as counts) — never the raw snapshot. Fixes the flagged `GET /rooms/:code/state` that returns every seat's hand to any valid token.
- **Bounds-validate every inbound message** (not just moves): `disconnectTimeout` from the allowlist {30,60,120,300}; reclaim/veto subject must be a real seat; placements shape/size-capped before the engine sees them. The pure fuzz-clean engine is the final legality gate.
- **Anti-cheat:** online moves are server-authoritative (engine re-validates every move) → a hacked client can't cheat online. `source='client_reported'` solo/ghost logs are hard-excluded from any cross-player/leaderboard metric; server-side replay-verification is a fast-follow. Light `/auth` rate-limit; CORS pinned to the Pages origin (fixes today's `*`).

## 7. Analytics (capture now, dashboards later)

The append-only move log **is** the warehouse — capture is automatic, complete, replayable, and human-vs-AI-separable by construction, so metrics nobody has designed yet are computable retroactively.
- **Per move (all land in the first schema — uninferable later):** `move_index`, `turn_number`, `seat_index`, `type`, full `payload`, `score_delta`, `score_after`, `by_ai` (move-granular — a seat can be human→AI→reclaimed→human within one game), `ai_difficulty`, **`controlling_account_id`** (who owned the seat when the move was made — attributes AI-covered turns to the owner and reconstructs human↔AI spans per account), `think_ms`, `client_move_id`, `reverted`, `created_at`.
- **Per game:** `initial_state`, `outcome` (completed|stalemate|abandoned), `winner_seat`, `engine_version`, `source`, `game_uuid`.
- **Replayability:** `initial_state` + ordered non-reverted move payloads → deterministic reconstruction of every board incl. hidden hands + pile → post-hoc metrics (wild hoarding, EV-left-on-the-table, think-time under pressure, lot-completion rate, human-vs-AI decision divergence) with zero pre-instrumentation. D1 keyed by `account_id`/`ghost_id` so history spans games/sessions/devices once ghost games are claimed.

## 8. Lifecycle & UX

- **Rematch** on game-over resets the same room to a fresh game with the same seats (new game row, same seats); deals in a friend already sitting in the room.
- **Explicit "Leave game"** (distinct from a drop, via WS close 1000): immediately AI-covers the seat (skip grace/vote) with "you can rejoin anytime."
- **Freeze/resume invariant:** AI progresses only while ≥1 human is attached; zero humans → freeze; resume + re-drive on first reconnect; zero humans N min → `abandoned`.
- Drop the host-only-can-start gate (anyone with ≥2 present can start / promote the next connected player).

## 9. Testing

- Integration tests with the **workers/DO test harness** (`@cloudflare/vitest-pool-workers` / Miniflare) against real DO storage + D1 — not a Postgres stand-in. Keep the engine suite green (carried over untouched).
- **Integration-test the never-stall guarantee:** a full 4-player game with one AI-driven seat through multiple turn wrap-arounds to completion; drop→cover→reclaim; DO eviction/redeploy mid-game (alarm re-fire); the CPU-kill floor (attempt-counter → pass); the bounded veto (tail-only, own-seat-only, mark-reverted, rebuild-by-replay).
- Concrete values: heartbeat 20s, presence window 45s, grace 120s (configurable), away-turn 25–30s, soft per-turn 60–90s, AI pacing 700–900ms.

## 10. Residual risks (every one degrades to freeze/pause/one-reversible-AI-move — never drop/stall/forfeit)

1. iOS socket suspension is unfixable at the transport layer — AI covers after ~25–30s, instant warm reconnect on `pageshow`, bounded veto cures the regret. A player who never reopens stays AI-covered (the intended outcome).
2. Cloudflare outage / 100k-req/day exhaustion → moves 429/503; the IndexedDB outbox holds + retries → game **pauses**, never forfeits; also degrades to offline solo. No free multi-cloud failover.
3. CPU cap only lowers AI **quality** (medium cover verified cheap; O(1) pass floor); $5/mo Workers Paid is the named opt-in if AI strength ever matters more than $0.
4. D1 is eventually-flushed → the **archive** can briefly trail; **live** truth (DO storage) cannot. Mitigated by force-flush + queue retries + 60s cron.
5. Device-credential loss (clearing storage / switching browsers before upgrading to a password) orphans that account's history — nudge the password upgrade at game-over.
6. Rare lost DO alarm → caught within ~60s by the cron sweeper.
7. A present-but-partitioned-on-turn player can be AI-covered if the partition outlasts ~25–30s; the veto cures the common case; a longer partition with another seat building on top is a rare genuine loss.
8. `client_reported` logs unverified until replay-verification ships — quarantined, so worst case is a padded personal stat, never a corrupted leaderboard.
9. **Vendor lock-in** accepted for the structural robustness; exit hatch is real (pure engine + repository interface + portable SQL move log re-homes on Postgres/Turso; the fully-specified Render+Neon fallback in §11).
10. The bounded-veto tail-truncation is the one place touching history — strictly guarded (contiguous trailing `by_ai` on the reclaiming seat only, nothing on top, mark-reverted-never-delete, rebuild-by-replay) and integration-tested.

## 11. Documented fallback (portability hedge, strictly weaker)

Render free web service + `ws` + **Neon** Postgres. If ever used it MUST: derive `move_index` inside a txn holding `SELECT ... FOR UPDATE` on the games row (a real cross-connection lock — the primary ordering guarantee, not an in-process mutex); broadcast **only if the INSERT affected a row** (never after `ON CONFLICT DO NOTHING` — the phantom-broadcast hole); take a `pg_advisory_lock` per game so exactly one instance drives during a deploy overlap; Neon pooled string (max ~5) + first-query-after-idle retry; plus boot-rehydration + a ~15s watchdog + an external uptime pinger. It carries an irreducible 30–60s cold-reconnect residual and three fragile props doing what DO Alarms do structurally — which is exactly why it's the fallback, not the pick.

---

**Bottom line:** each game is a warm, single-writer, self-healing actor with durable timers; the socket is a hint, HTTP + the move-log is the truth, and every failure degrades gracefully. It honors every ruling, captures complete replayable analytics for free, and is genuinely $0 at friends-game scale. The cost is a deliberate rewrite onto Cloudflare and accepted vendor lock-in with a real exit hatch.
