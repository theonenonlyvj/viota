# viota — How-to-Play, In-Game Settings, and Practice Mode — Design

- **Date:** 2026-07-08
- **Branch:** `how-to-play` (off `online-multiplayer`, which is byte-identical to `main`/prod at `7601e9a`)
- **Author:** design brainstorm with Vijay
- **Status:** design for approval

---

## 1. Context & goals

viota is a browser implementation of the card game Iota. The engine + backend are certified and live; the **front-end visual redesign is happening in parallel on a separate track**. This branch adds three *additive* player-facing features on top of the current (pre-redesign) UI:

1. **How to Play** — a standalone, ephemeral teaching screen. Hybrid: illustrated rules + a few inline interactive demos.
2. **In-game settings menu** — a gear icon that opens a small menu whose centerpiece is a rules quick-reference.
3. **Practice mode** — curated, small board situations with a fixed hand where the player finds the best move.

These directly satisfy two items already on Vijay's `ref/improvements.txt` wishlist ("also a tutorial section" and "what are my potential next move(s)/best moves").

### Design principle given the parallel redesign

Because a full visual redesign is landing separately, this work optimizes for **durable structure and logic, not pixels**:

- The lasting deliverables are: the canonical rules-content module, the puzzle data set, the solver/grading engine, and the interaction flows.
- Styling is **placeholder** — it reuses the app's current inline-style patterns and palette so the features are usable and testable now, and so the redesign can re-skin them uniformly (the redesign is introducing a design system from scratch; there are no tokens today).
- **Shared files are touched as little as possible** (see §7 file map) to minimize merge conflicts with the redesign, which will be rewriting the same chrome (`Home`, `TopBar`, `Board`, `Card`).

---

## 2. Hard constraints (from the redesign handoff) & coordination

**Must not break (correctness/security):**

1. **UI only.** Do not modify `packages/engine` or `packages/worker`; do not change the `net/` protocol or the online semantics of `store/gameStore.ts`. New logic (solver, rules content, puzzle data) lives in the **client**, built on the engine's *exported* functions.
2. **Redaction:** render only your own hand in full; opponents are counts. (Practice is fully local/single-hand, so this is naturally satisfied; the settings gear added to online games renders nothing about opponent hands.)
3. **No optimistic board mutation** in online mode. The settings overlay is read-only chrome and does not stage/mutate board state.
4. Keep the pending/reconcile/cover/reclaim/veto affordances intact.
5. **Rules can never contradict the source of truth** — see §3.

**Coordination with the parallel redesign:**

- Shared-file touch points (`main.tsx`, `Home.tsx`, `TopBar.tsx`, `Game.tsx`, `OnlineGame.tsx`) are kept minimal and additive.
- Everything else is **new files**.
- When the redesign branch lands, rebase `how-to-play` onto it so the two Home buttons and the gear slot into the new chrome. (Noted, not a blocker.)

---

## 3. Shared foundation — one canonical rules-content module

**`src/rules/content.tsx`** — the single, player-facing source of rules text, transcribed faithfully from the ground truth and never contradicting it:

- Sources: `ref/iota_rules.txt` (authoritative), `ref/viota_first_order_principles.rtf` (enforceable spec), plus Vijay's rulings from the handoff §7 (wild-starter reshuffle; pass = bottom-first, player-chosen order; stalemate = 3 all-pass rounds; ties → optional agreed sudden-death; wild recycle is flexible / multiple per turn allowed).
- Exports structured content (an array of sections: `{ id, title, body, optional demo ref }`) plus a **condensed subset** flagged for the quick-reference.
- **Both** the full How-to-Play (§4) **and** the in-game quick-ref (§5) render from this one module, so they cannot drift from each other. Subtle rules (wild consistency across lines, the scoring multiplier stack: ×2 per lot → ×2 for all-four → ×2 game-ending) are worded to match actual engine behavior (`scorer.ts`, `lineValidator.ts`).
- Rendering uses the existing `Card` component for real card graphics in examples (e.g. showing an all-same vs all-different line).

This module is the guardrail for "nothing we have as rules can contradict the actual original rules."

---

## 4. Feature 1 — How to Play (hybrid overlay)

**`src/components/HowToPlay.tsx`** — a full-screen **overlay** component (not a route).

