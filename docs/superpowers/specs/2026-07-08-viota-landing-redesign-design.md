# viota — Landing Redesign + Design System (spec)

**Date:** 2026-07-08
**Author:** Claude (front-end redesign brainstorm with Vijay, via the visual companion)
**Scope:** The **landing page** (`/` → `Home.tsx`) and the **shared design system** it
establishes (tokens, fonts, button, footer, layout). Lobby and gameplay are **separate,
later** brainstorms that will *reuse* this system.

> This is the first slice of the front-end redesign described in
> `docs/FRONTEND-REDESIGN-HANDOFF.md`. Read that handoff for the hard architecture rules.
> **The game logic, network protocol, redaction, and no-optimism contracts are DONE and
> must not change.** This is UI only.

---

## 0. The one hard rule (repeat)

**The Iota card tile (`Card.tsx`) is LOCKED.** Vijay spent real time designing it. Do **not**
restyle the card — colors, shapes, numbers, the wild star, size, radius, shadow all stay as
shipped. The redesign styles *everything around* the card. The card may be *rendered* in new
places (e.g. the hero art) but never modified without Vijay's explicit consent.

---

## 1. Direction (decided)

**"Neon Night" / playful pop.** A dark, glowing, richly-colored world with punchy, tactile
controls. Brand name is lowercase **viota**. The look is deliberately a *soft, dreamy
background* under *hard, brutalist buttons* — that contrast is intentional.

---

## 2. Design tokens (the system — app-wide)

Implement as CSS custom properties on `:root` (a single `theme.css` / tokens module the whole
app imports). Lobby + gameplay will consume these.

### Color
```
--bg:            #0a0612;   /* app dark base */
--bg-footer:     #080410;   /* footer surface */
--ink-on-btn:    #ffffff;   /* button label (on deepened fills) */

/* brand + accents (drawn from the mesh) */
--brand-cyan:    #22d3ee;   /* wordmark "o", brand glow, footer links */
--cyan-1:        #0a91b5;   /* primary button gradient start (deepened) */
--cyan-2:        #1e5fd0;   /* primary button gradient end */
--cyan-shadow:   #06394a;   /* primary button hard offset shadow */
--coral-1:       #e0521f;   /* secondary button gradient start (deepened) */
--coral-2:       #e01f47;   /* secondary button gradient end */
--coral-shadow:  #7a2417;   /* secondary button hard offset shadow */

/* text */
--text-hi:       #ffffff;   /* headings */
--text-body:     #eef1f6;   /* body copy */
--text-muted:    #b9d6e0;   /* meta / uppercase micro */
--text-wink:     #a9c9d6;   /* tagline wink clause (matches approved mock) */
--text-footer:   #9fb6c2;
--link:          #22d3ee;   /* footer link */
--link-hover:    #67e8f9;
```
> Contrast: white on the *deepened* cyan/coral fills and cyan links on `--bg-footer` both meet
> WCAG AA (≥ 4.5:1). Do **not** revert buttons to the bright cyan/coral — white text fails on
> those. (This was an explicit decision.)

### The woven aurora background (hero + chrome pages)
A layered radial mesh over `--bg`, top-to-bottom in the stack:
```
background:
  radial-gradient(50% 55% at 16% 20%, rgba(255,122,69,.46), transparent 55%),  /* coral   */
  radial-gradient(52% 56% at 40% 72%, rgba(255,61,154,.42), transparent 55%),  /* magenta */
  radial-gradient(52% 56% at 68% 24%, rgba(124,92,255,.50), transparent 55%),  /* violet  */
  radial-gradient(56% 60% at 86% 78%, rgba(34,211,238,.46), transparent 55%),  /* cyan    */
  #0a0612;
```
Plus two overlays:
- **Grain:** an inline SVG `feTurbulence` (fractalNoise, `baseFrequency≈0.8`, 2 octaves),
  `mix-blend-mode: overlay`, `opacity: .08`. (Kills gradient banding, adds texture.)
- **Vignette:** `box-shadow: inset 0 0 200px 60px rgba(5,3,10,.55)` — focuses the center,
  lifts text contrast.

