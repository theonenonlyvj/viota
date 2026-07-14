# viota Stats + Leaderboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give viota personal stats + several small global leaderboards (vs-Friends / vs-AI / high-scores) on the shared VGames D1, and adopt the (already-live) VGames username/password login so identities are stable.

**Architecture:** All games are archived to the VGames D1 (`games` + `game_players` + `moves`). Online games are server-authoritative; **local games get logged via a new `POST /games/report`** (tagged `source='client_reported'`). A shared pure `computeSeatStats` derives a per-seat stats blob from a game's move log; the DO calls it at game-end (online) and the client calls it before uploading (local) → identical stats. New read endpoints serve the boards + personal stats. A one-time backfill fills stats for existing online games. viota adds a claim/login UI over the P1 `/auth/*` endpoints.

**Tech Stack:** Cloudflare Worker + Durable Objects + D1; TypeScript; React/Vite/zustand client; `@cloudflare/vitest-pool-workers` (worker tests); vitest + testing-library (client).

**Spec:** `docs/superpowers/specs/2026-07-14-viota-stats-leaderboards-design.md`.

## Global Constraints
- **NEVER modify `packages/engine`** (certified). Read/replay it; wrap it; don't change it.
- **Additive D1 only** — `ADD COLUMN` (nullable/defaulted), `CREATE ... IF NOT EXISTS`; no drops, no rebuilds.
- **Regression gate:** the full worker suite (currently 326) and client suite (currently 310) stay green after each task.
- **Redaction preserved:** stats are post-game aggregates; never leak a live hand. No change to `net/` protocol redaction or the DO's live views.
- **No plaintext, no new auth code** — login adoption reuses the live `/auth/set-credentials` + `/auth/login` endpoints.
- **v1 stats blob (directly derivable from the move log — no replay):** `{ points, bestPlay, plays, passes, wildsRecycled, cardsPlayed, moves, durationMs }`. Replay-dependent stats (`lots`, `longestLine`) are v2 — DO NOT build them now.
- **`game_type='iota'`, `mode ∈ {online,local}`, `source ∈ {online_authoritative, client_reported}`, `owner_type ∈ {human,ai}`.**
- Work on branch `stats-leaderboards` (worktree). Commit per task; do NOT deploy — deploy is a gated step at the end.

**Read before starting:** `packages/worker/src/do/archive.ts` (game-end archive), `packages/worker/src/game-do.ts` (game lifecycle), `packages/worker/src/d1/{schema.ts,accounts.ts}`, `packages/worker/schema/d1.sql`, `packages/worker/src/index.ts` (router), `packages/client/src/net/identity.ts` + `net/lobby.ts`, `packages/client/src/pages/Game.tsx` (local game end), `packages/client/src/store/gameStore.ts`.

---

## PHASE 1 — Login adoption (client foundation; no new worker code)

### Task 1: VGames account client module (claim + login)
**Files:** Create `packages/client/src/net/account.ts`; Test `packages/client/src/net/account.test.ts`.
**Interfaces:** Consumes `serverUrl()` (net/config), `getDeviceCredential()`/`getToken()`/`setToken` (net/identity), `authedFetch` (net/http). Produces:
- `claimAccount(username: string, password: string): Promise<{ ok: true } | { ok: false; error: string }>` — `POST /auth/set-credentials` (Bearer).
- `loginAccount(username: string, password: string): Promise<{ ok: true; mustChangePassword: boolean } | { ok: false; error: string }>` — `POST /auth/login {username, password, deviceCredential}`; on ok, store the returned token + accountId.

