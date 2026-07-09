# viota — How-to-Play, In-Game Settings, and Practice Mode — Design (v2, council-hardened)

- **Date:** 2026-07-08
- **Branch:** `how-to-play` (off `online-multiplayer`, byte-identical to `main`/prod at `7601e9a`)
- **Status:** design for build. v2 folds in an adversarial council review (47 findings; the correctness/clarity fixes are integrated below and marked `[council]`).

---

## 1. Context & goals

viota is a browser implementation of Iota. Engine + backend are certified and live; a **visual redesign is in flight on a parallel branch**. This branch adds three *additive* player-facing features:

1. **How to Play** — a standalone, ephemeral teaching screen (hybrid: illustrated rules + a few interactive demos).
2. **In-game settings menu** — a gear whose centerpiece is a rules quick-reference.
3. **Practice mode** — curated small board situations with a fixed hand; find the best move. Supports **top-score** and **concept** puzzles; the instruction says which.

These also satisfy two items on `ref/improvements.txt` ("a tutorial section", "what are my potential next move(s)/best moves").

**Design principle (given the parallel redesign):** optimize for **durable structure + logic, not pixels**. The lasting deliverables — the canonical rules content, the solver/grader, the puzzle data, the tests — carry zero rework. UI shells use placeholder styling (current palette) so they're testable now and re-skinned uniformly by the redesign. Shared files are touched minimally (§7).

---

## 2. Hard constraints & coordination

**Must not break:**
1. **UI only.** Do not modify `packages/engine` or `packages/worker`; do not change the `net/` protocol or the online semantics of `store/gameStore.ts`. New logic lives in the client, built on the engine's **exported** functions.
2. **Redaction:** render only your own hand in full. (Practice is single-hand/local; the gear renders no opponent info.)
3. **No optimistic board mutation** online. The settings overlay is read-only chrome.
4. Keep pending/reconcile/cover/reclaim/veto affordances intact.
5. **Rules never contradict the source of truth** — §3.

**Standing guardrail — flag rules↔engine discrepancies.** Every rule statement in the content (§3) and every puzzle (§6) is cross-checked against engine behavior (`playValidator.ts`, `scorer.ts`, `lineValidator.ts`, `wildRecycle.ts`, `gameLoop.ts`); divergences are surfaced to Vijay, not silently reconciled. Already found:
- **Stalemate (3 all-pass rounds)** and **ties/sudden-death** are **house-rule additions** (not in the rulebook). Labeled as such.
- **Wild-starter reshuffle** — rulebook silent; engine deals a non-wild starter, matching the ruling. Documented as a clarification.
- **Scoring wording** `[council]`: the "×2 for 4 cards" bonus fires on **playing exactly 4 cards**, *not* on "emptying your hand". The **game-ending ×2** (draw pile empty **and** you play your last card) is a *separate* rule. Content must not conflate them.
- **Lots compound** `[council]`: *n* lots in a turn multiply by **2ⁿ** (2 lots = ×4), not "+×2 each".
- **`ref/iota_rules.txt` Turn-4 example typo** — coord `(2,1)` appears twice (should be `(3,1)`); not propagated; worked examples are verified against the real `scorer` (see §6.6).

**Coordination with the redesign:**
- Shared touch-points (§7) are minimal + additive. Everything else is new files.
- **Do NOT edit `Board.tsx`/`Cell.tsx`** in this branch — the redesign is rewriting them. (This is why the in-game auto-highlight toggle is deferred — §5.)
- **Entry-point placement is provisional.** Home buttons + gear are wired functionally now; exact placement/styling is finalized on rebase onto the redesign's chrome.

---

## 3. Shared foundation — one canonical rules-content module

**`src/rules/content.tsx`** — the single player-facing rules source, transcribed faithfully from `ref/iota_rules.txt` + `viota_first_order_principles.rtf` + Vijay's rulings (pass = bottom-first player-chosen order; stalemate = 3 all-pass rounds [house rule]; ties → optional agreed sudden-death [house rule]; wild recycle flexible; wild-starter reshuffle [clarification]).

