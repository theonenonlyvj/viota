# viota / VGames — START HERE (cold-start handoff, 2026-07-14)

> ## ⚡ 2026-07-15 UPDATE (overnight council + fixes — read before the threads below)
> Where stale, this block wins over the body below.
>
> 1. **The vjaipur cutover SHIPPED (2026-07-13, `51821cb` on vjaipur main, Render-deployed).**
>    Any "deliberately un-cutover / Thread 4 pending" language below is historical.
> 2. **Program ground truth moved:** read `../vgames-platform/docs/CURRENT-STATE.md` first, and the
>    full 2026-07-15 verified critique of accounts/stats/competitiveness at
>    `../vgames-platform/docs/council/2026-07-15-account-stats-critique.md`. Headline: auth is
>    (over-)done; the competitive/product layer is the gap; council recommends federated stats
>    (kill P4 shared-D1 migration) — pending Vijay.
> 3. **New on viota main (LOCAL commits, NOT pushed).** (Correction 2026-07-17: pushing viota
>    does NOT deploy anything — the Pages project is direct-upload, not git-connected, and the
>    workers deploy only via `wrangler deploy`. See `../../vgames-platform/docs/OPS-RUNBOOK.md`.)
>    - `d1ead5a` introspect returns displayName + bounded alias set (was found uncommitted from a
>      prior session; tests verified green, then committed). **vwiki-race's hardening branch
>      consumes these fields — deploy the viota worker BEFORE vwiki-race, always.**
>    - `f4afc55` test-toolchain bump (vitest 3→4, pool-workers 0.8→0.18) — independently revertable.
>    - `95ad816` claim CTAs at high-intent moments (Your Stats both states + local game-over
>      "Save this win — claim your name"), gated on `!getUsername()`, reusing AccountModal.
>    - `4531a09` SQL leaderboard views annotated UNUSED at runtime (live boards = TS handlers in
>      `packages/worker/src/stats/leaderboard.ts`).
> 4. **Test state:** worker 405/405 (the long-documented ~1-in-3 e2e "flake" was DIAGNOSED +
>    FIXED 2026-07-17: it was vitest's default 5000ms testTimeout on the full-lifecycle e2e —
>    explicit 60s timeout now, 3/3 full-suite runs green); client 372/372; `tsc --noEmit` clean.
> 5. **Known product findings for viota specifically** (see critique appendix): ghost display
>    names default to bare "Player" (indistinguishable rows on boards); "Best play/Best game"
>    boards include self-reported local scores (filter/badge/split = Vijay's call); no
>    head-to-head surface yet (game_players has the data).

You're taking over mid-stream. This is the index of every open thread with its status + exact resume
pointer. Read this first, then the per-thread doc it points to. Vijay is the user (terse, direct, wants
structured choices, "show before commit," flags-don't-guess; see his auto-memory).

## How work is done here (conventions — follow them)
- **Methodology:** Superpowers skills. `brainstorming` → `writing-plans` → `subagent-driven-development`
  (fresh implementer subagent per chunk + an adversarial reviewer subagent + fix loop). Reviews have caught
  real bugs every phase — keep using them.
- **HARD invariants:** NEVER modify the rules engines (`viota/packages/engine`, `vjaipur/src/engine`).
  Additive D1 only (`ADD COLUMN` nullable/defaulted, `CREATE ... IF NOT EXISTS`; no drops/rebuilds; D1
  migrations before worker deploy). No plaintext passwords. Keep both games playable.
- **Deploys:** `wrangler` is authed as Vijay (OAuth). Do NOT push to remotes / deploy to prod / mutate live
  Supabase **unattended or without Vijay's explicit go** — except: he has standing approval for the viota
  work he's actively driving (that's how the fixes + P1 got shipped). When unsure, stage + ask.
- **Workspace boundary:** only write inside `/Users/vijayram/Cursor`, `/tmp`, the mac temp dir, `~/.claude`.
  A PreToolUse hook enforces it. Git ops belong inside a subproject; never `git init` the umbrella.
- **Visual checks:** a committed Playwright harness exists at `viota/packages/client/e2e/rotate-check.mjs`
  (raw `playwright` lib). NOTE: npm/pnpm installs of `playwright` were hanging (registry throttling); the
  browser is cached in `~/Library/Caches/ms-playwright`, and the package can be copied from the npx cache
  (`~/.npm/_npx/*/node_modules/playwright*`) into `e2e/node_modules` if a fresh install won't complete.

## Repos + live state
- **viota** `/Users/vijayram/Cursor/viota` — Iota. Cloudflare Worker+DO+D1 (worker=**viota-worker**, D1=**viota**)
  + React/Vite client on Pages (**viota.pages.dev**). `main` is canonical + deployed. Worker URL:
  `https://viota-worker.theonenonlyvj.workers.dev`.
- **vjaipur** `/Users/vijayram/Cursor/vjaipur` — Jaipur. Node+Socket.IO on Render + Supabase. `main` is LIVE
  and **deliberately un-cutover** (see Thread 4).
- **vgames-platform** `/Users/vijayram/Cursor/vgames-platform` — the shared-platform program hub (docs +
  migration scripts + runbooks; git repo).

---

## THREAD 1 — viota stats + leaderboards (ACTIVE BUILD, ~90%, on a branch, NOT deployed)
**Branch `stats-leaderboards`** (pushed to origin; worktree `viota/.worktrees/stats-leaderboards`).
**Resume ledger (authoritative):** `viota/.worktrees/stats-leaderboards/.superpowers/sdd/progress.md`.
Spec: `viota/docs/superpowers/specs/2026-07-14-viota-stats-leaderboards-design.md`. Plan:
`viota/docs/superpowers/plans/2026-07-14-viota-stats-leaderboards.md`.

**Feature:** personal stats + several small leaderboards on the VGames D1 (viota's D1). Boards split
**vs-Friends / vs-AI / High-scores**. All games logged (online = server-authoritative; local vs-AI =
client-reported, tagged `source`). Decisions: multiple small boards; log everything; just-add-logging (don't
converge the vs-AI modes — that's backlog #2); win/loss split by opponent.

**Built + reviewed + green (worker 382 / client 342, engine untouched):** Phase 2 (game-end stats derivation
— ties→draw, stalemate→score, AI-takeover-aware), Phase 3 (admin-gated idempotent backfill), Phase 5
(`GET /leaderboard` 7 boards + `GET /me/stats`), Phase 6 (Leaderboard + Your-Stats UI pages, Neon-Night),
Phase 4 (`POST /games/report` server re-derives from uploaded moves + client uploads finished local games;
store now captures the local move log).

**REMAINING:**
1. **Review Phase 4** — the ONE chunk built without a review pass (commits `7dbe94a`,`46363ab`,`0711044`).
   Focus: `/games/report` auth (owner-seat gated) + idempotency (by `clientGameId`) + the client wiring in
   `store/gameStore.ts` (local-only, online path must be untouched). It reuses already-reviewed derivation.
2. **Phase 1 — login adoption UI** (Tasks 1-2 in the plan): `net/account.ts` (claim via `/auth/set-credentials`,
   login via `/auth/login`) + an AccountModal + header identity. Optional enhancement — boards already work
   for ghosts via `display_name`; login makes identity stable cross-device.
3. **Visual check** (Playwright): seed a few local D1 games first so boards aren't empty, then screenshot
   `/leaderboard` + `/stats`.
4. **GATED deploy:** apply `packages/worker/migrations/0004_stats.sql` to prod `viota` D1 → `wrangler deploy`
   → `POST /admin/backfill-stats` (admin step-up token, `ADMIN_JWT_SECRET`, `aud:'vgames-admin'`) → build +
   `wrangler pages deploy` client. (Same discipline as the P1 cutover.)

---

## THREAD 2 — viota online-MP fixes (SHIPPED LIVE; need Vijay to pressure-test)
5 issues Vijay hit in a live 3-player game, all fixed + **deployed to viota.pages.dev + main**:
#1 AI-takeover-too-fast (server presence bug — cover deadline now from turn-start not stale heartbeat),
#2 stale player names (server-authoritative roster), #3 invite-link resume into active games, #4 turn
indicator, #5 board-rotate keeps cards upright + persists (visually verified via Playwright). Root-cause doc:
`viota/docs/ONLINE-MP-BACKLOG.md`. **Open:** Vijay pressure-tests them with friends —
checklist `viota/docs/PRESSURE-TEST-shipped-fixes.md`; fix anything that surfaces.

---

## THREAD 3 — viota deferred backlog (`viota/docs/FRONTEND-REDESIGN-BACKLOG.md`)
- **Gameplay board redesign** (big; needs a brainstorm) — the last screen on old inline styling
  (`Game.tsx`/`OnlineGame.tsx`/`Board`/`TopBar`/`Hand`/`Cell`/`PassTradeModal`) → Neon-Night.
- **"Online vs AI done right"** (backlog #2; connects to stats' client-report path — could retire the
  server-side medium-AI online mode and have one client-run+logged "vs AI").
- **Quick wins:** shared `PillButton`, `useModalDismiss` focus-restore, Lobby input `aria-label`s, a stale
  spec-doc note, test-gap fills.
- **Wild-recycle affordance** — the recycle *works* (click a placed wild on your turn) but is invisible;
  needs an icon/glow/hint. Vijay: functionality exists, only the hint is deferred.
- **Local-game resume** — `hooks/useLocalResumableGame.ts` is a `return null` stub; fill it.
- (The backlog's "VGames account" entry is STALE — that shipped as P1; fix that note.)

---

## THREAD 4 — VGames platform program (P1 DEPLOYED LIVE; vjaipur cutover PENDING)
Shared accounts + never-forfeit online across viota+vjaipur. **P1 (VGames Identity) is BUILT + DEPLOYED
LIVE** in viota's worker/D1 (endpoints `/auth/quick|set-credentials|login|introspect|claim`, `/admin/merge`;
smoke-verified live; **workerd caps PBKDF2 at 100000 iters** — that's set). Program docs + the locked
structure: `vgames-platform/docs/STRUCTURE-LOCKED.md`, spec + plan in `vgames-platform/docs/superpowers/`.

**The one remaining live step = the vjaipur cutover.** It has its OWN complete cold-start handoff for a
fresh agent (needs Vijay for the Supabase SQL + Render env, which Claude lacks access to):
**`vgames-platform/docs/HANDOFF-vjaipur-cutover.md`** — migrate vjaipur's ~10 Supabase players into VGames
accounts + flip vjaipur onto them, closing a live account-takeover hole. vjaipur's flip is staged on branch
`vjaipur` `vgames-p1` (pushed). **Future phases:** P2 extract VGames Rooms (DO infra) + engine-adapter,
P3 vjaipur online on it (retire Socket.IO), P4 migrate vjaipur match/stat data + decommission Supabase/Render.
The engine-adapter interface is already locked in STRUCTURE-LOCKED.md for P2.

---

## Suggested next actions (for whoever picks up)
1. Finish THREAD 1 (review Phase 4 → Phase 1 → visual → gated deploy) — closest to done, high value.
2. Help Vijay pressure-test THREAD 2; fix regressions.
3. THREAD 3 quick-wins (fast) or brainstorm the board redesign (big) with Vijay.
4. THREAD 4 vjaipur cutover when Vijay's ready to run the Supabase/Render steps.
