# viota — How-to-Play / In-Game Settings / Practice — HANDOFF

> For the next agent (or Vijay) picking up this area. Everything you need: what
> shipped, how it works, what's deliberately deferred, and the decisions behind it.

## 0. TL;DR / status

- **DONE and MERGED to `main`** via **PR #1** (merge commit `02f91e5`, "Merge how-to-play (PR #1)"). The `how-to-play` branch is deleted. All tests green on `main`.
- Three player features shipped: **How to Play**, an **in-game Settings gear**, and **Practice mode**.
- `packages/engine` and `packages/worker` were **not touched** — all new logic is in `packages/client`, composing the engine's exported functions.
- Built while the "Neon-Night" front-end redesign was landing in parallel; **integrated into the redesign's seams** (did not ship parallel UI). `main` has since advanced well past this work (leaderboard, stats, account/identity, the identity code/data split of 2026-07-18) — those are unrelated; this handoff is only about how-to-play/settings/practice.
- **Deploy note:** Cloudflare Pages is **direct-upload** (a GitHub merge does NOT auto-deploy). Confirm whether a `wrangler pages deploy` has shipped these features to https://viota.pages.dev before assuming they're live for players.

## 1. Where everything lives (file map, all under `packages/client/src`)

**New, self-contained (durable — zero coupling to the redesign's churn):**
- `practice/types.ts` — `Puzzle`, `AcceptedMove`, `UserMove`, `ScoredPlay`, `GradeResult`, `ConceptCheckId`, `PuzzleMode`.
- `practice/solver.ts` — the grading brain: `enumerateLegalPlays`, `bestPlays`, `gradeUserMove`, `CONCEPT_CHECKS`, `cardIdentity`, `playKey`.
- `practice/oracle.ts` — an **independent** brute-force optimum (`bruteForceBest`), test-only, cross-checks the solver.
- `practice/puzzles.ts` — the 12 curated puzzles (`PUZZLES`).
- `practice/puzzles.test.ts` — the **self-verifying** data gate.
- `practice/solver.test.ts` — solver + concept-check + grader + oracle-cross-check tests.
- `rules/content.tsx` — the **one canonical** rules module (`RULES_SECTIONS`, `QUICK_REF`).
- `rules/content.test.ts` — pins the prose to the engine (rulebook Turn 1–4 → `6/6/34/208`).
- `components/StaticBoard.tsx` — a store-free, prop-driven board (built from `Cell`) for Practice + the how-to-play demo.
- `pages/Practice.tsx` — the `/practice` page (puzzle list + player).

**Integrated into the redesign chrome (touch points to be aware of on re-work):**
- `components/HowToPlayModal.tsx` — the redesign shipped this as a **placeholder seam** (`a418edf`, "seam for rules agent"); we **filled it** with the real rules screen + interactive demo, keeping its `{ open, onClose }` prop shape and using the redesign's `useModalDismiss` + `modal-card`/`modal-backdrop` + `Button` + fonts.
- `components/SettingsMenu.tsx` — the in-game settings modal (same modal idiom).
- `pages/Game.tsx` / `pages/OnlineGame.tsx` — render the gear + both modals (`open` prop).
- `components/TopBar.tsx` — optional `onOpenSettings?: () => void` → a `⚙` button.
- `pages/Home.tsx` + `main.tsx` — a `/practice` route (under the `Layout` chrome) + a "practice" nav link. **NOTE:** Home/main have been rewritten further since (leaderboard/stats/account nav) — the practice route + link survive there.
- `public/_redirects` — `/* /index.html 200` SPA fallback for deep-linking `/practice` on Pages.

**Design docs:**
- Spec: `docs/superpowers/specs/2026-07-08-how-to-play-settings-practice-design.md` (v2, council-hardened — read §5/§6/§10 for locked decisions).
- Plan: `docs/superpowers/plans/2026-07-08-how-to-play-settings-practice.md` (15 TDD tasks).

## 2. How it works (architecture)

**Rules content is single-source.** Both the full How-to-Play and the in-game quick-reference render from `rules/content.tsx`, so they can never drift from each other. The prose is faithful to `ref/iota_rules.txt` + `ref/viota_first_order_principles.rtf`, and the scoring section is worded to match the engine (see §3).

**Practice never touches the live game.** `Practice.tsx` uses only local `useState` and the **pure** helpers `computeValidPositions`/`computePreviewScore` from `gameLogic.ts` — it never imports `useGameStore`, so it cannot clobber a local or online game. Puzzle hands are threaded by **object reference** into `Hand` (do not clone them — `Hand` keys selection/staging on identity).

**The solver is the grading brain (`practice/solver.ts`).**
- `enumerateLegalPlays(grid, hand)` — a **complete** enumerator of all legal 1–4 card plays. It recurses an *incremental frontier* (candidate cells = empties adjacent to `grid ∪ already-staged`), so far/multi-card extensions, both-ends brackets, bridges, and wild placements are all reachable. Built entirely on the engine's `validatePlay` + `score`. (Why custom: the engine's AI only enumerates **single-card** plays — it cannot find lot-completing multi-card optima.)
- `bestPlays` = the tied-max plays, deduped by `(posKey, card-identity)`.
- `gradeUserMove(puzzle, move)` semantics: **top-score** solved iff `userScore === bestScore`; **concept** solved iff the move is legal AND satisfies the puzzle's `conceptCheck` predicate (grade by predicate over the *result*, not an enumerated whitelist — so valid unlisted moves aren't false-negatived); **forced-pass** solved iff the move is `pass`. Concept mode returns `best: []` — it never leaks the play-solver's best (which would undercut a "pass/consistency" lesson). "Reveal best" is top-score only.
- Each candidate is scored with `cardsPlayedThisTurn = placements.length` (for the 4-card ×2). v1 puzzles are scored **non-terminal** (no game-ending ×2) — this was a deliberate choice to keep the live preview, the grade, and the explanation all consistent.

