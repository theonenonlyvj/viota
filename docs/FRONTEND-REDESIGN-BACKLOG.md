# viota — Front-End Redesign: Status & Backlog

> Living notes on the UI push. Updated 2026-07-09. The redesign is being done in
> **slices** (brainstorm → spec → plan → subagent-driven TDD → Opus final review →
> deploy), reusing one design system. Specs/plans live in `docs/superpowers/`.

---

## ✅ Shipped & LIVE (viota.pages.dev, `main` = `61278ad`)

- **Design system** — `theme.css` tokens/classes/keyframes, self-hosted **Luckiest Guy** (title) +
  **Fredoka** (body), `Button` (chamfer-brutalist, cyan/coral, disabled state), `AuroraBackground`
  (mesh+grain+vignette), `Footer`, `Layout` (chrome route + internal `.chrome-scroll`), shared
  `useModalDismiss` (Esc + focus-trap), tokens incl. `--text-error`. Classes `.field`/`.panel`/
  `.seat-row`/`.ghost-btn`/`.modal-*`/`.resume-*`.
- **Landing** (`Home.tsx`) — Neon-Night hero: wordmark, wink tagline, twin CTAs, drifting real cards,
  Play-vs-AI modal (Local only), How-to-play link, ResumeStrip.
- **Lobby + Waiting room** — two-panel Create/Join (friends-only; solo vs-AI removed), restyled room
  screen (share-code card, roster chips, host-only Start, Leave).
