# viota Online Multiplayer — Design Spec v2 (post-council)

**Date:** 2026-07-05
**Supersedes:** `2026-07-05-viota-online-design.md` (v1). Read v1 for the goal/identity narrative; this v2 is the authoritative design after the expert council review.
**Status:** Approved architecture + council must-fixes folded in. One open decision flagged for Vijay (§2).

## 1. What the council changed (why v2 exists)

The council confirmed the architecture is **sound and correctly aimed at the #1 goal** (server-authoritative engine, account/seat-bound identity, append-only move log, durable Postgres), but found v1 **asserted anti-frustration outcomes without specifying the protocols that produce them**, and that two headline mechanisms were false:
- **Socket.IO "message buffering" does not recover missed server→client broadcasts** and its one recovery feature (`connectionStateRecovery`) is disabled after any restart. The real recovery primitive is the **authoritative snapshot the server already sends on (re)connect**. → **Keep `ws` for now**; add an explicit resume protocol. Socket.IO becomes a defensible later refactor, not a requirement.
- **"Postgres backstop makes restarts safe" saves state but NOT the in-memory liveness** (grace timers, votes, AI-drive loops). → add **boot rehydration + a watchdog**.

## 2. OPEN DECISION FOR VIJAY — scope

The council's unanimous verdict: **"full feature this week" is not realistic**, and any half-finished piece on game night is worse than the current code. Recommended: **ship the minimum robust subset on the existing `ws` + Neon stack**, defer Socket.IO / real passwords / analytics dashboards / full vote UI to a fast-follow.

**Default taken (pending your override):** build the robust subset. It is the lowest-regret path — ~90% of the work (schema, accounts, AI-drive-loop, rehydration, resume protocol, security hardening, persistence) is common to both paths, and the deferred items (Socket.IO, passwords) are additive later, not rewrites. If you want the full push instead, say so and we layer the two deferred pieces on top.

## 3. Identity (revised): quick-account by default

- **"Online requires an account"** is honored, but implemented as a **no-password quick account**: entering a display name mints a real `accounts` row keyed to a long-lived **localStorage device credential** (the durable identity analytics needs, with zero keyboard wall at the table).
- **Optional upgrade** on the game-over screen: "claim a username / set a password" for cross-device login. Real passwords + email recovery are a **fast-follow**, not game-night-critical.
- **Solo-vs-AI** stays free/no-wall. Ghost solo games claim into the account on login (§7).

## 4. Transport & resume protocol (revised): keep `ws`, make resume explicit

- Keep the existing `ws` stack (already has auto-reconnect + backoff in `connection.ts` and snapshot-on-connect in the `welcome` message).
- **Resume protocol (must specify):** every `state` event carries a **monotonic per-game `moveIndex`**. On connect or any gap, the client **trusts the full authoritative snapshot** and ignores any event with `index ≤ its current index`. The snapshot — not transport buffering — is the recovery primitive.
- **Idempotent moves:** every move message carries a client-minted **`clientMoveId` (uuid)**. The server records the last-applied `clientMoveId` per `(game_id, seat_index)` inside the move transaction; a duplicate does **not** re-apply — it re-sends the current snapshot as a benign ack. Kills double-submits and false "not your turn" toasts after reconnect.
- **No optimistic board mutation online for v1.** Show a "pending" affordance (dim played cards / disable input); commit only on the authoritative echo. Turn-based low-frequency game → no rollback complexity for negligible latency.
- Token sent in the **handshake auth payload, not the URL** (URL tokens leak into proxy/Render logs).

## 5. Never-stall engine (the heart — must-fixes 1–4)