- Exports structured sections `{ id, title, body, demo? }` plus a **condensed subset** flagged for the quick-reference. Both the full How-to-Play (§4) and the in-game quick-ref (§5) render from this one module, so the two surfaces can't drift from each other.
- Uses the `Card` component for real card graphics in examples.
- **Corrected content** `[council]`: scoring is stated as — *base* = sum of face values of every card in each affected line (a shared card counts once per line; wilds = 0); then **×2 per lot (compounding: 2 lots = ×4)**, **×2 if you play 4 cards this turn**, **×2 if this turn ends the game** (pile empty + last card). Explicitly separates the 4-card bonus from the game-ending bonus.
- **Honesty note** `[council]`: this module guarantees the two *views* share one text; it does **not** by itself prove the prose matches the engine. §6.6 adds the one cheap prose→engine pin: a fixture of the rulebook's Turn 1–4 worked example asserting `score()` reproduces **6, 6, 34, 208** (using engine-verified, typo-corrected coordinates).

---

## 4. Feature 1 — How to Play (hybrid overlay)

**`src/components/HowToPlay.tsx`** — a full-screen **overlay** (not a route). Best match for "standalone + doesn't persist when quit": mounts on open, unmounts on close, no route history, no saved progress, demo state resets each open. Openable from **Home** and the **in-game gear** (as an overlay, so opening it mid-game never unmounts the active game).

- **Sections** (from §3, illustrated with `Card` graphics): Object → What is a *line* (per-property "all same OR all different", incl. a **mixed** example) → *Lots* & compounding doubles → Scoring (Turn 1–4 worked example) → Wilds & recycle → Pass/trade → How the game ends (+ the house-rule stalemate/ties, clearly labeled).
- **2–3 interactive demos** using the shared `StaticBoard` (§6.5): "tap the card that completes this line" (validates live); "complete this lot" (shows the ×2). Self-contained; reset on close.
- **Dismiss:** ✕ button, backdrop click, and ESC — via the shared overlay wrapper (§7). No `localStorage`, no "seen it" flag.

---

## 5. Feature 2 — In-game settings menu (the gear)

**`src/components/SettingsMenu.tsx`** — a small overlay opened by a **⚙ gear** appended to `TopBar`'s right-side icon cluster (with an `aria-label`). Available in local and online games. Contents:

- **Rules quick-reference** — the condensed cheat-sheet from §3 (line rule, scoring/lots, wild, pass/trade). This is the centerpiece and the literal ask.
- **"Full How to Play"** — opens the §4 overlay.
- **"New game"** — **local only** (`startGame` again); hidden online.
- **"Quit to menu"** — both modes. **Local:** navigate `/`. **Online (leave, not resign)** `[council]`: a **pause** — navigate `/` and let the existing unmount cleanup close the socket; **keep the session** so the game stays resumable (backend AI-covers per host patience). It must reuse the existing session handling and **not** create a duplicate/stuck resumable session (verify against `OnlineGame` `handleLeave`/`clearSession`).

