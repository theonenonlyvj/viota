# viota Online Multiplayer — Design Spec

**Date:** 2026-07-05
**Status:** Approved design, pre-implementation
**Author:** Vijay + Claude

## 1. Goal & Non-Goals

**Goal.** A lasting, polished online multiplayer mode for viota (the digital Iota game). Its #1 job is to **never frustrate players with dropped or forfeited games** — the failure mode that killed engagement in the prior Jaipur online feature. Secondary goal: durable, append-only game history that powers **strategy analytics over time**.

**Ambition (confirmed):** build the full feature — accounts, durable persistence, robust reconnect, AI-takeover-with-reclaim, and the analytics data pipeline. Target the full slice for game night this week, phased to front-load risk.

**Non-goals (deferred, do not build now):**
- Local pass-and-play (multiple humans on one device). Hidden until later.
- Analytics *views/dashboards*. We capture the data now; visualizations come later.
- Matchmaking, ranked ladders, chat, spectators, mobile-native apps.
- Multi-server horizontal scaling. Single instance is fine at this scale.

## 2. Ground Truth

The rules engine (`@viota/engine`) is bulletproof as of 2026-07-05 (chained-wild fixed, pass/stalemate/starter/game-over correct, 242 tests, 320-game fuzz clean: 0 invalid boards, 0 conservation violations, 0 non-terminating games). The engine is the **single source of truth** and the server is **authoritative** — clients never mutate state, they request moves the server validates through the engine. `ref/iota_rules.txt` remains the rules ground truth.

## 3. Identity & Accounts

- **Auth = username + password.** Email is **optional** (recovery only), never required. ~15-second signup. Passwords hashed with bcrypt (already a dependency).
- **Online multiplayer requires an account.** Stable identity is what makes reconnect bulletproof (your seat is tied to your account, not a fragile guest token) and is the only basis for cross-session analytics.
- **Solo-vs-AI is always free** — no login wall, instant play. It is the front door.
- **A logged-in player's solo games are saved too** (solo-vs-AI is still strategy data).
- **Ghost → claim.** A logged-out device mints a random **ghost ID** stored locally. Solo games are tagged with it and stored client-side. On login *on that device*, those games upload and reattach to the account (owner rewrite). Known limitations, both acceptable: ghost IDs are per-device; a shared device attaches ghost games to whoever logs in first.

## 4. Architecture Overview

```
 Browser (React + zustand)              Server (Node)                 Postgres (Neon/Supabase)
 ┌───────────────────────┐   Socket.IO  ┌────────────────────┐        ┌──────────────────────┐
 │ Local game (offline)  │──end-of-game─│ Auth (username/pw, │        │ accounts             │
 │   engine in-browser   │   push (JSON)│   JWT)             │        │ games (+ snapshot)   │
 │ Online game (view)    │◀────────────▶│ Room/session mgr   │◀──────▶│ game_players         │
 │ IndexedDB ghost queue │  live moves  │ Engine (validate)  │        │ moves (append-only)  │
 └───────────────────────┘  + state     │ Reconnect/AI mgr   │        └──────────────────────┘
                                        └────────────────────┘
```

- **Transport: Socket.IO** replaces raw `ws`. Battle-tested auto-reconnect, heartbeats, and message buffering across brief drops — the core anti-frustration mechanism. Same logical message protocol (`play`/`pass`/`recycle`/`state`/`gameOver`/vote events). Free library; runs on the existing Node server.
- **Server-authoritative engine.** Every online move is validated by `@viota/engine` before it mutates state. The engine's finished-game guard and rules checks already prevent corruption.
- **Persistence: hosted Postgres** (Neon or Supabase free tier). Replaces the ephemeral sqlite file so a Render redeploy or idle spin-down no longer kills an in-progress game.

## 5. Reconnect & Disconnect Policy (anti-frustration core)