**The oracle is a real, independent gate (`practice/oracle.ts`).** `bruteForceBest` enumerates subsets×positions over a line-restricted window with **no** frontier heuristic — a genuinely different implementation, so solver=oracle agreement is meaningful (an early review caught the oracle missing perpendicular touch-then-extend plays; fixed in `979aa60`).

**`puzzles.test.ts` gates the data**, not just the code: board legality (≤2 wilds, no duplicate regulars, every all-regular maximal segment is a valid line), top-score `bestPlays max === bruteForceBest`, concept "some legal play satisfies the predicate" (checked over **all** legal plays via `enumerateLegalPlays`), forced-pass "`bestPlays` is empty." A mis-authored puzzle fails CI, not the player.

**Forced-pass construction** (if you add more): a fully-filled, globally-legal **4×4** grid has no legal play (every empty frontier cell would extend an already-length-4 line to length 5). Recipe: `colors=[blue,red,yellow,green]`, `shapes=[triangle,plus,square,circle]`, `cell(x,y) = { color: colors[(x+y)%4], shape: shapes[(x+y)%4], number: y+1 }` for x,y in 0..3, plus any hand of 4 cards not on the board.

## 3. Rules ground truth + discrepancy flags (the "never contradict the source" guardrail)

Ground truth: `ref/iota_rules.txt`, `ref/viota_first_order_principles.rtf`, `ref/7f-iota-rulebook.pdf`. Flags surfaced during this work (keep them in mind if you touch the rules content):
- **Stalemate (3 all-pass rounds)** and **ties / optional sudden-death** are viota **house-rule *additions*** — not in the original rulebook. The content labels them as such.
- **Wild-starter reshuffle** — the rulebook is silent; the engine deals a non-wild starter, matching Vijay's ruling. Documented as a clarification.
- **Scoring wording is engine-exact:** the ×2 fires on **playing exactly 4 cards**, NOT on "emptying your hand"; the **game-ending ×2** (draw pile empty AND you play your last card) is a *separate* rule. Lots **compound** (n lots → ×2ⁿ; 2 lots = ×4). A card shared by two lines counts once *per line*; wilds are worth 0.
- **Source-doc typo:** `ref/iota_rules.txt`'s Turn-4 worked example lists coordinate `(2,1)` twice (the second should be `(3,1)`). Not propagated — `rules/content.test.ts` reconstructs the example with corrected coords and asserts the engine reproduces `6 / 6 / 34 / 208`.

## 4. DEFERRED / OPEN WORK — read this before starting anything new here

These were consciously scoped OUT of PR #1 (decisions already made with Vijay). None are started yet (verified: no `resign`, no auto-highlight toggle anywhere in the tree).

### 4a. Local resign — "next" (Vijay: "cut it from this scope, we'll do resign next")
Not trivial. It is a real mini-feature, not a toggle:
- **Halt the AI worker loop** — a resign that only sets `phase:'game-over'` gets silently un-resigned by an in-flight `handleWorkerMessage` / the self-reposting `setTimeout` in `gameStore.ts`. Needs a phase/epoch guard + clearing pending timers.
- **Represent the winner** — the local game-over screen currently declares *no* winner (it just lists scores), and both the ghost-stats winner and any label derive from `scores.indexOf(max)`. So a resign while *ahead* would show/record **you** as the winner. Add a `resigned`/winner field. This also closes `ref/improvements.txt`'s "game over should tell you you won" — add a proper **winner banner** to the local game-over regardless.
- **Ghost stats** — `recordGhostGame` fires on any `game-over` transition; a resign must be skipped or recorded as a loss.
- **Multi-AI ruling** — with 2–3 AI opponents, define who "wins" (e.g. highest-scoring AI).