1. **`advanceIfAI(gameId)` drive loop (must-fix #1).** A central routine called after **every** applied move (human or AI), on game start, and on resume/reclaim. Loads the snapshot; while the current seat is `controlled_by_ai` and the game isn't over: apply an AI move (behind a re-entrancy guard, ~500–1000ms delay for watchability), persist, broadcast, re-check. Chains through consecutive AI seats; re-reads `controlled_by_ai` each iteration so a mid-loop reclaim makes the next iteration a no-op. **This fixes the current one-move-then-stall bug — the exact failure that killed the prior game.**
2. **Boot rehydration + watchdog (must-fix #2).** Persist `disconnected_at` per seat and `controlled_by_ai`. On startup, scan `games WHERE status='active'`: re-arm a grace timer for every seatless human seat; if the current seat is dropped-past-grace or AI-controlled, drive the flow immediately. A ~15s sweep kicks any "current seat is a dropped human past grace with no AI and no vote" condition. Liveness lives behind a small **gameId-addressed SessionManager** reconstructable from Postgres alone (also makes a future multi-instance path a slot-in).
3. **Two clocks + turn timeout (must-fix #3).** (a) a long "seat is gone" grace from disconnect (default 120s, host-configurable {30,60,120,300}); (b) a **short 20–40s "current turn is an away seat" timer** that fast-tracks straight to AI-cover so present players aren't held hostage; plus a soft per-turn timer even when the seat is connected (visible countdown + a table "AI this turn" control) reusing the single-AI-move primitive. Backgrounded/locked phones make "disconnected on your turn" the *normal* per-turn state (iOS Safari suspends sockets ~30s after lock) — this is the make-or-break.
4. **Auto-AI-cover replaces the blocking vote (must-fix #4).** After grace/blocked-turn expires, auto-cover the seat with a fixed **medium** AI via a **dismissible toast** ("AI is holding Alice's seat — she can rejoin anytime") + an optional "keep waiting" button. The dropped player's own reconnect silently cancels grace/cover. (If a vote is ever kept: snapshot the eligible-voter set at vote *start* for a fixed denominator, give it an auto-resolve timer, make it dismissible — the current live-socket denominator races and can itself stall.)
5. **Atomic reclaim (should-change #7).** On reconnect, in one critical section at a turn boundary: cancel grace timer, cancel + broadcast-cancel any vote, set `controlled_by_ai=false`, cancel any not-yet-executed AI timer; **never roll back a committed AI move** (resume the human from that snapshot); send the authoritative snapshot last.

## 6. Persistence & data model (must-fixes 5–9, 12 + should-changes 5,6)

**Transactional write (must-fix #7):** wrap snapshot-upsert + move-insert + score/turn update in **one Postgres transaction** (`applyAndPersist`); commit, **then** broadcast (never before). `UNIQUE(game_id, move_index)` with `move_index` derived server-side (`max+1` in the txn), `ON CONFLICT DO NOTHING`. Invariant: **`moves` (+ `initial_state`) is the source of truth; `state_snapshot` is a rebuildable cache** — rebuild-by-replay on any suspected desync.

**Replay determinism (must-fix #8) — cannot be backfilled:** add `games.initial_state jsonb NOT NULL`, written once at creation, never updated. `initial_state` + ordered `moves` replays deterministically (engine is pure; draws come off the known pile). Without it, hands/pile are unrecoverable — exactly the hidden-information dimension strategy analysis needs.

**Schema (Postgres, Neon):**
- **accounts**: `id uuid pk`, `username text unique`, `password_hash text null` (null for quick-accounts), `email text null`, `device_credential text` (for silent reclaim), `created_at timestamptz`.
- **games**: `id uuid pk`, `mode enum('online','local')`, `status text check in ('waiting','active','finished','abandoned')`, `player_count int`, `initial_state jsonb NOT NULL`, `state_snapshot jsonb`, `winner_seat int null` (null = tie/none), `outcome text check in ('completed','stalemate','abandoned') null`, `engine_version text`, `room_id uuid null`, `last_activity_at timestamptz`, `created_at`, `ended_at null`.
- **game_players**: `game_id fk`, `seat_index int`, `account_id uuid null REFERENCES accounts(id)`, `ghost_id text null`, `owner_type text check in ('account','ghost','ai')`, `display_name text`, `ai_difficulty text null`, `controlled_by_ai bool default false`, `disconnected_at timestamptz null`, `final_score int null`, PK `(game_id, seat_index)`, CHECK enforcing valid owner combos, INDEX on `account_id`.
- **moves** (append-only): `id bigserial pk`, `game_id fk`, `move_index int`, `turn_number int`, `seat_index int`, `type text check in ('play','pass','recycle')`, `payload jsonb`, `score_delta int`, `score_after int`, `by_ai bool NOT NULL DEFAULT false`, `ai_difficulty text null`, `client_move_id text null`, `created_at`, `UNIQUE(game_id, move_index)`.
- **rooms**: `id uuid pk`, `code text`, `host_account_id uuid`, `status text`, `config jsonb`, `created_at`; partial `UNIQUE(code) WHERE status <> 'finished'`; games reference `room_id` (so a room hosts sequential rematches).

**Can't-backfill columns that MUST land now** (must-fixes 8,9 + should-change 6 + 12): `initial_state`, `moves.by_ai` (+ `ai_difficulty`), `moves.turn_number`, `moves.score_after`, `games.outcome`, `games.source` (below), and a client-minted `game_uuid`. `moves.think_ms` only if trivially free.

## 7. Local/ghost sync (must-fix #12)

Mint the game UUID client-side when a ghost game **starts**. On game **end**, single idempotent upsert (`ON CONFLICT DO NOTHING` for game + moves); clear IndexedDB only after a confirmed 2xx. Add **`games.source ('online_authoritative' | 'client_reported')`** and hard-exclude `client_reported` from any future cross-player/leaderboard metric (client-authored local logs are unverified). Server-side replay-verification (replay `initial_state`+moves through the engine, reject on illegal move / score mismatch) is a fast-follow. Soften v1's "no game is lost" to **"no *completed* game is lost"** (or checkpoint solo to IndexedDB periodically).

## 8. Security must-dos (must-fixes 10,11 + should-change 8)

- **Refuse to boot if `JWT_SECRET` is unset or the dev default** (throw on startup); require ≥32 bytes. (Today `index.ts` falls back to a source-controlled secret → anyone can forge any token.)
- **Read authorization as a first-class rule:** every state/snapshot/move read confirms the caller owns a seat in *that* game and returns the per-seat **redacted** `buildClientView`, never the raw snapshot. Fix the existing `GET /rooms/:code/state` (today it returns every seat's hand to any valid token).
- **Bounds-validate every inbound message** (vote/join/config too, not just moves): `disconnectTimeout` from an allowlist `{30,60,120,300}`; `disconnectedPlayer` must be a real disconnected seat; voter must be a connected non-subject.
- **Silent reclaim (must-fix #13):** token in **localStorage** (survives tab death/reboot; not sessionStorage), online token TTL ≥ 12–24h (or refresh token), and on any auth failure the client **silently re-auths + re-joins the seat** — never a mid-game login prompt. Guest fallback (if used) reclaims via `guest_secret`, not display name.
- Light `/auth/*` rate-limit + `>=8` password floor + CORS pinned to the client origin **if time allows**; full JWT-per-move / enumeration hardening is a public-launch fast-follow.

## 9. Lifecycle & UX (should-changes 1,3,4)

- **Rematch button** on game-over: resets the same room to a fresh game with the same seated players (new `games` row, same seats); deals in a friend already sitting in the room. (Today `finished` has no route back to `waiting`; without this, every game all evening needs a new room + re-shared code.)
- **Freeze/resume invariant:** AI turns progress only while ≥1 human is connected to that game; zero humans → freeze (no timers/pings); resume + re-drive AI on first reconnect via rehydrate; no humans for N minutes → `status='abandoned'` + `ended_at`. Drop the host-only-can-start gate (anyone with ≥2 present can start / promote next connected player).
- **Explicit "Leave game"** (distinct from a drop, using `ws` close code 1000): immediately offer the seat to AI (skip grace/vote) with "you can rejoin anytime."

## 10. Hosting (should-change 2)

- **Neon** over Supabase (Neon auto-resumes sub-second; Supabase free *pauses* after ~7 days idle → landmine for a bursty game-night app). Connect via Neon's **pooled** string, small long-lived pool (max ~5–10), first-query-after-idle wrapped in reconnect-retry.
- **External uptime pinger** (UptimeRobot/cron-job.org) hitting `/health` every 5–10 min during the event window (a self-ping does not defeat Render idle detection; phone timers are throttled when backgrounded). Warm `/health` when the Home screen opens; make room-create idempotent with a ~70s "Waking the table…" state.

## 11. Testing & concrete values (should-change 10)

- Integration tests against a **real Neon test branch or Docker Postgres** (pglite is not wire-compatible with `pg` and lags real Postgres — don't let it be the only gate). Use a `pg` driver behind an injected query fn.
- Text + CHECK columns (not native Postgres ENUM — `ALTER TYPE ADD VALUE` is painful mid-week and we *will* add `abandoned`/`stalemate`); value lists in one shared TS const.
- Ping ~20s / timeout ~20s (~40s detection); grace default 120s; blocked-turn 20–30s.
- **Integration test the never-stall guarantee:** a full 4-player game with one AI-driven seat through multiple turn wrap-arounds to completion; a drop→cover→reclaim happy path; a server-restart-mid-game resume.

## 12. Phasing (robust subset; front-loaded by risk)

- **P0 — DONE:** engine bulletproof (242 tests, fuzz-clean, independent re-verification in progress).
- **P1 — Data + identity:** Neon schema (all can't-backfill columns) + repository layer + quick-account identity + JWT-secret boot guard + read-authz. Tests on Neon branch / Docker PG.
- **P2 — Persistence + resume:** `applyAndPersist` transaction (commit-then-broadcast), `moveIndex` + `clientMoveId` idempotency, snapshot-on-reconnect resume protocol, `initial_state`.
- **P3 — Never-stall:** `advanceIfAI` drive loop, boot rehydration + watchdog, two-clock timers, auto-AI-cover, atomic reclaim, freeze/resume + abandoned lifecycle.
- **P4 — Client:** quick-account UI, account-aware lobby, fully wired OnlineGame (state/gameOver/error/reconnect banners, real draw-pile count, pending affordance), Rematch, Leave, local end-of-game push + ghost claim.
- **P5 — Capture verify:** confirm the move log + `initial_state` replays deterministically and analytics dims are complete (dashboards deferred).
- **Fast-follow (not game-night):** Socket.IO, real passwords + email recovery, JWT-per-move + rate-limit hardening, analytics dashboards, server-side replay-verification of client-reported games.

Each phase is independently shippable and testable; if time runs short, P1–P4 are the game-night-critical set.