**Cut from this branch (deferred, with reasons):**
- **Sound/animation toggle** — no sound/animation system exists yet.
- **Auto-highlight-legal-moves toggle** `[council]` — deferred to the **redesign**. It can't be built without editing `Board.tsx`/`Cell.tsx` (redesign-owned; gating it in `gameStore.selectCard` is forbidden by §2.1), and turning highlights OFF removes the *only* placement affordance (the green "valid" cell), making the board unplayable rather than un-hinted. It belongs with the redesign that owns `Board`.
- **Resign** `[council]` — cut; **done next** as its own scope. It's not trivial (halting the async AI worker loop so an in-flight response can't un-resign; adding a winner/`resigned` representation the local game-over screen lacks; handling `recordGhostGame`; multi-AI winner rule). It pairs with the queued **online resign** backend feature and a local game-over winner banner (which also closes `improvements.txt`'s "tell you you won").

The overlay uses the shared overlay wrapper (§7): ESC/backdrop close, focus trap + restore, `role="dialog"`/`aria-modal`.

---

## 6. Feature 3 — Practice mode

Route **`/practice`** (added to `main.tsx`), from a Home button. Two screens in one page: a **puzzle list** and a **puzzle player**. **All state is practice-local** (its own store/`useState`) — it never touches the global game store, so it can't clobber a local/online game. `[council]` Practice imports only the **pure** helpers from `../gameLogic` (`computeValidPositions`, `computePreviewScore`) and the engine's exported functions — never `useGameStore`.

### 6.1 Puzzle data model — `src/practice/puzzles.ts`

```ts
import type { Card, Placement, Position, RegularCard } from '@viota/engine'

type PuzzleMode = 'top-score' | 'concept'

type AcceptedMove =
  // matched by FULL CARD IDENTITY (color+shape+number, or wild) + position — NOT face value [council]
  | { action: 'play'; placements: Placement[] }
  | { action: 'pass' }            // v1: only for FORCED-pass puzzles (board has no legal play)

type Puzzle = {
  id: string
  title: string
  concept: string                 // teaching label
  mode: PuzzleMode
  instruction: string             // states the goal AND whether top-score or concept
  position: {
    grid: [string, Card][]        // rebuild with new Map(grid); MUST be a legal Iota position (§6.6)
    hand: Card[]                  // the fixed hand (player = seat 0)
  }
  // top-score: optional annotation; source of truth is the solver's computed max.
  // concept (play): the winning move must satisfy `conceptCheck` (predicate) — see §6.4.
  accepted?: AcceptedMove[]        // required for forced-pass; optional elsewhere
  conceptCheck?: string            // id of the predicate a concept-play answer must satisfy (§6.4)
  explanation: string              // shown after solving/reveal — WHY
}

export const PUZZLES: Puzzle[]
```

- `position` is a hand-built board. `[council]` v1 puzzles are scored with the draw pile treated **non-terminal** — i.e. **no game-ending ×2** (removes a class of preview/grade inconsistency). The 4-card ×2 and lot ×2 *are* in scope (they don't need game state).
- `[council]` Practice threads the puzzle's **exact card object references** into its selection/staging state (or selects by hand index) so `Hand`'s reference-identity selection works; it must not deep-clone hand cards. Duplicate wilds are two distinct `{kind:'wild'}` objects.

### 6.2 Grading engine — `src/practice/solver.ts`

Built on the engine's exported `validatePlay(grid, placements)` and `score(grid, newPositions, opts)`.

```ts
type ScoredPlay = { placements: Placement[]; total: number }

enumerateLegalPlays(grid: Grid, hand: Card[]): ScoredPlay[]   // ALL legal 1–4 card plays
bestPlays(grid: Grid, hand: Card[]): ScoredPlay[]             // all tied at the max, deduped
gradePlay(puzzle, userMove): { solved: boolean; userScore: number | null; bestScore: number; best: ScoredPlay[] }
```

**Complete enumeration** `[council]` (the previous "frontier cells only" was incomplete — it misses multi-card far-extensions off a single anchor, e.g. completing a lot by playing 3 cells out):
- Search **incrementally**, mirroring live staging: at each step the candidate cells are the frontier of `grid ∪ already-chosen placements` (empty cells orthogonally adjacent to any occupied-or-staged cell) that keep the play **collinear** (one shared row/col) and the touched axis segment **gap-free, length ≤4**. Because the frontier is recomputed against `grid ∪ staged`, a card placed at `(1,0)` makes `(2,0)` a candidate next — so far-extensions are reachable. (This generalizes `computeValidPositions`, which already expands from `grid + staged`.)
- **Try every card→position assignment** (legality is assignment-dependent). **Enumerate wilds identically at every candidate cell — no value-based pruning** `[council]` (a wild scores 0 but can complete a lot whose regular neighbors carry the value).
- Score each *complete legal* play with `score(tentativeGrid, positions, { cardsPlayedThisTurn: placements.length })`. `gameEnding` is **not** applied (v1 non-terminal).
- **Dedup** `bestPlays`/reveal by the set of `(posKey, card-identity)`.

**Grading semantics:**
- **top-score:** `solved` iff the user's play total equals `bestScore` (ties count). Feedback: your score vs best; **Retry / Reveal best / Next**.
- **concept (play):** `solved` iff `validatePlay` passes **and** the resulting board satisfies the puzzle's `conceptCheck` predicate `[council]` (grade by *predicate over the result*, not an enumerated whitelist — otherwise valid unlisted moves on the easy puzzles false-negative). Reserve exact-match `accepted` for genuinely unique-answer concepts.
- **concept (forced pass):** `solved` iff the user chooses Pass; valid only when `bestPlays` is **empty** (enforced by §6.6). `[council]`
- `[council]` **Reveal in concept mode** shows the taught answer + `explanation`, **not** the play-solver's best (which would undercut a "pass/consistency" lesson). Only top-score exposes "Reveal best".

### 6.3 Curated puzzle arc (v1 — play-answer + forced-pass; verified by §6.6)

1. **Open a line** — any two cards form a line (concept).
2. **All-same line** — hold a property constant (concept).
3. **All-different line** — all-different (concept).
4. **Mixed properties** `[council]` — same on one property, different on another (the #1 beginner confusion; highest teaching value) (concept).
5. **Extend both ends** — add at both ends of a segment (concept).
6. **Make a second line** — one play that also creates/extends a crossing line; card counted twice (top-score).
7. **Complete a lot** — 4-card line, ×2 (top-score).
8. **Play four cards** `[council reword]` — play 4 cards in one turn for the ×2 (top-score). *(Not "empty your hand" — see §2.)*
9. **Wild across two lines** — place a wild that must mean the same card in both lines (concept; placement puzzle, no recycle interaction).
10. **Forced pass** `[council reframe]` — the board admits **no legal play**; the rules-correct move is Pass (concept). *(Not "no worthwhile play" — pass is always legal, so a judgment-pass is unsound in a solo vacuum.)*
11. **Single vs multi-card** — a multi-card play beats the obvious single (top-score).
12. **Double-lot** — advanced: two lots stacking multipliers (top-score).

**Deferred to a phase 2 (NOT in the v1 list)** `[council]`: **Recycle-a-wild** puzzles (need the recycle interaction) and any **judgment-pass** puzzles (need opponent modeling). The list screen **must not surface** puzzles whose answer type isn't supported this phase.

### 6.4 Practice UI — `src/pages/Practice.tsx`

- **List screen:** puzzles grouped by concept; a session-only ✓ on solved (nothing persisted).
- **Player screen:** `StaticBoard` (§6.5) + the fixed hand (reusing `Hand`) + the `instruction`. The player selects a card and places it — staged with legal-cell highlight (`computeValidPositions`) and a live preview (`computePreviewScore`, faithful for v1 since no game-ending puzzles). Buttons: **Check**, **Reset**, **Next**, plus **Reveal best** (top-score only) and a **Pass** button (only on forced-pass puzzles).
- **Feedback:** top-score → your-vs-best + Retry/Reveal; concept → solved + `explanation`, or a nudge + Retry.
- **Predicates** live in `solver.ts` as named `conceptCheck` functions over `(grid, placements)` (e.g. `line-all-same-color`, `spans-both-ends`, `mixed-properties`, `wild-in-two-lines`).

### 6.5 Static board — `src/components/StaticBoard.tsx` (fork A)

A dedicated, prop-driven board from the existing `Cell` primitive with practice-local state.

```ts
type StaticBoardProps = {
  grid: Grid; staged: Placement[]; validPositions: Position[]
  onPlace: (pos: Position) => void; onUnstage: (pos: Position) => void
}
```

- `[council]` **Fork A is necessary, not just tidy:** `Board.tsx` is hard-coupled to `useGameStore` (grid/staged/validPositions/placeCard/… ; only a `ref` prop). Reusing it for store-isolated Practice would clobber a live game. `Cell`/`Hand` are pure and reused directly.
- `[council]` **Mobile fit:** scale-to-fit — compute a scale from container width vs board extent (and/or wrap in `overflow-x:auto`) so multi-line puzzles (#6/#9/#12) never clip on a ~360px phone. No pan/zoom needed.

### 6.6 Self-verifying puzzle test — `src/practice/puzzles.test.ts` + `solver.test.ts`

`[council]` — the self-check must test **ground truth**, not just internal consistency:

- **Board legality** (every authored puzzle): each maximal segment is a valid line; ≤2 wilds total; no duplicate regular cards; board connected/gap-free.
- **Independent oracle for top-score:** a *separate* exhaustive brute force with **no frontier heuristic** — all subsets (size 1–4) of hand cards over all collinear empty cells within the occupied bounding box ± legal reach, filtered by `validatePlay`, scored — must agree with `bestPlays()`'s max. Cross-checked on tiny boards **and** a **hardcoded far-extension-lot regression board** asserting `bestPlays` finds it (so an incomplete enumerator fails CI regardless of authoring).
- **Concept (play):** at least one legal move satisfies `conceptCheck`; and (where feasible) `conceptCheck` accepts every legal concept-satisfying move (no false negatives).
- **Forced pass:** `bestPlays(grid, hand)` is **empty**.
- **Prose→engine pin:** the rulebook Turn 1–4 worked example (typo-corrected) → `score()` yields 6, 6, 34, 208.

---

## 7. File-by-file change map

**New files (no merge risk):**
- `src/rules/content.tsx` — canonical rules (§3).
- `src/components/HowToPlay.tsx`, `src/components/SettingsMenu.tsx`, `src/components/StaticBoard.tsx`.
- `src/components/Overlay.tsx` `[council]` — a tiny shared overlay wrapper (fixed backdrop; ESC + backdrop close; focus trap + restore; `role="dialog"`/`aria-modal`) used by all three overlays.
- `src/pages/Practice.tsx`.
- `src/practice/puzzles.ts`, `src/practice/solver.ts`.
- `src/practice/oracle.ts` `[council]` — the independent brute-force oracle (test-only).
- `public/_redirects` `[council]` — `/* /index.html 200` so `/practice` (and existing routes) survive hard-refresh/deep-link on Cloudflare Pages.
- Tests: `HowToPlay.test.tsx`, `SettingsMenu.test.tsx`, `StaticBoard.test.tsx`, `Practice.test.tsx`, `Overlay.test.tsx`, `practice/solver.test.ts`, `practice/puzzles.test.ts`.

**Surgical edits to shared files (the merge-coordination points):**
- `src/main.tsx` — add `<Route path="/practice" element={<Practice/>} />`.
- `src/pages/Home.tsx` — add "How to Play" (opens overlay) + "Practice" (navigates) buttons; hold `howToPlayOpen`.
- `src/components/TopBar.tsx` — add optional `onOpenSettings?: () => void` + a ⚙ button (with `aria-label`) in the right cluster.
- `src/pages/Game.tsx` — hold `settingsOpen`; render `<SettingsMenu onNewGame=…>`; pass `onOpenSettings`; render `<HowToPlay>` when launched from settings.
- `src/pages/OnlineGame.tsx` — same settings wiring, minus `onNewGame`; Quit-to-menu = pause (§5).

**Explicitly NOT edited:** `Board.tsx`, `Cell.tsx`, `gameStore.ts` `[council]` (no resign, no auto-highlight gate this branch) — keeps the shared surface minimal and clear of the redesign's `Board` rewrite.

---

## 8. Testing & non-regression

- **Keep all existing tests green** (~524 monorepo / ~180 client); don't weaken them.
- **New tests:** solver (enumerator vs independent oracle + the regression board); puzzles self-check (§6.6); the three overlays + `StaticBoard` + `Overlay` wrapper; Practice flow (top-score grade, concept-predicate grade, forced-pass); **HowToPlay ephemerality** `[council]` (closing writes no storage; demo state resets on remount).
- **Mobile/a11y** `[council]`: overlays + practice player usable at phone widths (scrollable, wrapping card rows, tap targets ≥ ~44px); overlays keyboard-navigable (focus trap/restore, ESC).
- **Manual:** `pnpm --filter @viota/client dev` — walk How-to-Play + demos, the gear in a local and an online game, several practice puzzles; then `/verify`.
- **No engine/worker/protocol changes.**

---

## 9. Out of scope / deferred

- The full visual redesign (parallel track) — placeholder styling here.
- **Resign** (local + scored online) — **next scope**, with the game-over winner banner.
- **In-game auto-highlight toggle** — deferred to the redesign (owns `Board`).
- Sound/animation system.
- **Recycle-answer puzzles & judgment-pass puzzles** — phase 2 of Practice.
- Procedural puzzle generation; persisting practice progress across sessions.

---

## 10. Decisions locked

- **How to Play:** hybrid (illustrated + demos), ephemeral overlay, ESC/backdrop close via shared wrapper.
- **Settings gear:** rules quick-ref + full-how-to-play + Quit-to-menu (both modes) + (local) New game. **No** sound toggle, **no** auto-highlight toggle (redesign), **no** resign (next scope). Online quit = pause.
- **Practice:** curated set; **top-score** (complete solver + independent oracle) and **concept** (predicate-graded) + **forced-pass**; dedicated `StaticBoard` (fork A) with scale-to-fit; recycle/judgment-pass puzzles are phase 2.
- **Rules content:** one canonical module; corrected scoring wording (4-card vs game-ending; compounding lots); prose→engine pinned by the Turn 1–4 fixture; discrepancies flagged to Vijay.
- **Merge-safety:** new files + 5 surgical shared edits; `Board`/`Cell`/`gameStore` untouched; `_redirects` for SPA deep-links.
