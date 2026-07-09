# viota — Lobby + Waiting-Room Redesign (spec)

**Date:** 2026-07-09
**Author:** Claude (front-end redesign, with Vijay)
**Scope:** Restyle the two "play with friends" chrome pages — **Lobby** (`/lobby` → `Lobby.tsx`)
and **Waiting Room** (`/lobby/:code` → `WaitingRoom.tsx`) — to the **Neon-Night** design system
established by the landing slice. This is **UI only**. The gameplay board is a separate later slice.

> Slice 2 of the front-end redesign. Slice 1 (landing + design system) is LIVE on main.
> Read `docs/FRONTEND-REDESIGN-HANDOFF.md` for the hard architecture rules and
> `docs/superpowers/specs/2026-07-08-viota-landing-redesign-design.md` for the design system.

---

## 0. Hard rules (unchanged)

- **UI only.** Do **not** touch `packages/engine`, `packages/worker`, the `net/` protocol/logic,
  `gameStore`, or `Card.tsx`. Restyle the components; never change what they call or the
  network contract. (handoff §8)
- **No optimistic mutation / redaction** concepts introduced (N/A here, never add).
- **Reuse the design system — add no new tokens.** Consume the tokens/classes from `theme.css`
  and the `Button` primitive. New CSS is allowed only as small **additive** classes in `theme.css`
  (e.g. an input field, a panel, a seat chip) — no new color/token values.

## 1. Direction

Apply the landing's **"Neon Night"** look to both pages. They already sit inside the chrome
`Layout` (aurora + footer + `.chrome-scroll`), so the aurora shows through — the job is to
restyle the *controls* on top of it to match the hero + modal.

**Reused primitives (already in `theme.css` / components):**
- `viota` wordmark — **Luckiest Guy**, lowercase, cyan "o" (matches the hero); the small brandmark form.
- `Button` component — chamfer-brutalist. `primary` (cyan) / `secondary` (coral). White labels.
- `.modal-pill` (+ `.modal-pill:focus-visible`) — the chamfer segmented-selector look, for the
  players-count and AI-takeover selectors.
