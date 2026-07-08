# viota — FRONT-END REDESIGN HANDOFF

> **You are the incoming agent for the front-end (UI/visual) redesign of viota.**
> Everything below is the state as of 2026-07-06. The **game logic and backend are
> DONE, certified, and LIVE in production** — your job is the look & feel, not the
> rules or the networking. Read §4 and §8 before you touch anything: there are hard
> invariants the current UI upholds that a redesign must not break.

---

## 0. TL;DR

- **viota** = a browser implementation of the card game **Iota** (2–4 players), by Vijay (`theonenonlyvj`).
- Monorepo (pnpm) at `/Users/vijayram/Cursor/viota`: `packages/engine` (pure rules+AI), `packages/worker` (Cloudflare Durable-Object backend), `packages/client` (React UI — **your workspace**). `packages/server/` is a dead legacy dir (its git-tracked source was deleted; ignore it).
- **Stack (client):** React 18 + Vite 5 + `react-router-dom` 6 + `zustand` 4. **No CSS framework — styling is 100% inline `style={{…}}`** (≈97 usages, zero `.css` files). A redesign almost certainly wants to introduce a real styling approach (see §11).
- **Live:** client at **https://viota.pages.dev** (Cloudflare Pages), backend at **https://viota-worker.theonenonlyvj.workers.dev** (Cloudflare Worker + one Durable Object per game + D1). Repo `github.com/theonenonlyvj/viota`, branch `main` == `online-multiplayer` == what's deployed.
- **Scope of your work:** UI/visual redesign only. The current UI is *functional but unstyled* — plain buttons, system fonts, a dark palette (`#1e1e3a`, `#3b82f6`, `#e2e8f0`…). Make it beautiful and pleasant to play. Do **not** change game logic, the network protocol, or the redaction/no-optimism contracts.

## 1. What the game is + GROUND TRUTH for rules

Iota: a 66-card deck — 64 unique cards (every combination of 4 colors × 4 shapes × 4 numbers 1–4) + 2 wild cards. Players place cards to form/extend lines; a line is valid iff, for **each** of the three properties (color, shape, number), the values are **all the same or all different**. 4-card lines ("lots") double their score. Wilds have face value 0 but can stand for anything.

**Rules ground truth (never contradict these):**
- `ref/iota_rules.txt` — Vijay's typed rulebook (authoritative).
- `ref/viota_first_order_principles.rtf` — the enforceable spec.
- `ref/7f-iota-rulebook.pdf` — the official rulebook.

The **engine** (`packages/engine`) is the single source of truth for legality/scoring and is **certified bulletproof** (exhaustive + fuzz testing, an independent falsification council, and a fresh DO-system fuzz — see §3). **Do not reimplement rules in the UI.** The UI should *display* state and *submit intents*; the engine/worker decide legality.

## 2. Status: what's done vs what's left

**DONE (do not redo):**
- Engine: certified. 82 tests.
- Backend (Cloudflare Worker + Durable Object + D1): full online multiplayer — accounts, rooms, join-by-code, host-controlled start, moves, idempotency, silent reclaim, bounded veto, AI takeover on disconnect, pause/resume, event-sourced replay, D1 archive. 262 worker tests (incl. a fuzz/property pressure suite).
- Client **logic** (the `net/` layer + `store/gameStore.ts`): HTTP-first online mode, outbox retry, reconcile, nudge socket, device identity. 180 client tests.
- **Total: 524 tests green.** Two criticals were found in an audit and fixed + proven live (opponent-hand-leak; the AI-takeover-on-disconnect was dead code). A live 2-player E2E against prod passed 18/18 and the never-stall cover was verified firing live.
- Deploy: fully deployed to Cloudflare and verified.

**LEFT (your job): the front-end redesign.** The UI works end-to-end but is visually minimal. Nothing in the UI is a correctness risk — it's purely aesthetic/UX polish + a real design system.

## 3. Recommended first step

This is creative/design work: **start with `superpowers:brainstorming`** to explore the visual direction WITH Vijay before implementing, then `frontend-design` for execution. Do not jump straight to code. Vijay plays this in person / online with friends, so it should feel like a real, polished little game.

## 4. Architecture — what NOT to break

**Online is HTTP-first; the WebSocket is only a "nudge."** All mutation + recovery happen over idempotent HTTP; the socket just says "there's news at index N," prompting a `GET /sync`. Never make correctness ride on the socket.

**Event-sourced backend:** `initial_state` + the move log = truth; the snapshot is a cache. The DO enforces all rules. The client is a **thin, non-authoritative view**.