### Type
- **Title / display:** **Luckiest Guy** (single weight). Used for the `viota` wordmark and the
  small top-bar brandmark.
- **Body / UI:** **Fredoka** (weights 400–700; default UI weight **500**). Everything else.
- **Self-host** both (no runtime Google Fonts request — more reliable on Cloudflare Pages, no
  FOUT/privacy dependency). **Import each weight explicitly** — a bare `import '@fontsource/fredoka'`
  ships weight 400 only, so 500/600/700 would silently fall back: import
  `@fontsource/fredoka/400.css` `/500.css` `/600.css` `/700.css` (or use
  `@fontsource-variable/fredoka`). Luckiest Guy is single-weight (`@fontsource/luckiest-guy`).

### The button (`<Button>` component — app-wide primitive)
**Chamfer × Brutalist**, two-layer so the border is real and the shadow follows the cut:
- Silhouette: `clip-path: polygon(13px 0, 100% 0, 100% calc(100% - 13px), calc(100% - 13px) 100%, 0 100%, 0 13px)` (top-left + bottom-right corners chamfered). Applied to **both** the outer frame and the inner `.face`.
- Outer frame: `background:#fff` (the border), `padding:2.5px`; inner `.face`: the color fill,
  `padding:14px 30px`, label in Fredoka 500.
- Depth: `filter: drop-shadow(5px 6px 0 <shadow-color>)` (hard, no blur — follows the chamfer).
- Interaction: `:hover` → `translate(2px,2px)` + `drop-shadow(3px 4px 0 …)`; `:active` →
  `translate(4px,5px)` + `drop-shadow(0 0 0 …)` (snaps flush into its shadow).
- Variants: `primary` = cyan fill/shadow; `secondary` = coral fill/shadow. Label always white.
- **Focus (do not skip):** the chamfer `clip-path` clips the default `outline` away — it will
  NOT show. Provide a **clip-surviving** focus ring: on `:focus-visible`, apply
  `box-shadow: inset 0 0 0 3px <focus-color>` on the `.face` (or an `outline` on an unclipped
  wrapper around the two clipped layers). Never rely on the UA outline (§8).
- Props: `variant`, `onClick`, `children`, plus pass-through. Reused by lobby/gameplay.

### Motion
- Hero cards gently float. `transform` is **not** additive, so fold each card's static rotation
  **and size** into the animated transform via a `--t` custom property (this is how size varies
  on the *locked, fixed-56px* card — a wrapper `scale()`, never a Card prop):
  `@keyframes floaty { 0%,100%{transform:var(--t) translateY(0)} 50%{transform:var(--t) translateY(-12px)} }`
  with `--t: rotate(<deg>) scale(<n>)` per card, 4–5s ease-in-out, **staggered** delays. Provide
  a static `transform: var(--t)` fallback so rotation/scale hold when the animation is off.
- **`prefers-reduced-motion: reduce`** → disable the float and button-press translate; keep the
  static `--t` positions. (Accessibility requirement.)

---

## 3. The landing hero

Full-viewport hero (`min-height: 100dvh` on desktop; on chrome pages the **document scrolls** to
reveal the footer below the fold — this requires relaxing the global `body`/`#root` height/overflow
caps in `index.html`, see §10 "page shell"). Left-aligned content column over the woven-mesh
world + grain + vignette.

**Top bar** (absolute, z-above): small **`viota`** brandmark (Luckiest Guy, cyan "o") on the
left; a **"how to play"** text link (Fredoka) on the right → opens the how-to modal (§5).

**Left column:**
- **Wordmark:** `viota` — Luckiest Guy, ~clamp(64px, 11vw, 114px), white with cyan "o" and a
  soft cyan glow (`text-shadow: 0 0 42px rgba(34,211,238,.4)`).
- **Tagline (verbatim):** "Match on color, shape, and number*… and optimize for points.*"
  The "*… and optimize for points.*" clause set in lighter italic (`--text-wink` = `#a9c9d6`,
  per the approved mock) for the wink (a nod to the easy AI, "RickBot — nOt OpTiMiZiNg FoR PoInTs").