- [ ] **Step 1: Failing test** — mock fetch; assert `claimAccount('vijay','hunter2')` POSTs to `/auth/set-credentials` with the Bearer header + `{username,password}` and maps 409→`{ok:false,error:'username_taken'|'not_ghost'}`; `loginAccount` POSTs `{username,password,deviceCredential}`, stores the token on success, maps 401→`{ok:false,error:'invalid_credentials'}`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `account.ts` following `net/lobby.ts`/`net/ghost.ts` conventions (read them). Use `authedFetch` for claim (needs Bearer), plain `fetch` for login (no Bearer). On login success, persist token+accountId via the same setters `identity.ts` uses.
- [ ] **Step 4:** Run → PASS. **Step 5:** `pnpm --filter @viota/client test` green. **Step 6:** Commit `feat(client): VGames claim/login net module`.

### Task 2: Account/Profile UI (claim your name + log in)
**Files:** Create `packages/client/src/components/AccountModal.tsx` (or a Profile section — match the redesign's modal pattern, see `PlayVsAiModal.tsx`/`SettingsMenu`); Modify the header/menu to open it + show current identity; Test `AccountModal.test.tsx`.
**Interfaces:** Consumes `claimAccount`/`loginAccount` (Task 1), `getDisplayName()`/account id (identity). Produces: a modal with two flows — "Claim your name" (username+password → claimAccount, shows success/collision) and "Log in" (username+password → loginAccount). Validate client-side: username `^[a-z0-9_]{3,20}$`, password length 6..128, before calling.

- [ ] **Step 1: Failing test** — render modal; typing an invalid username disables submit / shows a hint; a valid claim calls `claimAccount` and shows success; a login calls `loginAccount`. Mock Task 1's module.
- [ ] **Step 2:** FAIL. **Step 3:** Implement using the existing design-system components (Button/PillButton/useModalDismiss) + Neon-Night theme tokens; wire an entry point in the header/menu that shows the current identity (username if claimed, else guest display_name) + a "claim to save across devices" nudge.
- [ ] **Step 4:** PASS. **Step 5:** client suite green + `pnpm --filter @viota/client build` succeeds. **Step 6:** Commit `feat(client): account claim/login UI`.

---

## PHASE 2 — Shared stats derivation + populate at game-end (worker)

### Task 3: `computeSeatStats` shared pure function
**Files:** Create `packages/worker/src/stats/computeSeatStats.ts`; Test `packages/worker/test/compute-seat-stats.test.ts`. (Worker-side module; the client will import the same logic in Phase 4 — keep it dependency-free so it's portable. Do NOT put it in `packages/engine`.)
**Interfaces:** Produces:
```ts
export type SeatStats = { points: number; bestPlay: number; plays: number; passes: number; wildsRecycled: number; cardsPlayed: number; moves: number; durationMs: number }
export type StatMove = { seat_index: number; type: 'play'|'pass'|'wild_recycle'; payload: string; score_delta: number; created_at: number }
export function computeSeatStats(moves: StatMove[], seat: number, finalScore: number, gameStart: number, gameEnd: number): SeatStats
```
Logic (NO engine replay): filter `moves` to this `seat`; `points=finalScore`; `plays`=count type 'play'; `passes`=count 'pass'; `wildsRecycled`=count 'wild_recycle'; `bestPlay`=max `score_delta` over 'play' moves (0 if none); `cardsPlayed`=sum of `JSON.parse(payload).placements.length` over 'play' moves (guard parse); `moves`=this seat's move count; `durationMs=gameEnd-gameStart`.

- [ ] **Step 1: Failing test** — a fixture move list for seat 0 (two plays scoring 8 and 20, one pass) → assert `{points, bestPlay:20, plays:2, passes:1, wildsRecycled:0, cardsPlayed:<sum>, moves:3, durationMs}`. Include a malformed-payload move → cardsPlayed skips it, no throw.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. Pure, deterministic, no imports beyond JSON.
- [ ] **Step 4:** PASS. **Step 5:** worker suite green. **Step 6:** Commit `feat(worker): computeSeatStats shared derivation`.

### Task 4: `opponent_kind` column + classification helper
**Files:** Create migration `packages/worker/migrations/0004_stats.sql`; Modify `schema/d1.sql` + `src/d1/schema.ts` (fold the column into `game_players`'s CREATE per the P1 pattern — folded CREATE in schema.ts/d1.sql, ALTER only in the migration); Create `packages/worker/src/stats/opponentKind.ts`; Test `packages/worker/test/stats-schema.test.ts` + `opponent-kind.test.ts`.
**Interfaces:** Produces column `game_players.opponent_kind TEXT` (`'human'|'ai'`, nullable). Helper `opponentKindFor(seats: {seat_index:number; owner_type:string}[], seat: number): 'human'|'ai'` — `'human'` iff any seat other than `seat` has `owner_type='human'`, else `'ai'`.
- [ ] Schema test asserts `opponent_kind` present after `applyD1Schema`. Migration `0004` = `ALTER TABLE game_players ADD COLUMN opponent_kind TEXT;`. Helper test: a game with seats [human,ai] → seat0 opponent_kind 'ai'; [human,human] → 'human'; [human,human,ai] → 'human'. Red→green→commit `feat(worker): opponent_kind column + classifier`.

### Task 5: Populate result/stats/opponent_kind at game-end
**Files:** Modify `packages/worker/src/do/archive.ts` (`flushGameEnd` and/or the game_players finalize path) — read the file; Test extend `packages/worker/test/archive.test.ts` (or a new `archive-stats.test.ts`).
**Interfaces:** Consumes `computeSeatStats` (Task 3), `opponentKindFor` (Task 4), the DO's move log for the game, `games.winner_seat`. At game-end, for each human seat: set `result` (`'win'` if `seat_index===winner_seat`, `'draw'` if winner_seat null/tie, else `'loss'`), `opponent_kind`, and `stats` (JSON string). Must be inside the existing write-through archive (never block a move; `ctx.waitUntil` path).
- [ ] **Step 1: Failing test** — drive a short DO game to completion (reuse the existing e2e/archive test harness), then assert the archived `game_players` rows have non-null `result`, `opponent_kind`, and a parseable `stats` with `points`/`bestPlay`. **Step 2:** FAIL. **Step 3:** Implement in `archive.ts` (read the seat move rows from the DO/archive, call the two helpers, write the columns in the existing `flushGameEnd` UPDATE — extend its SET list). **Step 4:** PASS. **Step 5:** full worker suite green (esp. existing archive tests). **Step 6:** Commit `feat(worker): archive result/stats/opponent_kind at game-end`.

---

## PHASE 3 — Backfill existing online games

### Task 6: Backfill script/endpoint
**Files:** Create `packages/worker/src/stats/backfill.ts` + an admin-gated route `POST /admin/backfill-stats` in `src/index.ts` (reuse the `ADMIN_JWT_SECRET` step-up from P1's `/admin/merge`); Test `packages/worker/test/backfill.test.ts`.
**Interfaces:** `backfillStats(db): Promise<{ gamesProcessed: number; rowsFilled: number }>` — for each `games` row with `status='completed'` that has `game_players` rows with NULL `result`, load its `moves` + seats, compute + fill `result`/`opponent_kind`/`stats` (idempotent: only fills NULLs). Bounded/batched.
- [ ] **Step 1: Failing test** — seed the test D1 with a completed game + moves + game_players (NULL stats), run `backfillStats`, assert rows now filled; a second run fills zero (idempotent). **Step 2:** FAIL. **Step 3:** Implement (reuse Task 3/4 helpers). Route: admin step-up token required (mirror `/admin/merge`). **Step 4:** PASS. **Step 5:** worker suite green. **Step 6:** Commit `feat(worker): stats backfill (admin-gated)`.

---

## PHASE 4 — Client-reported local games

### Task 7: `POST /games/report` endpoint
**Files:** Create `packages/worker/src/stats/report.ts`; register in `src/index.ts`; Test `packages/worker/test/games-report.test.ts`.
**Interfaces:** `POST /games/report` (Bearer). Body: `{ playerCount, players: {seat, accountId?, ghostId?, ownerType, displayName}[], winnerSeat: number|null, seats: {seat, finalScore}[], initialState: string, moves: StatMove[], startedAt, endedAt }`. Auth: `requireCanonicalAccount`; the reporter must own a human seat (match accountId). Server RE-DERIVES stats via `computeSeatStats` (do NOT trust client-sent stats numbers) + `opponentKindFor`; writes a `games` row (`game_type='iota'`, `mode='local'`, `source='client_reported'`, `status='completed'`, winner_seat) + `game_players` rows (result/opponent_kind/stats/final_score). Idempotent per a client-supplied `clientGameId` (dedupe).
- [ ] **Step 1: Failing test** — POST a synthetic completed local game as the seat-0 owner → 200; assert a `games` row (source='client_reported') + `game_players` rows with server-derived `result`/`stats`; re-POST same `clientGameId` → no duplicate. A POST where the caller doesn't own a seat → 403. **Step 2:** FAIL. **Step 3:** Implement; server-side derivation is authoritative (client's numbers ignored; the moves are the input). **Step 4:** PASS. **Step 5:** worker suite green. **Step 6:** Commit `feat(worker): POST /games/report for client-reported local games`.

### Task 8: Upload local games from the client
**Files:** Create `packages/client/src/net/reportGame.ts`; Modify `packages/client/src/store/gameStore.ts` (or `pages/Game.tsx`) to call it when a LOCAL game finishes; Test `reportGame.test.ts`.
**Interfaces:** `reportLocalGame(game): Promise<void>` — builds the `/games/report` body from the finished local `GameState` + its move history (the store must retain the move log + initial state for local games — verify it does; if not, capture it). Fire-and-forget (never block UI; swallow errors). Include a stable `clientGameId` (e.g. a uuid minted at local-game start).
- [ ] **Step 1: Failing test** — mock fetch; when a local game reaches `finished`, `reportLocalGame` POSTs `/games/report` with the right shape (players, winnerSeat, moves, clientGameId). **Step 2:** FAIL. **Step 3:** Implement; wire the local-game-finished transition in the store to call it once. Ensure the local game retains initialState + moves (add to the store if missing — this is the one place the client needs a move log; keep it local-only). **Step 4:** PASS. **Step 5:** client suite green + build. **Step 6:** Commit `feat(client): report finished local games to /games/report`.

---

## PHASE 5 — Read endpoints (leaderboards + personal stats)

### Task 9: `GET /leaderboard`
**Files:** Create `packages/worker/src/stats/leaderboard.ts`; register in `src/index.ts`; Test `packages/worker/test/leaderboard.test.ts`.
**Interfaces:** `GET /leaderboard?game=iota&board=<key>` → `{ board, rows: {accountId, displayName, username?, value, games}[], me?: {rank, value} }`. Boards:
- `winrate-friends`: human seats, `opponent_kind='human'`, min 5 games, ranked by wins/games.
- `wins-friends`: total wins where `opponent_kind='human'`.
- `streak-friends`: longest win streak (ordered by ended_at) vs humans.
- `winrate-ai` / `wins-ai`: same but `opponent_kind='ai'`.
- `bestplay`: max `json_extract(stats,'$.bestPlay')` across all games. `bestgame`: max `final_score`.
Group by `account_id`; resolve `username`/`display_name` from `accounts`. Ghosts appear by display_name. (Streak may be computed in JS from the ordered per-account results if SQL is awkward — small data.)
- [ ] **Step 1: Failing test** — seed several completed games (mix of human/ai opponents, varied scores) across 2-3 accounts; assert each board returns correctly-ranked rows; win-rate respects the min-games floor; `bestplay` reads the stats JSON. **Step 2:** FAIL. **Step 3:** Implement (SQL over `game_players`+`games`+`accounts`; JS for streak). **Step 4:** PASS. **Step 5:** worker suite green. **Step 6:** Commit `feat(worker): GET /leaderboard`.

### Task 10: `GET /me/stats`
**Files:** Add to `packages/worker/src/stats/leaderboard.ts` (or `me-stats.ts`); register; Test `me-stats.test.ts`.
**Interfaces:** `GET /me/stats` (Bearer) → the requester's aggregate: `{ games, vsFriends:{games,wins,winRate,streak}, vsAI:{games,wins,winRate}, bestPlay, bestGame, playerSince, lastPlayed, byPlayerCount:{2,3,4}, totalTimeMs }`. Aggregates `game_players`+`games`+`stats` for `ctx.accountId` (canonicalized).
- [ ] Red (seed the caller's games, assert aggregates) → green → commit `feat(worker): GET /me/stats`.

---

## PHASE 6 — Client UI

### Task 11: Leaderboard page
**Files:** Create `packages/client/src/pages/Leaderboard.tsx` + `net/leaderboard.ts`; add route `/leaderboard` in `main.tsx` + a nav entry (Home/header); Test `Leaderboard.test.tsx`.
**Interfaces:** `fetchLeaderboard(board): Promise<Board>`. Page renders tabs/sections: **vs Friends** (win rate / wins / streak), **vs AI** (win rate / wins), **High scores** (best play / best game). Highlight the current user's row. Neon-Night styled (design tokens; match the redesigned screens). Empty-state copy when a board has no qualifying rows.
- [ ] Red (render with mocked data → boards + tabs + own-row highlight) → green → build → commit `feat(client): leaderboard page`.

### Task 12: "Your stats" page
**Files:** Create `packages/client/src/pages/YourStats.tsx`; route `/stats` + nav; `net` call to `/me/stats`; Test.
**Interfaces:** renders the `/me/stats` fields — vs-Friends + vs-AI win rates, games, best play/game, streak, splits by player-count, total time, player-since. Styled. Handle the not-logged-in/ghost case gracefully (still shows this-device's ghost stats).
- [ ] Red → green → build → commit `feat(client): your-stats page`.

### Task 13: Regression + integration pass
- [ ] Full suites green: `pnpm --filter @viota/worker test`, `pnpm --filter @viota/engine test`, `pnpm --filter @viota/client test`. Engine untouched (`git diff --stat <base> -- packages/engine` empty).
- [ ] Build both: worker `wrangler deploy --dry-run` (or `vitest`), client `pnpm --filter @viota/client build`.
- [ ] Commit any fixes.

---

## Deploy (GATED — after all tasks + review; not unattended)
Apply `0004_stats.sql` to prod D1 → deploy worker → run `POST /admin/backfill-stats` (admin token) → deploy client → verify a leaderboard + your-stats render live + a local game reports. (Mirror the P1 cutover discipline: D1 migration before worker deploy.)

## Self-review notes (author)
- **Spec coverage:** boards §2→Task 9/11; data model §3→Task 4/5; computeSeatStats §4→Task 3 (+ client re-use Task 8 uses the same worker module logic — NOTE: the client can't import from the worker package directly; Task 8 should either duplicate the small pure function into the client or the server re-derives from uploaded moves. **The plan chooses server-side re-derivation in Task 7 (`/games/report` re-derives), so the client does NOT need computeSeatStats — Task 8 just uploads the raw moves.** This resolves the cross-package import cleanly.); endpoints §5→Task 7/9/10; login adoption §6→Task 1/2; backfill §7→Task 6; UI→Task 11/12.
- **v1 stats trimmed** to no-replay fields (lots/longestLine deferred) — consistent across Task 3/5/6/7.
- **Placeholder scan:** none; each task has a concrete deliverable + test intent. Endpoint bodies/SQL are specified enough for an implementer who reads the named files.
- **Type consistency:** `SeatStats`/`StatMove`/`computeSeatStats` signature identical across Tasks 3/5/6/7; `opponentKindFor` across 4/5/6/7; board keys identical across 9/11.
- **Cross-package note (important):** `computeSeatStats` lives in the WORKER; the client (Task 8) uploads raw `moves` and the server re-derives — so there's no worker→client import problem, and client-reported stats are server-computed (better trust posture too).