**Redaction (HARD rule):** the client only ever receives **its own hand in full**; every other seat is a **count only**; the draw pile is a **count only**; `initial_state` is never sent. The UI must be built to render from a per-seat `ClientView` and must **never assume it knows an opponent's cards**. Shape of the per-seat view (`ClientView`, from `packages/worker/src/do/view.ts`):
```
{ grid: [string, Card][], mySeat, myHand: Card[], handCounts: number[],
  drawPileCount: number, scores: number[], turnIndex, playedCards, consecutivePasses, finished }
```
`grid` is an array of `[ "x,y", Card ]` entries (rebuild with `new Map(grid)`).

**No optimism (HARD rule):** the online store does **not** optimistically mutate the board. A submitted move shows a "pending" affordance and the board only changes when the authoritative server view arrives (`applyOnlineView` replaces state when the server's `moveIndex >= local`). If you add animations/interactions, keep this: stage locally, confirm, then reflect the server's truth. Do not add speculative board updates.

## 5. The client — where the UI lives (`packages/client/src`)

**Pages (`src/pages/`), routed in `src/main.tsx`:**
- `/` → `Home.tsx` — landing; choose local-vs-AI or online; shows the resume list.
- `/game/local` → `Game.tsx` — **single-player vs AI**, fully client-side (uses `gameLogic.ts` + `workers/ai.worker.ts`). No network.
- `/lobby` → `Lobby.tsx` — create/join an online room; AI-takeover picker; embeds `ResumeGames`.
- `/lobby/:code` → `WaitingRoom.tsx` — the pre-game room (roster, share code, host-only Start, AI-takeover display, Leave).
- `/game/online` → `OnlineGame.tsx` — **the online game board**; syncs + reconciles on mount, handles nudges, cover toasts, reclaim, veto, "Play again".

**Components (`src/components/`):** `Board.tsx` (the grid), `Cell.tsx`, `Card.tsx` (a single card — **the main visual primitive**; colors/shapes/numbers/wild), `Hand.tsx` (your hand), `TopBar.tsx` (scores, draw-pile count, turn), `PassTradeModal.tsx` (pass/trade UI — bottom-first, player-chosen order), `ResumeGames.tsx` (saved-games list).

**State:** `src/store/gameStore.ts` — a zustand store with **two modes**: local single-player and online (HTTP-first). It's the seam between UI and logic — read it before restyling, but you rarely need to change it for a visual redesign.

**Networking (`src/net/`) — you almost never touch these for a redesign:** `config` (server URL from `VITE_SERVER_URL`), `identity` (device credential + JWT), `http` (authed fetch), `lobby` (create/join/start/leave/my-games), `online` (move/outbox/sync), `outbox`+`idb` (IndexedDB queue), `reconcile`, `nudge` (WebSocket), `session`, `ghost`, `protocol`.

**Styling reality:** everything is inline styles. Colors currently in use are an ad-hoc dark theme (`#1e1e3a` panels, `#3b82f6` accent blue, `#16a34a` green start button, `#e2e8f0`/`#9ca3af` text). There is **no design token system, no theme file, no CSS**. Introducing one is fair game and probably desirable.

## 6. User journeys the redesigned UI must keep working

1. **Local vs AI:** Home → pick difficulty → play a full game vs AI (no login).
2. **Host an online game:** Home/Lobby → Create room (2–4 players, pick AI-takeover patience) → share the 6-char code → (host-only) Start → play.
3. **Join:** Lobby → enter code → land in the waiting room → play when host starts.
4. **In-game:** see your hand + the board + scores + draw count + whose turn; place cards (drag or tap — current impl is tap-to-stage then confirm); pass/trade (bottom-first, choose order); the game announces the winner at the end.
5. **Disconnect resilience (already handled by logic):** if you drop, an AI covers your seat after the host's chosen patience; when you return you reclaim your seat and can **veto** the AI's last turn. The UI shows an `ai_cover` toast + a reclaim/veto affordance — keep these.
6. **Pause/resume:** close the tab and come back; Home lists your saved games to jump back in.
7. **Play again:** at game over, "Play again" spins up a fresh multiplayer room and returns to the lobby to regroup.

## 7. Vijay's rulings (game behavior the UI must respect — don't "fix" these)

- **Pass/trade = bottom-first, player-chosen order.** The player picks the order traded cards go to the bottom of the deck, then redraws to 4. The pass/trade modal must let them order the cards.
- **Stalemate** = the game ends after 3 consecutive all-pass rounds; highest score wins.
- **Wild starter** = if the flipped starter card would be a wild, it's reshuffled to a random spot and re-flipped. Document this in a how-to-play/rules screen if you build one.
- **Ties** = declare a tie; offer an *optional* sudden-death round only if all tied players agree.
- **Wild recycle** = flexible; multiple wild swaps per turn are allowed (don't gate to one).
- **AI takeover** = host-configurable patience (30s / 1 min default / 2 min / 5 min / "wait for me" = never). A *connected* player is **never** auto-covered no matter how long they think.
- **Host-only start** = only the room host sees/uses Start; needs ≥2 humans.

## 8. HARD constraints (violating these breaks correctness or security)

1. **UI only.** Don't modify `packages/engine` or `packages/worker`. Don't change the `net/` protocol or `gameStore` semantics (you may restyle the components they feed).
2. **Never assume opponent hands.** Render only `myHand` fully; others are `handCounts[]`. The draw pile is `drawPileCount`.
3. **No optimistic board mutation** in online mode (see §4).
4. **Keep it playable offline-ish / resilient:** don't remove the pending/reconcile affordances or the cover/reclaim/veto UI hooks.
5. **Icons:** Vijay's standing preference is **OpenMoji** (openmoji.org) for any icon/emoji graphics.
6. **No secrets, no real-identity placeholders** in anything outward-facing.
7. **Keep both modes working:** local (`Game.tsx`) and online (`OnlineGame.tsx`).

## 9. Run / test / build

From the repo root (pnpm monorepo — **run client commands scoped to the client, never a root `npm`**):
```bash
pnpm install                                   # once
pnpm --filter @viota/client dev                # local dev server (Vite) — talks to prod worker unless VITE_SERVER_URL is set
pnpm --filter @viota/client test               # client tests (vitest)
pnpm --filter @viota/client build              # tsc + vite build (build bakes in VITE_SERVER_URL)
```
- For dev against a **local** worker, run `wrangler dev` in `packages/worker` and set `VITE_SERVER_URL=http://localhost:8787` for the client. For dev against **prod**, just omit it or set the prod worker URL.
- **Node 26 gotcha:** tests print a harmless "localStorage is not available" warning; a guarded shim in `src/test-setup.ts` handles it. Ignore it.
- Keep the test suite green as you refactor components (there are component tests under `src/**/*.test.tsx`). Restyling shouldn't break them, but if you change markup/labels, update the tests (don't weaken them to pass).

## 10. Deploy (client) — you'll likely do this

Client is a **direct-upload** Cloudflare Pages project (not git-connected — a GitHub push does NOT auto-deploy). `wrangler` is authenticated on Vijay's machine.
```bash
# from repo root — bake in the prod worker URL, then deploy to the production (main) branch:
VITE_SERVER_URL=https://viota-worker.theonenonlyvj.workers.dev pnpm --filter @viota/client build
npx wrangler pages deploy packages/client/dist --project-name viota --branch=main --commit-dirty=true
```
Omitting `--branch=main` gives a preview URL instead of production. Full backend/deploy details are in the repo root `DEPLOY.md`. **You should not need to touch the worker or D1** for a UI redesign; if you ever do, note migrations must be applied *before* a worker deploy (see DEPLOY.md).

## 11. Known UI gaps / cosmetic notes (candidate work)

- **No design system.** Inline styles everywhere; an ad-hoc dark palette. Introducing tokens/theme + a consistent component style is the core of the redesign.
- **Card rendering** (`Card.tsx`) is the highest-value visual: colors, shapes, numbers, wild — make these crisp and legible at small sizes (boards get dense). Consider OpenMoji or clean SVG for shapes.
- **Board zoom/pan** for large boards; the current impl has a basic zoom.
- **`Home.tsx` / `Lobby.tsx`** are plain — a landing screen with personality would help.
- **Rules / how-to-play screen** doesn't exist; worth adding (document the wild-starter + pass rules from §7).
- **Screenshots** referenced from the bio page (`/screenshots/iota.png`) are placeholders — real ones would be nice once the UI is redone.
- **Naming:** the game is trademarked "Iota"; the repo/UI use "viota"/"Iota" — Vijay has a `renamePending` flag on it in his bio. Ask him about the public name before splashing it large.
- **Social preview** tags in `index.html` are already correct (point at `viota.pages.dev`); an `og-image.png` ships in `public/` — refresh it if the look changes.

## 12. Vijay — working style & preferences

- Terse, direct, no corporate padding. Show before you commit to big visual directions; give structured choices, not open-ended essays. He audits for thoroughness and honesty — flag uncertainty, don't guess.
- He plays this **with friends**, in person and online on their own devices (phones + desktop). Mobile matters. It should feel fun and fast.
- Default icons: **OpenMoji**.

## 13. Pointers

- **Repo:** `/Users/vijayram/Cursor/viota` (branch `main`, == `online-multiplayer`, == prod).
- **Rules:** `ref/iota_rules.txt`, `ref/viota_first_order_principles.rtf`, `ref/7f-iota-rulebook.pdf`.
- **Backend/architecture spec (if you need it):** `docs/superpowers/specs/2026-07-06-viota-online-BEST-architecture.md`.
- **Deploy:** repo root `DEPLOY.md`.
- **Live:** https://viota.pages.dev (game), https://viota-worker.theonenonlyvj.workers.dev (API).
- **This is a UI job.** The logic is done and certified. Make it beautiful; keep it correct.