- **Why an overlay, not a route:** it's the cleanest match for "standalone + doesn't persist if someone quits it." It mounts on open and unmounts on close, adds **no** route-history entry, saves **no** progress, and its interactive-demo state resets every open. It's openable from **Home** and from the **in-game gear** — and being an overlay, opening it mid-game never unmounts/loses the active game (a route navigation would).
- **Structure:** a scrollable column of illustrated sections rendered from §3: Object → What is a *line* (real `Card` graphics: same vs all-different for each property) → *Lots* & the doubling → Scoring (the rulebook's Turn 1–4 worked example) → Wilds & recycle → Pass/trade → How the game ends. A close (✕) button; also closes on backdrop click + ESC (a small, self-contained improvement over the current explicit-button-only modals; scoped to this component).
- **2–3 inline interactive demos** using the shared static mini-board (§6.5), e.g.:
  - "Tap the card that completes this line" → validates live and explains why.
  - "Complete this *lot*" → shows the ×2.
  - (optional) "Place this wild so both lines stay legal."
  - Demos are self-contained, use only local component state, and reset on close.

**Dismiss/persistence:** no `localStorage`, no "seen the tutorial" flag, no gating. Purely transient.

---

## 5. Feature 2 — In-game settings menu (the gear)

**`src/components/SettingsMenu.tsx`** — a small overlay opened by a **⚙ gear** appended to `TopBar`'s right-side icon cluster (its natural home, matching the existing icon-button style). Available in both local and online games.

**Contents:**

- **Rules quick-reference** — the condensed cheat-sheet from §3 (line rule, scoring/lots, wild + recycle, pass/trade), rendered inline.
- **"Full How to Play"** — opens the §4 overlay (as an overlay, so the game stays mounted underneath).
- **"Auto-highlight legal moves" toggle** — ON by default (= current behavior, `computeValidPositions`); OFF lets the player find placements themselves. Straight from `ref/improvements.txt`. Stored in a small UI-preferences slice (see §7); it gates whether `validPositions` highlighting renders. This is a *display* toggle only — it never changes legality (the engine still validates on confirm).
- **"New game"** — **local only** (calls `startGame` again); hidden in online (a scored restart would need backend).
- **"Quit to menu"** — navigates to `/`. In **online** this is **leave, not a scored resign** (the backend already handles the resulting disconnect → AI-takeover per host patience); a true concede would require a new protocol action, which is out of scope.

**Dropped for now:** a **sound/animation toggle** — there is no sound or animation system in the app yet, so there is nothing to toggle. Adding one is a separate feature. (If Vijay wants it, it becomes its own small track.)

**Wiring:** `TopBar` gets one new optional prop `onOpenSettings?: () => void` and renders the gear when present. `Game.tsx` and `OnlineGame.tsx` each hold a `settingsOpen` boolean and render `<SettingsMenu>`; local passes the `onNewGame` handler, online omits it.

---

## 6. Feature 3 — Practice mode

Route **`/practice`** (added to `main.tsx`), reached from a Home button. Two screens inside one page component: a **puzzle list** and a **puzzle player**. All state is **local to practice** (its own store/`useState`) — it never touches the global game store, so it can't clobber a local/online game.

### 6.1 Puzzle data model — `src/practice/puzzles.ts`

```ts
import type { Card, Placement, Position, RegularCard } from '@viota/engine'

type PuzzleMode = 'top-score' | 'concept'

type AcceptedMove =
  | { action: 'play'; placements: Placement[] }                 // matched by set-equality of (card value, position)
  | { action: 'recycle'; wildPosition: Position; replacement: RegularCard; then?: Placement[] }
  | { action: 'pass' }                                          // "the best move here is to pass/trade"

type Puzzle = {
  id: string
  title: string
  concept: string                         // teaching label, e.g. "Complete a lot"
  mode: PuzzleMode
  instruction: string                     // states the goal AND whether it's top-score or concept
  position: {
    grid: [string, Card][]                // serialized board (rebuild with new Map(grid))
    hand: Card[]                          // the fixed hand (player = seat 0)
  }
  accepted?: AcceptedMove[]               // required for concept mode; optional annotation for top-score
  explanation: string                     // shown after solving/reveal — WHY this is the best move
}

export const PUZZLES: Puzzle[]
```

`position` is a hand-built `GameState`-shaped board (the engine accepts arbitrary states; no shuffle/deal needed). `drawPile` is treated as empty for grading unless a puzzle explicitly needs the game-ending ×2, in which case that condition is encoded in the expected score.

### 6.2 Grading engine — `src/practice/solver.ts`

Built entirely on the engine's **exported** `validatePlay(grid, placements)` and `score(grid, newPositions, opts)`:

```ts
type ScoredPlay = { placements: Placement[]; total: number }

// Bounded enumerator: all legal PLAY moves of 1–4 cards from `hand` on `grid`
// (single row/col, contiguous, adjacency-connected). Wilds are placed as-is;
// validatePlay/score handle their semantics.
enumerateLegalPlays(grid: Grid, hand: Card[]): ScoredPlay[]

// Highest-scoring legal play(s); empty if none legal.
bestPlays(grid: Grid, hand: Card[]): ScoredPlay[]      // all tied at the max

// Grade a user's performed action.
gradePlay(puzzle, userMove): {
  solved: boolean
  userScore: number | null
  bestScore: number
  best: ScoredPlay[]        // for the "reveal" affordance
}
```

- **Why a custom enumerator:** the engine's AI enumerates only *single-card* plays, so it cannot find lot-completing / multi-card optima. This enumerator covers 1–4 card plays. The search space is tiny (hand ≤ 4, small boards, frontier cells only), so a bounded brute force is fine.
- **Correctness guard:** unit tests compare `enumerateLegalPlays` against an independent exhaustive brute force on tiny boards, and the puzzle self-check (§6.6) asserts every authored answer is legal and (for top-score) optimal.

**Grading semantics:**

- **top-score:** `solved` iff the user's play total equals `bestScore` (ties count). Feedback shows *your score vs best*, with **Retry / Reveal best / Next**.
- **concept:** `solved` iff the user's performed action matches one of `accepted` (placements compared order-insensitively by card value + position; recycle/pass matched on action + params). Feedback + the `explanation`.

**Scope note (v1):** the play-enumerator does not search pre-move wild *recycles* or passes as "best moves." Recycle- and pass-focused teaching are handled as **concept** puzzles with explicit `accepted` moves. Top-score puzzles are pure play optimization.

### 6.3 Curated puzzle set (initial arc, authored + verified during implementation)

Concept ladder, easy → hard (final positions/wording set in implementation, each verified by §6.6):

1. **Open a line** — any two cards form a line (concept).
2. **All-same line** — extend keeping a property constant (concept).
3. **All-different line** — extend with all-different (concept).
4. **Extend both ends** — place at both ends of a segment (concept).
5. **Make a second line** — one play that also creates/extends a crossing line; card counted twice (top-score).
6. **Complete a lot** — 4-card line, ×2 (top-score).
7. **Play all four** — empty your hand this turn for the ×2 (top-score).
8. **Recycle a wild** — swap a board wild for a matching hand card, then use it (concept).
9. **Wild across two lines** — place a wild that must mean the same card in both lines (concept).
10. **When to pass** — no worthwhile legal play; the right move is pass/trade (concept).
11. **Single vs multi-card** — a multi-card play beats the obvious single (top-score).
12. **Double-lot** — advanced: two lots + all-four stacking multipliers (top-score).

### 6.4 Practice UI flow — `src/pages/Practice.tsx`

- **List screen:** puzzles grouped by concept; each row shows title + a solved ✓ (in-memory for the session only — nothing persisted).
- **Player screen:** the fixed board (§6.5) + the fixed hand (reusing `Hand`) + the `instruction`. The player selects a card and places it (staging with live legal-cell highlight via `computeValidPositions` and a live score preview via `computePreviewScore`, respecting the auto-highlight preference from §5). Buttons: **Check**, **Reset**, **Reveal best**, **Next**.
  - For **concept** puzzles whose answer is a **pass** or **recycle**, the player screen also shows a **Pass** button and a **Recycle** affordance on board wilds (minimal practice-local versions of the game's interactions). *This is the scope-heaviest UI; if we phase, ship play-only puzzles first and add pass/recycle-answer puzzles second.*
- **Feedback:** solved → success state + `explanation` + Next; suboptimal (top-score) → your-vs-best + Retry/Reveal; wrong (concept) → nudge + Retry/Reveal.

### 6.5 Static board — `src/components/StaticBoard.tsx` (the chosen fork = A)

A **dedicated, prop-driven** board built from the existing `Cell` primitive with its own local staging state — **not** a refactor of the shared `Board`.

```ts
type StaticBoardProps = {
  grid: Grid
  staged: Placement[]
  validPositions: Position[]
  onPlace: (pos: Position) => void
  onUnstage: (pos: Position) => void
  recycleTarget?: Position | null
  onRecycle?: (pos: Position) => void
}
```

- Lays out `Cell`s absolutely on a fixed, auto-sized grid (small puzzles → no pan/zoom/rotate needed).
- **Why (A), not refactoring `Board`:** the parallel redesign will be rewriting `Board`; a shared refactor would collide with it and adds regression surface to a game-critical component. A separate small board stays out of the redesign's way and is fully isolated. It's also reused by the How-to-Play demos (§4). Trade-off accepted: a second, simpler board implementation, which the redesign can later fold in if desired.

### 6.6 Self-verifying puzzle test — `src/practice/puzzles.test.ts`

Loads every `Puzzle` and asserts, via `solver`/`validatePlay`:

- Every `accepted` move is **legal** on the puzzle's board.
- For **top-score** puzzles: the authored best equals `bestPlays(...)` max (a mis-authored "best" fails CI, never the player).
- For **concept** puzzles: at least one `accepted` move exists and is legal.

---

## 7. File-by-file change map

**New files (no merge risk with redesign):**

- `src/rules/content.tsx` — canonical rules content (§3).
- `src/components/HowToPlay.tsx` — how-to-play overlay (§4).
- `src/components/SettingsMenu.tsx` — settings overlay (§5).
- `src/components/StaticBoard.tsx` — practice/demo board (§6.5).
- `src/pages/Practice.tsx` — practice route: list + player (§6.4).
- `src/practice/puzzles.ts` — curated puzzle data (§6.1, §6.3).
- `src/practice/solver.ts` — enumerator + grading (§6.2).
- Tests: `HowToPlay.test.tsx`, `SettingsMenu.test.tsx`, `StaticBoard.test.tsx`, `Practice.test.tsx`, `practice/solver.test.ts`, `practice/puzzles.test.ts`.
- Optionally a tiny `src/ui/prefs.ts` (or a slice) for the auto-highlight toggle.

**Surgical edits to shared files (the merge-coordination points):**

- `src/main.tsx` — add `<Route path="/practice" element={<Practice/>} />`.
- `src/pages/Home.tsx` — add "How to Play" (opens overlay) + "Practice" (navigates) buttons; hold `howToPlayOpen` state.
- `src/components/TopBar.tsx` — add optional `onOpenSettings?: () => void` prop + a ⚙ button in the right cluster.
- `src/pages/Game.tsx` — hold `settingsOpen`; render `<SettingsMenu>` (with `onNewGame`); pass `onOpenSettings` to `TopBar`; render `<HowToPlay>` when launched from settings; apply the auto-highlight preference.
- `src/pages/OnlineGame.tsx` — same settings wiring, minus `onNewGame`.

---

## 8. Testing & non-regression

- **Keep all existing tests green** (524 across the monorepo; ~180 client). Restyling/adding must not weaken them.
- **New unit tests:** `solver` (incl. brute-force cross-check on tiny boards), `puzzles` self-check, and component tests for the three new UI pieces + `StaticBoard`.
- **Manual verification:** run `pnpm --filter @viota/client dev`, walk How-to-Play (incl. demos), the gear in both a local and an online game, and several practice puzzles (top-score + concept), then use `/verify` on the client.
- **No engine/worker/protocol changes**, so no backend test surface is affected.

---

## 9. Out of scope / deferred

- The full visual redesign (separate parallel track) — this work ships placeholder styling to be re-skinned.
- A sound/animation system (and thus a sound toggle).
- Procedural puzzle generation (curated set only for v1).
- Any backend/protocol change, including a scored online concede.
- Persisting practice progress across sessions (session-only ✓ is enough for v1).

---

## 10. Decisions locked

- **How to Play:** hybrid (illustrated + interactive demos), delivered as an ephemeral overlay.
- **Settings gear:** small menu = rules quick-ref + full-how-to-play link + auto-highlight toggle + (local) New game + Quit-to-menu; **no** sound toggle; online quit = leave, not resign.
- **Practice source:** curated, hand-authored set.
- **Practice grading:** supports **both** `top-score` and `concept` puzzles; the instruction states which.
- **Board fork:** (A) dedicated `StaticBoard`, not a refactor of the shared `Board`.