- **How to Play + Settings + Practice mode** — merged from the parallel `how-to-play` agent (PR #1).
- **Join-by-link** — `/lobby/:code` is a real invite (`Room` gate + `JoinRoom` card).

**The Iota card TILE (`Card.tsx`) is LOCKED** — never restyle it (colors/shapes/numbers/wild/size/
radius/shadow stay as shipped). Everything is styled *around* the card.

---

## 🔲 REMAINING — big pieces (each needs its own brainstorm → spec → plan → build)

### 1. Gameplay board redesign  ← the last major screen still on old inline styling
Still old-styled (ad-hoc `#1e1e3a`/`#3b82f6`… inline hex): `pages/Game.tsx` (local), `pages/OnlineGame.tsx`
(online), `components/Board.tsx`, `components/TopBar.tsx`, `components/PassTradeModal.tsx`, `Hand.tsx`,
`Cell.tsx`. Restyle everything **around the LOCKED card tile**: board chrome/background, hand tray,
top bar (scores / draw-pile count / whose-turn), pass/trade modal (bottom-first, player-ordered — keep
the ordering UI), turn indicator, the `ai_cover`/reclaim/veto toasts + affordances, pending/reconcile
affordances, game-over / winner announcement, and the action buttons.
- **Keep the HARD invariants** (handoff §4/§8): redaction (only `myHand` full; others are counts), NO
  optimistic board mutation, HTTP-first, keep cover/reclaim/veto + pause/resume affordances. UI only.
- Board **zoom/pan** for large/dense boards (current impl has a basic zoom; floor `0.5` can't fit big
  boards — noted in the 2026-07-05 audit).
- Needs a design brainstorm first (this is the richest screen — how the board/hand/topbar read in the
  Neon-Night look).

### 2. "Online vs AI, done right"  ← design fork + then the modal toggle
Today online-vs-AI runs the AI **server-side** in the Durable Object (`do/drive.ts` → `AIAgent('medium')`,
hardcoded; expert would blow the DO CPU budget → floored to a pass). Vijay's instinct: maybe the client
should run the AI (like local mode) and the server just **log** the moves (history/replay/resume).
- **Decide the architecture:** server-side AI (bound expert to fit CPU) **vs.** client-runs-AI + server
  logs (client CPU → any difficulty free; server accepts owner-submitted moves for AI seats in a solo
  game — a small worker change).
- **Then:** add the landing Play-vs-AI modal's **Local / Online toggle** + real online difficulty.
- Not client-only (touches worker + maybe D1); needs a worker redeploy. Rules engine stays untouched.

---

## 🔸 REMAINING — polish / accumulated Minor findings (from the slice final-reviews; non-blocking)

- **Shared `PillButton`** — the `pill()` active/inactive styling is duplicated across `Lobby.tsx` and
  `PlayVsAiModal.tsx` (and the lobby's own pill groups). Extract one component; drive active state via a
  CSS `[aria-pressed="true"]` selector instead of inline style.
- **`useModalDismiss`** — use `useLayoutEffect` (not `useEffect`) for initial focus (one paint frame);
  add **focus-restoration** to the triggering element on close (a11y completeness for the shared hook).
- **Input labels / a11y** — `Lobby` name + room-code `<input>`s are placeholder-only (no `<label>` /
  `aria-label`). `JoinRoom` got an `aria-label`; apply the same to `Lobby` (and any other bare inputs).
- **Test gaps** (impl is correct, just not directly covered): `ResumeStrip` online `waiting → /lobby/:code`
  branch untested; `Room` gate never drives a real case mismatch (lowercase `session.code` vs uppercase
  URL — `.toUpperCase()` on both sides is correct).
- **Spec §10 doc drift** — the landing spec §10 says to relax `index.html`'s global scroll lock; the
  implementation instead **kept** `overflow:hidden` + scrolls chrome via an internal `.chrome-scroll`
  container (the better call, and the stated HARD constraint). Amend the spec doc note so a future agent
  isn't confused.

---

## 🔌 REMAINING — open seam (feature never built)

- **Local-game resume** — `hooks/useLocalResumableGame.ts` is **STILL A STUB** (`return null`). The
  landing/lobby `ResumeStrip` renders a local "vs AI · in play" row only when this returns a game, so
  today the strip is **online-only**. The "local-persistence agent" seam was never filled: persist an
  in-progress local (`/game/local`) game to localStorage and return `{ lastActivityAt }`, and wire the
  `/game/local` route to restore it. (Contract/return-type is fixed; just fill the body + the restore.)

---

## 🎨 REMAINING — branding / assets

- **`og-image.png` refresh** — the social-preview image in `public/` predates the Neon-Night look; it no
  longer matches the live hero. Regenerate a 1200×630 og-image from the new landing.
- **Public name / "Iota" trademark** — `index.html` `<title>` and OG tags still say **"Iota"** (the
  trademarked name); the UI wordmark says **viota**. Decide the public name before splashing it large,
  then reconcile `<title>` / OG / any "Iota" copy. (Vijay has a `renamePending` flag on his bio.)
- **Screenshots** — the personal-site bio references placeholder `/screenshots/iota.png`; real
  screenshots of the redesigned UI would be nice (that's the `personal-site` repo, not viota, but part
  of "the UI push" story).

---

## ⏸ DEFERRED — separate scope (not strictly UI)

- **VGames account** — a unified cross-game login (viota + vjaipur), built ONCE, email/reset included.
  Vijay's 2026-07-09 call: don't build viota-only accounts. Today = ghost/quick-account only (device
  credential in localStorage; lost on clear-data / new browser / new device). Full design (ghost →
  create = attach username+password to current ghost → login elsewhere = bind browser + merge ghost
  games; `device_credentials` 1:many; PBKDF2; friend-scale manual D1 reset) is captured separately.

---

## How to pick up a slice

1. `superpowers:brainstorming` (design direction WITH Vijay) → commit a spec in `docs/superpowers/specs/`.
2. `superpowers:writing-plans` → a TDD plan in `docs/superpowers/plans/`.
3. `superpowers:subagent-driven-development` — fresh implementer + spec/quality reviewer per task, Opus
   whole-branch review at the end. Branch off `main` in a worktree.
4. **HARD rules:** UI only unless the slice explicitly says otherwise (engine/worker/net-protocol/
   gameStore/`Card.tsx` untouched); every chamfer/clipped interactive control needs a clip-surviving
   `:focus-visible` ring (the one recurring miss).
5. Deploy (client, direct-upload Pages): `VITE_SERVER_URL=…workers.dev pnpm --filter @viota/client build`
   then `npx wrangler pages deploy packages/client/dist --project-name viota --branch=main`. Note: the
   production HTML edge-caches for a few seconds after deploy — re-fetch to confirm the new asset hash.