1. **Heartbeat** (Socket.IO ping/pong) distinguishes a real drop from a momentary blip. Brief blips are ridden out transparently by Socket.IO reconnection; the game does not react.
2. **Grace period** on a confirmed drop: the game politely waits. **Host-configurable** using the existing WaitingRoom options (30s / 1m / 2m / 5m), **default 2 minutes**. No forfeit, no auto-advance past the missing player if it's their turn.
3. **Still gone after grace → vote.** Remaining connected players vote: keep waiting, or hand the seat to an **AI** at a chosen difficulty.
4. **AI takeover is persistent.** Once voted, the AI plays *every* turn for that seat until the human returns (fixes today's one-move-then-stall bug).
5. **Reclaim on reconnect.** The instant the account reconnects, control returns to the human and the AI steps aside. Because identity = account, this survives a full refresh, app restart, or device sleep.
6. **The game never forfeits or stalls.** Worst case, an AI keeps a seat warm; best case, brief drops are invisible.

## 6. Data Model (Postgres)

Behind a repository layer so SQL is centralized and testable.

- **accounts**: `id uuid pk`, `username text unique`, `password_hash text`, `email text null`, `created_at timestamptz`.
- **games**: `id uuid pk`, `mode enum('online','local')`, `status enum('waiting','active','finished','abandoned')`, `player_count int`, `state_snapshot jsonb` (current authoritative GameState for fast resume), `winner_seat int null`, `engine_version text`, `created_at`, `ended_at null`.
- **game_players**: `game_id fk`, `seat_index int`, `owner_type enum('account','ghost','ai')`, `owner_id text null` (account uuid or ghost id; null for pure AI), `display_name text`, `ai_difficulty text null`, `controlled_by_ai bool default false`, `final_score int null`, PK `(game_id, seat_index)`.
- **moves** (append-only, the analytics + replay log): `id bigserial pk`, `game_id fk`, `move_index int` (per-game ordinal), `seat_index int`, `type enum('play','pass','recycle')`, `payload jsonb` (placements / trades / recycle target), `score_delta int`, `created_at`.
- **rooms**: `code text pk`, `game_id fk null`, `host_account_id uuid`, `status enum('waiting','playing','finished')`, `config jsonb` (disconnect timeout, etc.), `created_at`.

`state_snapshot` gives O(1) resume; `moves` gives the durable, analyzable history. Both are written per move (belt and suspenders). Ghost solo games never hit the server until claimed; claiming inserts them as account-owned `games` + `moves`.

## 7. Local Game Sync (ghost + claim)

- Solo-vs-AI runs entirely **client-side** (engine in the browser) — instant, offline-capable.
- On **game end**, one push:
  - **Logged in** → POST the finished game (result + full move log) to the server under the account.
  - **Ghost** → store the finished game in **IndexedDB**; on next login, upload the queued games and claim them (owner = account).
- No move-by-move network chatter for local play. Online games are streamed live server-side, so their move log is captured in real time.

## 8. Error Handling & Security Hardening

- **Schema-validate every inbound message** (zod or hand-rolled guards). Malformed payloads are rejected with a clear error — never crash the process (fixes today's uncaught-throw crash on bad input).
- **Auth on every action.** The Socket.IO handshake carries a JWT; each move is checked against the authenticated account's seat.
- **Server remains the sole authority.** `tradeOrder`/placements/recycle are re-validated by the engine every time; the engine's permutation + finished-game guards (already shipped) apply.
- **Rejected moves surface to the player** (toast/inline), replacing today's silent drop.
- **CORS/WSS** configured for the deployed origins.

## 9. Hosting

- **Render (free)** for the server + **Neon or Supabase (free)** for Postgres. No paid tier required for launch.
- **Cold start:** Render free spins down when idle (~52s first-hit wake). Mitigations: a lightweight keep-warm ping during play windows and a proper "waking up the table…" loading state so it never looks broken. (Optional later: paid always-on tier.)
- **Single instance.** In-memory room/session maps are fine; Postgres is the durable backstop so a restart resumes games.

## 10. Analytics (pipeline now, views later)

The append-only `moves` log + `game_players` + `games` is the whole dataset. It supports, later, per-player strategy metrics (scoring efficiency, lot rate, wild usage, pass/trade tendencies, opening patterns, win rate over time). We build the **capture** now; the dashboards are a later, separate effort. No game is lost to analytics — even pre-signup solo games are recovered on claim.

## 11. Phasing (all targeted for this week; front-loaded by risk)

- **Phase 0 — DONE:** engine bulletproof (242 tests, fuzz-clean).
- **Phase 1 — Data + auth:** Postgres schema + repository layer; username/password accounts; JWT. Tests run against an in-memory Postgres (pglite) or disposable test schema.
- **Phase 2 — Transport + reconnect:** swap to Socket.IO; heartbeat; authenticated handshake; resume-by-account snapshot; schema-validated messages.
- **Phase 3 — Disconnect flow:** grace period → vote → persistent AI takeover → reclaim-on-reconnect.
- **Phase 4 — Client wiring:** login/signup UI; account-aware lobby; fully wired OnlineGame (state/gameOver/error/reconnect banners, real draw-pile count, previous-play + score-delta if cheap); local end-of-game push + ghost claim on login.
- **Phase 5 — Analytics capture verification:** confirm the move log is complete and queryable (views deferred).

Each phase is independently shippable and testable. If time runs short, Phases 1–4 are the game-night-critical set; Phase 5 is capture-only and low-risk.

## 12. Testing Strategy

- Engine already fuzz-verified; keep it green.
- Repository layer: unit tests against in-memory Postgres.
- Reconnect/disconnect/AI-takeover/reclaim: integration tests driving two simulated Socket.IO clients through drop → grace → vote → AI → reclaim.
- Message-validation: fuzz malformed payloads, assert no crash + clean rejection.
- Ghost-claim: unit test the owner-rewrite path.
- A scripted end-to-end "two players, one drops and returns, game completes and persists" happy path.

## 13. Open Questions / Risks

- **DB dialect in tests:** confirm pglite (in-memory Postgres) works in vitest, else use a disposable Neon test branch. (Decide in the plan.)
- **Timeline:** the full build before this week is aggressive; Phases 1–4 are the critical path. Fallback if we run short: ship Phase 2–4 on the existing room-code/guest flow and add account-gating in a fast follow (keeps game night playable).
- **Keep-warm vs Render ToS:** verify a modest self-ping is acceptable; otherwise accept the one-time cold-start with good UX.
- **better-sqlite3 removal:** dropping sqlite removes the native-build headache (the Node-version pin in `.npmrc`) — nice side benefit, but double-check nothing else depends on it.