- `.modal-card` — the chamfer mesh-tinted panel, as the base for the Create / Join panels and the
  waiting-room room card (or a small additive `.panel` variant if `.modal-card`'s fixed
  `max-width:380px` fights the two-panel layout — implementer's call; keep the look).
- Aurora (via `Layout`), text tokens (`--text-hi/body/muted`), Fredoka body.

**New additive CSS classes (in `theme.css`, no new tokens):**
- `.field` (+ `.field:focus-visible`) — the name / room-code text input: mesh-tinted, chamfer or
  gently-rounded, Fredoka, **a clip-surviving focus ring** (`box-shadow`, not the UA outline, since
  a chamfer clips it away — this was the landing slice's one merge-blocker; do not repeat it).
- `.panel` + `.panel__label` — a section card + its uppercase micro-label (if not reusing `.modal-card`).
- `.seat-row` — a roster chip in the waiting room (mesh-tinted, chamfer), with muted markers.
- `.ghost-btn` (+ `:focus-visible`) — the subtle "Back home" / "Leave" text button.

## 2. Lobby (`/lobby`) — two panels, friends-only

**Remove the solo "Play vs AI" button entirely** (Vijay's call: vs-AI belongs in the landing's
Play-vs-AI menu, not "play with friends"). Removing it also removes the `handleSolo` path and the
`createOnlineGame` import — the lobby becomes purely **create / join a room**.

Layout (centered column; two panels can stack on narrow screens, sit side-by-side ≥ ~720px):
```
                       viota                 (Luckiest Guy, cyan "o")
                 [ Your name______ ]         (.field, required)
                 (error, if any)

  ┌ CREATE A ROOM ─────────────────┐   ┌ JOIN A ROOM ───────────┐
  │ Players     2   ‹3›   4         │   │  [ R O O M   C O D E ] │   (.field, upper/spaced)
  │ If someone drops, AI covers:    │   │   [   Join room   ]    │   (Button secondary)
  │   30s ‹1m› 2m 5m   never        │   └────────────────────────┘
  │      [   Create room   ]        │   (Button primary)
  └─────────────────────────────────┘
                 (ResumeStrip — renders only when non-empty)
                      ← back home             (.ghost-btn → navigate('/'))
```

**Behavior preserved exactly (restyle only):**
- **Name** required for both actions (same `setError('Name is required')` guard).
- **Players** selector = **total seats 2 / 3 / 4** (default **2**). Maps to
  `createOnlineRoom({ playerCount })` (which clamps 2–4). This *renames* the old "Opponents 1/2/3"
  to "Players 2/3/4" — a display change only; the value passed to `createOnlineRoom` is the total
  seat count. (Internally the state may be `players` (2–4) instead of `opponents` (1–3).)
- **AI-takeover** selector = the existing 5 options (`30s / 1m / 2m / 5m / Wait for me`), default
  `1m` (60000). Label "Wait for me" may read as "never". Passes `aiTakeoverMs` to `createOnlineRoom`.
- **Create room** → `createOnlineRoom(...)` → `claimGhostGames` (fire-and-forget) → `saveSession` →
  `navigate('/lobby/:code')`. Unchanged.
- **Join room** → `joinOnlineGame({ code, displayName })` → `saveSession` → `navigate('/lobby/:code')`.
  Room-code input uppercases + trims as today; errors surfaced (unknown code / full room).
- **ResumeStrip** stays (already restyled).
- Error text uses a tokened error style (keep `--`-ish red; a small `.field-error` or inline is fine).
- Wrapper stays `minHeight: '100dvh'` (already set) so it scrolls in the chrome container.

## 3. Waiting Room (`/lobby/:code`) — same system

```
                       viota
   ┌ ROOM ───────────────────────────┐
   │            A B C 1 2 3           │   (big code, cyan, Luckiest Guy or spaced mono)
   │        share with friends        │
   │   ── players (2) ──              │
   │   • You — host                   │   (.seat-row chips; "(you)" + "— host" markers kept)
   │   • Sam                          │
   │   • Open seat…                   │   (open = dimmed)
   │   AI takeover: 1 min             │   (read-only, muted)
   └──────────────────────────────────┘
   [   Start game   ]   (host: Button primary, disabled until ≥2 humans)
   "Waiting for host to start…"  (non-host, muted italic)
                    ← leave           (.ghost-btn)
```

**Behavior preserved exactly:**
- Polls `fetchRoom` (2s) + subscribes to the nudge channel (`onStarted` → navigate; `onHostChanged`
  → update host). Unchanged.
- **Host-only Start** (spec §8): only the host seat sees Start; it's disabled until ≥2 humans; if
  open seats remain, the existing `window.confirm("Start with N open seats?…")` gate stays. Non-host
  sees "Waiting for host to start…". On success → `navigate('/game/online')`.
- **Roster** renders `seats` with the `open / ai / human` owner types and the `(you)` / `— host`
  markers exactly as today.
- **AI-takeover** display uses the existing `aiTakeoverLabel(...)`.
- **Leave** → best-effort `leaveGame` (so a departing host is promoted) → `clearSession` →
  `navigate('/')`. Unchanged.
- **`height: '100dvh'` → `minHeight: '100dvh'`** on the outer wrapper (it lives in the scrolling
  chrome container now; matches the Lobby fix from slice 1).
- No opaque page background — the aurora shows through.

## 4. Accessibility (spec §8 — "correctness-ish, don't drop")

- Every interactive control (fields, `.modal-pill` selectors, `Button`s, `.ghost-btn`, and any
  clickable seat/row) MUST have a **visible, clip-surviving `:focus-visible` ring** — the landing
  slice's only merge-blocker was a chamfer-clipped control missing this. Audit every new class.
- DOM order = visual order for a sane tab sequence (name → create-panel controls → create → join
  field → join → resume → back).
- Selectors expose pressed state (`aria-pressed`) as today.
- Contrast AA (reuse the deepened accent tokens; white on cyan/coral only on the deepened fills).
- Responsive: no horizontal scroll at 320px; panels stack on narrow screens; tap targets ≥ 44px.

## 5. Out of scope (explicit)

- **Online-vs-AI mode** (server-side vs client-AI+logging) + the modal's Local/Online toggle +
  real online difficulty — **deferred to the next slice** (needs a worker decision; Vijay is
  rethinking whether online-vs-AI should compute AI server-side at all). The landing **Play-vs-AI
  modal is UNTOUCHED** here (stays Local-only).
- Gameplay board (`/game/*`), engine, worker, network protocol, `gameStore`, `Card.tsx`.

## 6. Files

- **Changed:** `packages/client/src/pages/Lobby.tsx` (rebuild: two panels, drop solo path),
  `packages/client/src/pages/WaitingRoom.tsx` (restyle + `minHeight`), `packages/client/src/theme.css`
  (additive `.field`/`.panel`/`.seat-row`/`.ghost-btn` classes + their `:focus-visible` rings).
- **Tests:** update `Lobby.test.tsx` (drop the removed solo-flow assertions; keep/verify create +
  join + name-required + resume; DO NOT weaken) and `WaitingRoom.test.tsx` if present (host-only
  Start, roster, leave). Add coverage for the renamed Players selector → `createOnlineRoom` playerCount.
- **New:** none (no new components; reuse `Button`).

## 7. Testing / done

- `pnpm --filter @viota/client test` green; `tsc --noEmit` clean; `… build` clean.
- Reuse of `Button` + design tokens; no engine/worker/protocol/gameStore/Card touched.
- Visual check at 320 / 375 / 768+ widths; focus rings visible on every control.
- Deploy is **gated on Vijay** (client-only Pages deploy; no worker change this slice).

## 8. Definition of done

- [ ] Lobby is two panels (Create / Join), friends-only; solo Play-vs-AI removed; create + join
      behavior byte-identical; Players=2/3/4 default 2 → `createOnlineRoom` playerCount.
- [ ] Waiting room restyled to the system; host-only Start / roster / AI-takeover / leave all
      preserved; `minHeight`.
- [ ] All new chamfer/clipped controls have clip-surviving focus rings.
- [ ] `Card`/engine/worker/protocol/gameStore/modal untouched; tests green; build clean.
- [ ] Reuses the design system; both pages read as one look with the hero + modal.