### 4b. Scored ONLINE resign — separate certified-backend feature (needs a Vijay ruling)
A real online resign is NOT a client change: new Durable-Object protocol action (idempotent, redaction-safe), interacting with the trickiest existing subsystem (AI-takeover / reclaim / veto — a resigned seat must not be AI-covered or reclaimable), plus a lockstep client+worker deploy. **Open ruling needed:** in a 3–4 player game, does one player resigning *end the game* (highest current score wins) or *drop the seat* and let the rest play on? Give it its own brainstorm→spec→plan→certify→deploy pass. (Today's in-game "Quit to menu" online is a **pause** — navigate home, keep the resumable session; it is NOT a resign.)

### 4c. In-game "auto-highlight legal moves" toggle — deferred to the redesign
From `ref/improvements.txt`. Cut because (1) it requires editing `Board.tsx`, which the redesign owns/rewrites (merge-conflict magnet), and (2) turning highlights OFF removes the *only* placement affordance (the highlighted green cell) → the board becomes unplayable, not just un-hinted. Whoever rebuilds `Board` should add it there, with an OFF-mode placement path (tappable empty cells).

### 4d. Practice phase-2 (explicitly out of the v1 arc)
- **Recycle-answer puzzles** (e.g. "recycle the wild, then play the lot") — need a practice-local recycle interaction (`AcceptedMove` already has a `recycle` shape in the design, but the v1 `UserMove`/UI only support play + forced-pass).
- **Judgment-pass puzzles** ("passing is *better* even though a play exists") — need opponent modeling that a solo puzzle lacks. v1 only ships **forced**-pass (no legal play at all).
- **Procedural puzzle generation** and **persisting practice progress across sessions** (v1 solved-✓ is in-memory only).
- **Mixed-property teaching puzzle** — v1 includes one (`mixed-properties` concept). If you expand the arc, that's the highest-value beginner concept (each property independently all-same/all-different).

### 4e. Non-blocking follow-ups (logged by the final review)
- `hooks/useModalDismiss` re-runs its effect (re-focuses first focusable) on every parent re-render while open — pre-existing **redesign infra**, not this work. A `useCallback`/deps fix would tidy it.
- `StaticBoard` computes `Math.min(...[])` → `Infinity` on a fully-empty board (unreachable — puzzles/demos always seed a card). One-line guard if you care.
- The Practice page shipped with a **light** theme pass to the redesign tokens (Button, chamfer, cyan, Luckiest Guy headings), not a full visual design. Fine to re-skin when the redesign reaches gameplay surfaces.

## 5. Run / test / build

```bash
pnpm install                                    # once
pnpm --filter @viota/client dev                 # local dev (Vite); talks to prod worker unless VITE_SERVER_URL set
pnpm --filter @viota/client test                # client tests (vitest) — the surface for this work
pnpm --filter @viota/client exec tsc --noEmit   # typecheck
pnpm --filter @viota/client build               # tsc + vite build (bakes VITE_SERVER_URL; ships public/_redirects)
```
- Deploy (client) is **manual, direct-upload** — see repo root `DEPLOY.md`. A GitHub merge does not deploy.
- Gotcha: `pnpm -r test` currently fails in `packages/engine` (`vitest: command not found` — that package's binary isn't linked in this environment). Not related to this work; run the client filter. Engine/worker are unchanged by this work anyway.

## 6. Key decisions log (why it's built this way)

- **Board fork A:** a dedicated store-free `StaticBoard` (not refactoring the shared `Board`). `Board` is hard-coupled to `useGameStore`; reusing it for isolated Practice would clobber a live game, and the redesign rewrites `Board`.
- **Solver in the client, not the engine:** the engine is off-limits and its AI is single-card-only; the multi-card enumerator + grading is a client concern built on exported engine primitives.
- **Predicate concept grading, not a whitelist:** open-ended concepts (any-line, all-same, etc.) have many correct answers; a whitelist would false-negative valid moves.
- **v1 puzzles non-terminal** (no game-ending ×2): removes a class of preview-vs-grade inconsistency; the 4-card ×2 and lot ×2 are still exercised (`play-four`, `double-lot`).
- **Integrate into the redesign's seams** rather than ship parallel UI: the redesign left `HowToPlayModal` + `useModalDismiss` explicitly as seams; matching them avoids a double-build and merge pain.

## 7. Pointers

- PR: https://github.com/theonenonlyvj/viota/pull/1 (merged as `02f91e5`).
- Merge/integration commit: `b19e13c` (integrate into the redesign chrome). Solver core: `92e9f7c..979aa60`.
- Redesign design system to reuse for any new UI here: `theme.css` (tokens/classes), `components/Button`, `hooks/useModalDismiss`, `.modal-backdrop`/`.modal-card`, `components/Layout`, fonts (Luckiest Guy title / Fredoka body via `@fontsource`).
- Repo memory / broader context: see the viota project memory and `docs/FRONTEND-REDESIGN-HANDOFF.md` / `docs/HANDOFF-START-HERE.md`.