- **Two buttons (twins, no emoji):**
  - **Play vs AI** — `primary` (cyan) → opens the AI-setup modal (§4).
  - **Play with friends** — `secondary` (coral) → navigates to `/lobby`.
- **Meta line:** `2–4 PLAYERS · FREE · NO DOWNLOAD` — uppercase, Fredoka 600, `--text-muted`.

**Hero art (right / behind):** the **scattered-drift** composition — ~6 **real** `Card`
components in the right ~55%, plus ~2 faint (`opacity ~.15`) behind the text for depth. `Card` is
**rendered unmodified** (fixed 56px, no new props — it's locked); all **size / rotation / float /
depth** live on a **wrapper `<div>`** around each `<Card/>` (size = `scale()` folded into `--t`
per §2 Motion; depth = wrapper `opacity`). The whole art layer is `pointer-events:none` so it
never blocks the buttons.
**Mobile:** hide the two faint depth cards; show **~3–4** cards as a small **overlapping fanned
row** (rotations preserved) reflowed **below** the copy, capped to viewport width (no horizontal
scroll at 320px); float may stay or be reduced but must respect `prefers-reduced-motion`.

**Reference mockup:** `.superpowers/brainstorm/24188-1783540924/content/final-hero-v2.html`
(the approved final; brainstorm iterations live alongside it).

---

## 4. "Play vs AI" setup modal (functional — preserves today's Home)

Clicking **Play vs AI** opens an on-theme modal (dark panel, chamfer corners, mesh-tinted),
replacing the inline selectors that live in `Home.tsx` today:
- **AI opponents:** 1 / 2 / 3 (segmented, chamfer-brutalist mini-buttons). Default 1.
- **Difficulty:** **RickBot** (easy — keep the flavor label, e.g. "RickBot · not optimizing
  for points") vs **Expert**. Default RickBot.
- **Start** button (primary) → calls the existing `useGameStore().startGame(opponents+1,
  difficulty)` and navigates to `/game/local`. **Store semantics unchanged** — this is a
  restyle + relocation of the current controls, not new logic.
- Dismiss on backdrop click / Esc / a close affordance. Focus-trapped, `role="dialog"`,
  `aria-modal`, labelled.

---

## 5. "How to play" — OWNED BY ANOTHER AGENT

The rules / how-to-play screen is being designed **by a different agent** (in parallel). **Do
NOT design or build its content here.** The landing's only responsibility is the **entry
point**: the top-bar "how to play" link. Wire it to whatever that agent ships (a route or a
modal trigger) — coordinate on the integration seam (a shared route path or a shared modal
component/callback). Until their screen lands, the link opens a **minimal placeholder modal**
("Rules coming soon") — a **visible** affordance, never a silently inert/dead link. The link
(and this placeholder) are part of this slice; the DoD in §12 reflects this.

## 5A. Resume your games (landing + lobby)

**Placement (decided):** surface saved games on the **landing** *and* keep them in the
**lobby**. On the landing it's a **compact, on-theme "Resume" strip** that renders **only when
there is something to resume** — first-time / empty state shows the clean hero, nothing added.
The strip sits below the two buttons + meta line (or as a slim band); it must never disrupt the
first-time hero. Also restyle the lobby's existing `ResumeGames` to the new theme.

**Two sources, merged into one strip:**
1. **Online** — the existing `ResumeGames` logic (`GET /my-games`), authed by the device
   account. Entries: `CODE · in lobby/in play · seat N · 2m ago`. Tap → waiting = `/lobby/:code`,
   active = `/game/online` (re-syncs on mount). **Keep this logic; only restyle.**
2. **Local (vs-AI)** — an in-progress local game persisted to localStorage. **The
   local-persistence feature is built by ANOTHER AGENT** (like how-to-play). This slice designs
   the **seam**: the strip consumes a small provider/hook (e.g. `useLocalResumableGame()`) that
   returns 0-or-1 local resumable game; when present, render a local entry (`vs AI · in play ·
   Xm ago`, **no code**, a distinct mode marker vs online rows) that taps → `/game/local`
   (the other agent wires the actual load/restore). **Hook contract — this slice owns the
   signature, the other agent fills the body:** `useLocalResumableGame(): { lastActivityAt:
   number } | null`. The strip derives "Xm ago" from `lastActivityAt` (reusing `ago()`) and
   always routes local rows to `/game/local`. Stub returns `null`, so until wired the strip is
   online-only — no breakage.

**Auth / "signed in":** viota has **no explicit login** — identity is an auto-minted device
credential; `quickAuth` silently makes an account. **Online** resume is inherently device-account
gated (automatic). **Local** resume is device-local and should **NOT require sign-in** (key it
off the device credential / a plain localStorage slot) so a first-time solo player can resume
their own game. Making resume account-gated is a *product* option for the local-persistence
agent, not a technical requirement — documented, not imposed.

**Async / empty / failure:** `myGames` is async and starts empty, and it **swallows errors →
returns `[]`** (intentional — a network failure is treated as "nothing to resume," no error UI;
this preserves the existing behavior, "keep this logic; only restyle"). The strip renders nothing
until data arrives, then **appends below the meta line** — since it sits below the hero content,
a returning-player insertion does **not** reflow the wordmark/tagline/buttons above it. No loading
skeleton required.

**Styling:** restyle today's dark `#1e1e3a` chips to the new system — chamfer corners,
mesh-tinted panel, Fredoka, cyan/coral accents, AA contrast, responsive, no 320px overflow.

---

## 6. Footer (portfolio footer — per `personal-site/docs/portfolio-footer-brief.md`)

**Exact copy, verbatim (do not reword):**
> Have **Feedback**? Want to see my other projects? **Click here.**

- **Feedback** → `https://theonenonlyvj.github.io/personal-site/contact`
- **Click here** → `https://theonenonlyvj.github.io/personal-site`
- Trailing period **outside** the "Click here" link.
- Both links: real `<a>`, `target="_blank"`, `rel="noopener noreferrer"`, visible focus.

**Styling (viota tokens):** `--bg-footer` surface, 1px top hairline `rgba(255,255,255,.08)`,
Fredoka 500, text `--text-footer`, **links `--brand-cyan`** with an underline (hover
`--link-hover`). Centered, `max-width`, padding, no horizontal overflow at 320px.

**Scope (decided):** appears on **chrome pages only — landing, lobby, waiting room. NOT on the
live game board** (`Game.tsx` / `OnlineGame.tsx`). This is a **deliberate departure** from the
brief's "every page/view" Definition of Done — the brief's game guidance is actually to *dock a
slim footer below the play area*, but **Vijay signed off on chrome-only (2026-07-08)** to keep
the board clean. Implement via a shared chrome **`Layout`** wrapper that renders the footer once;
the two game routes render outside that wrapper (or a `noFooter` flag).

---

## 7. Responsive / mobile

- Hero stacks: copy first (centered-left); the card cluster becomes the ~3–4-card fanned row
  below the copy (§3 Mobile); wordmark uses `clamp()`; faint depth cards hidden. No horizontal
  scroll at 320px.
- Buttons wrap; tap targets ≥ 44px. Modals are full-width sheets on narrow screens.
- Mobile matters (Vijay plays with friends on phones) — verify at 320/375/414 widths.

## 8. Accessibility

- Contrast AA on all text/links (already chosen for it).
- `prefers-reduced-motion` honored (§2).
- Buttons/links are real, focusable, with **visible focus rings** — the chamfer buttons need a
  clip-surviving ring (inset box-shadow / unclipped wrapper; §2 Button), since the UA outline is
  clipped away. Modals are focus-trapped and labelled; the "how to play" and footer links are
  keyboard-reachable.
- **Focus order:** the top bar is absolutely positioned, so **match DOM order to visual order**
  for a sane tab sequence: brandmark → how-to-play → primary button → secondary button → resume
  strip → footer.
- Wordmark is styled text (not an image) so it's readable by AT.

## 9. Out of scope (explicitly)

- **Card tile** restyle (locked).
- **Lobby** and **gameplay** visual redesign (next brainstorms) — but they MUST consume the
  tokens/button/footer this spec defines.
- Game logic, network protocol, redaction, no-optimism, store semantics — untouched.
- **Local-game persistence** (the store/localStorage feature behind local resume) — owned by
  **another agent**. This slice only builds the landing/lobby resume UI + the provider seam
  (§5A) that consumes it.
- `og-image.png` refresh + `index.html` `<title>` ("Iota" → confirm public name with Vijay
  before splashing large) — follow-ups, not blockers.

## 10. Files (anticipated touch list)

- **New:** `theme.css`/tokens module; `components/Button.tsx`; `components/Footer.tsx`;
  `components/Layout.tsx` (chrome wrapper w/ footer); `components/AuroraBackground.tsx`
  (mesh+grain+vignette); `pages/landing/Hero.tsx`; `components/PlayVsAiModal.tsx`;
  `components/ResumeStrip.tsx` (merges online + local sources, renders only when non-empty);
  `hooks/useLocalResumableGame.ts` (seam — stub returns null; the other agent implements it).
  (How-to-play screen is another agent's — we only render the link to it.)
- **Changed:** `Home.tsx` (becomes the hero composition; inline selectors move into the modal;
  hosts the `ResumeStrip`); `components/ResumeGames.tsx` (restyle to the new theme; the online
  source); `pages/Lobby.tsx` (restyled resume in the lobby); `main.tsx` (wrap chrome routes in
  `Layout`); `index.html` — **page shell (required):** relax the global scroll lock so chrome
  pages can scroll to the footer — `body { min-height:100dvh; overflow-y:auto }` (drop
  `overflow:hidden`) and `#root { min-height:100dvh }` (not fixed `height:100dvh`). **Game routes
  keep the fixed 100dvh no-scroll feel** — `Game.tsx`/`OnlineGame.tsx` already set their own
  full-height container, so relaxing the globals is safe, but **verify gameplay layout is
  unaffected**. Also: body font → Fredoka; keep social tags. (Fonts load via `@fontsource`
  imports in code, not `<link>`.)
- **Deps:** `@fontsource/luckiest-guy`, `@fontsource/fredoka` (import weights 400/500/600/700
  explicitly, or use `@fontsource-variable/fredoka`).

## 11. Testing

- Keep the suite green. Update any `Home.test.tsx` assertions changed by the restructure
  (don't weaken them). Add:
  - **Footer test:** render the router and **navigate** (`/` → `/lobby` → `/lobby/:code`),
    asserting both links **persist** across each transition (correct `href`, `target="_blank"`,
    `rel` containing `noopener`); then navigate to a `/game/*` route and assert they **disappear**.
    (Proves "every chrome page, not in-game" via real navigation — not per-route snapshots.)
  - **Play-vs-AI flow:** clicking Play vs AI opens the modal; Start calls `startGame` with the
    chosen opponents+difficulty and navigates to `/game/local`.
  - **Resume strip:** hidden when there are no online (`my-games`) and no local resumable games;
    shown when either exists; online rows route to `/lobby/:code` (waiting) or `/game/online`
    (active); the local seam returning null keeps the strip online-only without breakage; a
    failed/empty `my-games` fetch leaves the strip hidden (silent, no error UI).
  - `prefers-reduced-motion` disables animation (or at least the code path is guarded).
- Run `pnpm --filter @viota/client test` + `build` before shipping. Deploy per handoff §10
  (direct-upload Cloudflare Pages), verify live.

## 12. Definition of done (landing slice)

- [ ] Hero matches the approved mock (`final-hero-v2.html`): mesh+grain+vignette, Luckiest Guy
      wordmark w/ cyan "o", Fredoka copy + wink tagline, chamfer-brutalist cyan/coral twin
      buttons (medium weight, white labels), scattered-drift real cards, minimal top bar.
- [ ] Play vs AI modal preserves opponents+difficulty and starts a local game unchanged.
- [ ] How-to-play **link** wired + a minimal "Rules coming soon" **placeholder modal** ships
      until the rules agent's screen lands (never a dead/no-op link).
- [ ] Footer: exact copy, correct links/new-tab/noopener, viota-themed, AA contrast, chrome
      pages only, responsive.
- [ ] Card tile untouched; store/protocol untouched; tests green; build passes; deployed + live.
- [ ] Design tokens/button/footer are reusable primitives ready for the lobby + gameplay passes.
