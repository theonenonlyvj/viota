# viota Landing Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild viota's landing page in the approved "Neon Night / playful pop" look and lay down the reusable design system (tokens, fonts, button, aurora background, footer, chrome layout) that the lobby + gameplay passes will reuse.

**Architecture:** Introduce one global `theme.css` (CSS custom properties + component classes + keyframes) — the first real styling system in a codebase that was 100% inline styles. Add small focused components (`Button`, `AuroraBackground`, `Footer`, `Layout`, `PlayVsAiModal`, `HowToPlayModal`, `ResumeStrip`) and a rewritten `Home` hero. Chrome routes (`/`, `/lobby`, `/lobby/:code`) render inside a `Layout` route (aurora world + footer, in an internal scroll container); game routes render bare. The Iota `Card` component is rendered **unmodified** — all hero-art size/rotation/float lives on wrappers.

**Tech Stack:** React 18, Vite 5, react-router-dom 6 (layout routes + `useNavigate`), zustand 4, `@fontsource/*` (self-hosted fonts), vitest + @testing-library/react + user-event.

**Spec:** `docs/superpowers/specs/2026-07-08-viota-landing-redesign-design.md` (read it — every task traces to it).

## Global Constraints

- **UI only.** Do not touch `packages/engine`, `packages/worker`, the `net/` protocol, or `gameStore` semantics. (handoff §8)
- **`Card.tsx` is LOCKED** — never modify it (no new props, no size change). Render it as-is; vary size/rotation/float on a wrapper `<div>`. (spec §0)
- **No optimistic board mutation / redaction untouched** — not relevant to the landing, but never introduce it. (handoff §4)
- **Fonts:** title = **Luckiest Guy** (single weight); body/UI = **Fredoka**, default weight **500**. Self-host via `@fontsource`, importing each weight explicitly (400/500/600/700 for Fredoka). (spec §2)
- **Accent colors (deepened, white labels):** primary cyan `#0a91b5→#1e5fd0` (shadow `#06394a`); secondary coral `#e0521f→#e01f47` (shadow `#7a2417`). Brand cyan `#22d3ee`. Never revert to bright cyan/coral (white text fails contrast). (spec §2)
- **Button labels:** `Play vs AI` (primary) and `Play with friends` (secondary) — no emoji. (spec §3)
- **Tagline verbatim:** `Match on color, shape, and number… and optimize for points.` — the "… and optimize for points." clause in lighter italic (`--text-wink` `#a9c9d6`). (spec §3)
- **Footer copy verbatim (do not reword):** `Have Feedback? Want to see my other projects? Click here.` — `Feedback` → `https://theonenonlyvj.github.io/personal-site/contact`, `Click here` → `https://theonenonlyvj.github.io/personal-site`, period **outside** the link, both `target="_blank" rel="noopener noreferrer"`. Footer on **chrome pages only**, never on game routes. (spec §6)
- **Reference mock (pixel source of truth):** `.superpowers/brainstorm/24188-1783540924/content/final-hero-v2.html`.
- Client commands are pnpm-scoped: `pnpm --filter @viota/client test` / `build`. Never a root `npm`.

## Integration seams (LOUD — the parallel agents adapt to THESE)

1. **How-to-play (the how-to-play agent):** the landing owns the top-bar **link** and a placeholder `HowToPlayModal`. Contract: a rules screen is surfaced by rendering `<HowToPlayModal open onClose={…} />`. The how-to-play agent replaces the modal **body** (or swaps in a route) — they must keep the component name `HowToPlayModal` and the `{ open: boolean; onClose: () => void }` prop shape, or coordinate a change with this branch.
2. **Local resume (the local-persistence agent):** the landing owns the hook **signature** `useLocalResumableGame(): { lastActivityAt: number } | null` (Task 6, stub returns `null`). The persistence agent fills the body (read localStorage) — they must satisfy this return type. `ResumeStrip` renders a `vs AI · in play · <ago>` row and routes to `/game/local` when it's non-null.

## File structure

- Create `packages/client/src/theme.css` — tokens + component classes + keyframes (imported once in `main.tsx`).
- Create `packages/client/src/theme/fonts.ts` — `@fontsource` imports.
- Create `packages/client/src/components/Button.tsx` (+ test) — chamfer-brutalist button primitive.
- Create `packages/client/src/components/AuroraBackground.tsx` (+ test) — mesh + grain + vignette world layer.
- Create `packages/client/src/components/Footer.tsx` (+ test) — portfolio footer.
- Create `packages/client/src/components/Layout.tsx` (+ test) — chrome layout route (aurora + `<Outlet/>` + footer, scroll container).
- Create `packages/client/src/hooks/useLocalResumableGame.ts` (+ test) — local-resume seam stub.
- Create `packages/client/src/components/ResumeStrip.tsx` (+ test) — merged online + local resume strip.
- Create `packages/client/src/components/PlayVsAiModal.tsx` (+ test) — AI setup modal.
- Create `packages/client/src/components/HowToPlayModal.tsx` (+ test) — placeholder rules modal.
- Rewrite `packages/client/src/pages/Home.tsx` (+ update `Home.test.tsx`) — the hero.
- Modify `packages/client/src/main.tsx` — Layout route wrapping chrome routes.
- Modify `packages/client/src/pages/Lobby.tsx` — swap `ResumeGames` → `ResumeStrip` (keep its own logic).
- Modify `packages/client/index.html` — body font → Fredoka (keep `overflow:hidden`; Layout scrolls internally — see note in Task 5).

---

### Task 1: Design system foundation — deps, fonts, tokens

**Files:**
- Create: `packages/client/src/theme.css`
- Create: `packages/client/src/theme/fonts.ts`
- Modify: `packages/client/src/main.tsx` (add two imports at top)
- Modify: `packages/client/package.json` (deps)
- Modify: `packages/client/index.html` (body font-family)

**Interfaces:**
- Produces: the global stylesheet (CSS classes `viota-btn`, `viota-btn__face`, `viota-btn--primary/secondary`, `aurora`, `aurora__mesh`, `aurora__grain`, `aurora__vignette`, `chrome-scroll`, `foot`, `foot__link`, `resume-strip`, `resume-row`, `modal-backdrop`, `modal-card`, keyframes `floaty`) and CSS variables consumed by every later task.

- [ ] **Step 1: Install fonts**

Run: `pnpm --filter @viota/client add @fontsource/luckiest-guy @fontsource/fredoka`
Expected: both appear under `dependencies` in `packages/client/package.json`.

- [ ] **Step 2: Create the font import module**

Create `packages/client/src/theme/fonts.ts`:
```ts
// Self-hosted fonts (no runtime Google Fonts). Import each Fredoka weight
// explicitly — a bare '@fontsource/fredoka' ships weight 400 only.
import '@fontsource/luckiest-guy'
import '@fontsource/fredoka/400.css'
import '@fontsource/fredoka/500.css'
import '@fontsource/fredoka/600.css'
import '@fontsource/fredoka/700.css'
```

- [ ] **Step 3: Create `theme.css`**

Create `packages/client/src/theme.css`:
```css
:root {
  --bg: #0a0612; --bg-footer: #080410; --brand-cyan: #22d3ee;
  --cyan-1: #0a91b5; --cyan-2: #1e5fd0; --cyan-shadow: #06394a;
  --coral-1: #e0521f; --coral-2: #e01f47; --coral-shadow: #7a2417;
  --text-hi: #fff; --text-body: #eef1f6; --text-muted: #b9d6e0;
  --text-wink: #a9c9d6; --text-footer: #9fb6c2;
  --link: #22d3ee; --link-hover: #67e8f9;
  --chamfer: polygon(13px 0, 100% 0, 100% calc(100% - 13px), calc(100% - 13px) 100%, 0 100%, 0 13px);
}
body { font-family: 'Fredoka', system-ui, sans-serif; }

/* chrome layout scroll container (footer reachable; game routes stay bare) */
.chrome-scroll { height: 100dvh; overflow-y: auto; overflow-x: hidden; }

/* aurora world */
.aurora { position: relative; min-height: 100dvh; background:
  radial-gradient(50% 55% at 16% 20%, rgba(255,122,69,.46), transparent 55%),
  radial-gradient(52% 56% at 40% 72%, rgba(255,61,154,.42), transparent 55%),
  radial-gradient(52% 56% at 68% 24%, rgba(124,92,255,.50), transparent 55%),
  radial-gradient(56% 60% at 86% 78%, rgba(34,211,238,.46), transparent 55%),
  var(--bg); overflow: hidden; }
.aurora__grain { position: absolute; inset: 0; z-index: 1; pointer-events: none;
  mix-blend-mode: overlay; opacity: .08; background-size: 130px 130px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='130' height='130'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
.aurora__vignette { position: absolute; inset: 0; z-index: 1; pointer-events: none;
  box-shadow: inset 0 0 200px 60px rgba(5,3,10,.55); }
.aurora__content { position: relative; z-index: 2; }

/* chamfer-brutalist button */
.viota-btn { display: inline-block; padding: 2.5px; border: none; cursor: pointer;
  background: #fff; clip-path: var(--chamfer); font-family: 'Fredoka';
  font-weight: 500; font-size: 17px; color: #fff;
  transition: transform .08s ease, filter .12s; }
.viota-btn__face { display: block; padding: 14px 30px; clip-path: var(--chamfer); }
.viota-btn:hover { transform: translate(2px, 2px); }
.viota-btn:active { transform: translate(4px, 5px); }
.viota-btn:focus-visible { outline: none; }
.viota-btn:focus-visible .viota-btn__face { box-shadow: inset 0 0 0 3px #eafcff; }
.viota-btn--primary { filter: drop-shadow(5px 6px 0 var(--cyan-shadow)); }
.viota-btn--primary .viota-btn__face { background: linear-gradient(120deg, var(--cyan-1), var(--cyan-2)); }
.viota-btn--primary:hover { filter: drop-shadow(3px 4px 0 var(--cyan-shadow)); }
.viota-btn--primary:active { filter: drop-shadow(0 0 0 var(--cyan-shadow)); }
.viota-btn--secondary { filter: drop-shadow(5px 6px 0 var(--coral-shadow)); }
.viota-btn--secondary .viota-btn__face { background: linear-gradient(120deg, var(--coral-1), var(--coral-2)); }
.viota-btn--secondary:hover { filter: drop-shadow(3px 4px 0 var(--coral-shadow)); }
.viota-btn--secondary:active { filter: drop-shadow(0 0 0 var(--coral-shadow)); }

/* footer */
.foot { background: var(--bg-footer); border-top: 1px solid rgba(255,255,255,.08);
  text-align: center; padding: 26px 20px 34px; }
.foot__text { margin: 0 auto; max-width: 900px; font-family: 'Fredoka'; font-weight: 500;
  font-size: 14.5px; line-height: 1.6; color: var(--text-footer); }
.foot__link { color: var(--link); font-weight: 600; text-decoration: none;
  border-bottom: 2px solid rgba(34,211,238,.5); padding-bottom: 1px; white-space: nowrap; }
.foot__link:hover, .foot__link:focus-visible { color: var(--link-hover); border-bottom-color: var(--link-hover); outline: none; }

/* resume strip */
.resume-strip { display: flex; flex-direction: column; gap: 8px; max-width: 340px; }
.resume-row { display: flex; justify-content: space-between; align-items: center; gap: 10px;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.16); color: var(--text-body);
  clip-path: var(--chamfer); padding: 9px 14px; font-family: 'Fredoka'; font-size: 13px; cursor: pointer; }
.resume-row:hover { background: rgba(255,255,255,.12); }
.resume-row__meta { color: var(--text-muted); font-size: 11px; }

/* modal */
.modal-backdrop { position: fixed; inset: 0; z-index: 50; background: rgba(5,3,10,.72);
  display: flex; align-items: center; justify-content: center; padding: 20px; }
.modal-card { background: #140a1e; border: 1px solid rgba(255,255,255,.12); clip-path: var(--chamfer);
  padding: 28px; max-width: 380px; width: 100%; color: var(--text-body); font-family: 'Fredoka'; }

/* hero card float — rotation+scale folded into --t (transform is not additive) */
@keyframes floaty { 0%,100% { transform: var(--t) translateY(0); } 50% { transform: var(--t) translateY(-12px); } }

@media (prefers-reduced-motion: reduce) {
  .viota-btn { transition: none; }
  .viota-btn:hover, .viota-btn:active { transform: none; }
  .pc { animation: none !important; }
}

/* hero layout + mobile: hide the scattered art, show a fanned row below the copy */
.hero { position: relative; min-height: 100dvh; display: flex; align-items: center; padding: 56px 8vw; }
.hero-cards-mobile { display: none; }
@media (max-width: 760px) {
  .hero { flex-direction: column; align-items: flex-start; justify-content: center; padding: 90px 24px 60px; }
  .pc-layer { display: none; }
  .hero-cards-mobile { display: flex; margin-top: 22px; }
}
```

- [ ] **Step 4: Wire imports into `main.tsx`**

Add at the very top of `packages/client/src/main.tsx` (before other imports):
```tsx
import './theme/fonts'
import './theme.css'
```

- [ ] **Step 5: Set the body font in `index.html`**

In `packages/client/index.html`, change the `body { … font-family: system-ui, sans-serif; … }` rule's font-family to `'Fredoka', system-ui, sans-serif`. **Leave `overflow: hidden` and the `100dvh` heights as-is** — the chrome `Layout` scrolls internally (Task 5), so gameplay's no-scroll shell is untouched.

- [ ] **Step 6: Verify build**

Run: `pnpm --filter @viota/client build`
Expected: builds with no errors (fonts resolve, CSS parses).

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/theme.css packages/client/src/theme/fonts.ts packages/client/src/main.tsx packages/client/index.html packages/client/package.json ../../pnpm-lock.yaml
git commit -m "feat(client): design-system foundation — self-hosted fonts + theme tokens"
```

---

### Task 2: Button primitive

**Files:**
- Create: `packages/client/src/components/Button.tsx`
- Test: `packages/client/src/components/Button.test.tsx`

**Interfaces:**
- Produces: `export default function Button(props: { variant: 'primary' | 'secondary'; children: React.ReactNode; onClick?: () => void } & React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element` — renders `<button class="viota-btn viota-btn--<variant>"><span class="viota-btn__face">{children}</span></button>`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/components/Button.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import Button from './Button'

test('renders a real button with the label and variant class', () => {
  render(<Button variant="primary">Play vs AI</Button>)
  const btn = screen.getByRole('button', { name: 'Play vs AI' })
  expect(btn.className).toContain('viota-btn--primary')
})

test('fires onClick', async () => {
  const onClick = vi.fn()
  render(<Button variant="secondary" onClick={onClick}>Play with friends</Button>)
  await userEvent.click(screen.getByRole('button', { name: 'Play with friends' }))
  expect(onClick).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viota/client test -- Button`
Expected: FAIL — cannot find `./Button`.

- [ ] **Step 3: Implement**

Create `packages/client/src/components/Button.tsx`:
```tsx
type Props = {
  variant: 'primary' | 'secondary'
  children: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>

export default function Button({ variant, children, className = '', ...rest }: Props) {
  return (
    <button className={`viota-btn viota-btn--${variant} ${className}`} {...rest}>
      <span className="viota-btn__face">{children}</span>
    </button>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viota/client test -- Button`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/Button.tsx packages/client/src/components/Button.test.tsx
git commit -m "feat(client): chamfer-brutalist Button primitive"
```

---

### Task 3: AuroraBackground

**Files:**
- Create: `packages/client/src/components/AuroraBackground.tsx`
- Test: `packages/client/src/components/AuroraBackground.test.tsx`

**Interfaces:**
- Produces: `export default function AuroraBackground({ children }: { children: React.ReactNode }): JSX.Element` — renders the mesh/grain/vignette layers (all `pointer-events:none`) with `children` in a `.aurora__content` layer above.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/components/AuroraBackground.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import AuroraBackground from './AuroraBackground'

test('renders children above non-interactive background layers', () => {
  const { container } = render(<AuroraBackground><button>Play</button></AuroraBackground>)
  expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  expect(container.querySelector('.aurora__grain')).not.toBeNull()
  expect(container.querySelector('.aurora__vignette')).not.toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viota/client test -- AuroraBackground`
Expected: FAIL — cannot find `./AuroraBackground`.

- [ ] **Step 3: Implement**

Create `packages/client/src/components/AuroraBackground.tsx`:
```tsx
export default function AuroraBackground({ children }: { children: React.ReactNode }) {
  return (
    <div className="aurora">
      <div className="aurora__grain" aria-hidden />
      <div className="aurora__vignette" aria-hidden />
      <div className="aurora__content">{children}</div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viota/client test -- AuroraBackground`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/AuroraBackground.tsx packages/client/src/components/AuroraBackground.test.tsx
git commit -m "feat(client): AuroraBackground world (mesh + grain + vignette)"
```

---

### Task 4: Footer

**Files:**
- Create: `packages/client/src/components/Footer.tsx`
- Test: `packages/client/src/components/Footer.test.tsx`

**Interfaces:**
- Produces: `export default function Footer(): JSX.Element` — the exact-copy portfolio footer.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/components/Footer.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import Footer from './Footer'

test('exact links with new-tab + noopener', () => {
  render(<Footer />)
  const fb = screen.getByRole('link', { name: /feedback/i })
  expect(fb).toHaveAttribute('href', 'https://theonenonlyvj.github.io/personal-site/contact')
  expect(fb).toHaveAttribute('target', '_blank')
  expect(fb.getAttribute('rel')).toContain('noopener')
  const cta = screen.getByRole('link', { name: /click here/i })
  expect(cta).toHaveAttribute('href', 'https://theonenonlyvj.github.io/personal-site')
  expect(cta).toHaveAttribute('target', '_blank')
  expect(cta.getAttribute('rel')).toContain('noopener')
})

test('verbatim copy with period outside the link', () => {
  render(<Footer />)
  expect(screen.getByRole('contentinfo').textContent)
    .toBe('Have Feedback? Want to see my other projects? Click here.')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viota/client test -- Footer`
Expected: FAIL — cannot find `./Footer`.

- [ ] **Step 3: Implement**

Create `packages/client/src/components/Footer.tsx`:
```tsx
export default function Footer() {
  return (
    <footer className="foot">
      <p className="foot__text">
        Have{' '}
        <a className="foot__link" href="https://theonenonlyvj.github.io/personal-site/contact"
           target="_blank" rel="noopener noreferrer">Feedback</a>? Want to see my other projects?{' '}
        <a className="foot__link" href="https://theonenonlyvj.github.io/personal-site"
           target="_blank" rel="noopener noreferrer">Click here</a>.
      </p>
    </footer>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viota/client test -- Footer`
Expected: PASS (2 tests). If the textContent test fails on whitespace, ensure the JSX uses `{' '}` exactly as shown (no stray spaces).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/Footer.tsx packages/client/src/components/Footer.test.tsx
git commit -m "feat(client): portfolio footer (exact-copy, on-theme)"
```

---

### Task 5: Layout (chrome route)

**Files:**
- Create: `packages/client/src/components/Layout.tsx`
- Test: `packages/client/src/components/Layout.test.tsx`

**Interfaces:**
- Consumes: `AuroraBackground` (Task 3), `Footer` (Task 4).
- Produces: `export default function Layout(): JSX.Element` — a react-router **layout element**: `<div class="chrome-scroll"><AuroraBackground><Outlet/></AuroraBackground><Footer/></div>`. The internal `.chrome-scroll` container is why the footer is reachable without touching `index.html`'s global `overflow:hidden` (game routes never mount Layout, so their fixed-height no-scroll shell is unaffected).

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/components/Layout.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Layout from './Layout'

test('renders the routed child and the footer once', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>child page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByText('child page')).toBeInTheDocument()
  expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viota/client test -- Layout`
Expected: FAIL — cannot find `./Layout`.

- [ ] **Step 3: Implement**

Create `packages/client/src/components/Layout.tsx`:
```tsx
import { Outlet } from 'react-router-dom'
import AuroraBackground from './AuroraBackground'
import Footer from './Footer'

export default function Layout() {
  return (
    <div className="chrome-scroll">
      <AuroraBackground>
        <Outlet />
      </AuroraBackground>
      <Footer />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viota/client test -- Layout`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/Layout.tsx packages/client/src/components/Layout.test.tsx
git commit -m "feat(client): chrome Layout route (aurora + footer, internal scroll)"
```

---

### Task 6: `useLocalResumableGame` seam (stub)

**Files:**
- Create: `packages/client/src/hooks/useLocalResumableGame.ts`
- Test: `packages/client/src/hooks/useLocalResumableGame.test.ts`

**Interfaces:**
- Produces: `export function useLocalResumableGame(): { lastActivityAt: number } | null`. **SEAM:** returns `null` today. The local-persistence agent replaces the body to read the in-progress local game from localStorage; the return type is fixed here — they must satisfy it.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/hooks/useLocalResumableGame.test.ts`:
```ts
import { renderHook } from '@testing-library/react'
import { useLocalResumableGame } from './useLocalResumableGame'

test('stub returns null (no local resume until the persistence agent wires it)', () => {
  const { result } = renderHook(() => useLocalResumableGame())
  expect(result.current).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viota/client test -- useLocalResumableGame`
Expected: FAIL — cannot find `./useLocalResumableGame`.

- [ ] **Step 3: Implement**

Create `packages/client/src/hooks/useLocalResumableGame.ts`:
```ts
/**
 * SEAM (owned by this branch; body owned by the local-persistence agent).
 * Return the in-progress local (vs-AI) game if one exists, else null.
 * Contract is the return TYPE — the persistence agent fills the body
 * (read localStorage). Keying off the device credential is fine; no sign-in
 * required (a local game is device-local). See spec §5A.
 */
export function useLocalResumableGame(): { lastActivityAt: number } | null {
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viota/client test -- useLocalResumableGame`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/hooks/useLocalResumableGame.ts packages/client/src/hooks/useLocalResumableGame.test.ts
git commit -m "feat(client): local-resume seam stub (useLocalResumableGame)"
```

---

### Task 7: ResumeStrip

**Files:**
- Create: `packages/client/src/components/ResumeStrip.tsx`
- Test: `packages/client/src/components/ResumeStrip.test.tsx`

**Interfaces:**
- Consumes: `myGames` from `../net/lobby`, `saveSession` from `../net/session`, `getDisplayName` from `../net/identity`, `serverUrl` from `../net/config`, `useLocalResumableGame` (Task 6), `useNavigate`.
- Produces: `export default function ResumeStrip(): JSX.Element | null` — merges online (`myGames`) + local (hook) resumable games; renders `null` when both are empty; online rows route to `/lobby/:code` (waiting) or `/game/online` (active); the local row routes to `/game/local`. Reuses the resume logic from `ResumeGames.tsx`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/components/ResumeStrip.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }))
vi.mock('../net/lobby', () => ({ myGames: vi.fn() }))
vi.mock('../hooks/useLocalResumableGame', () => ({ useLocalResumableGame: vi.fn(() => null) }))
vi.mock('../net/session', () => ({ saveSession: vi.fn() }))
vi.mock('../net/identity', () => ({ getDisplayName: () => 'Me' }))
vi.mock('../net/config', () => ({ serverUrl: () => 'http://x' }))

import { myGames } from '../net/lobby'
import { useLocalResumableGame } from '../hooks/useLocalResumableGame'
import ResumeStrip from './ResumeStrip'

function renderStrip() {
  return render(<MemoryRouter><ResumeStrip /></MemoryRouter>)
}

test('renders nothing when there is no online or local game', async () => {
  ;(myGames as any).mockResolvedValue([])
  const { container } = renderStrip()
  // wait a tick for the async effect
  await Promise.resolve()
  expect(container.querySelector('.resume-strip')).toBeNull()
})

test('shows an online row and routes on click', async () => {
  ;(myGames as any).mockResolvedValue([
    { gameId: 'g1', code: 'ABC123', status: 'active', playerCount: 2, seatIndex: 0, lastActivityAt: Date.now() },
  ])
  renderStrip()
  const row = await screen.findByText(/ABC123/)
  row.closest('.resume-row')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(navigate).toHaveBeenCalledWith('/game/online')
})

test('shows a local row when the hook returns a game', async () => {
  ;(myGames as any).mockResolvedValue([])
  ;(useLocalResumableGame as any).mockReturnValue({ lastActivityAt: Date.now() })
  renderStrip()
  expect(await screen.findByText(/vs AI/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viota/client test -- ResumeStrip`
Expected: FAIL — cannot find `./ResumeStrip`.

- [ ] **Step 3: Implement**

Create `packages/client/src/components/ResumeStrip.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { serverUrl } from '../net/config'
import { getDisplayName } from '../net/identity'
import { myGames, type ResumableGame } from '../net/lobby'
import { saveSession } from '../net/session'
import { useLocalResumableGame } from '../hooks/useLocalResumableGame'

const SERVER_URL = serverUrl()

function ago(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function ResumeStrip() {
  const navigate = useNavigate()
  const [online, setOnline] = useState<ResumableGame[]>([])
  const local = useLocalResumableGame()

  useEffect(() => {
    let active = true
    myGames(SERVER_URL).then((g) => { if (active) setOnline(g) }).catch(() => {})
    return () => { active = false }
  }, [])

  function resumeOnline(g: ResumableGame) {
    const players = Array.from({ length: g.playerCount }, (_, i) =>
      i === g.seatIndex ? getDisplayName() : `Player ${i + 1}`)
    saveSession({ gameId: g.gameId, code: g.code ?? '', mySeat: g.seatIndex, players })
    if (g.status === 'waiting') navigate(`/lobby/${g.code ?? ''}`)
    else navigate('/game/online')
  }

  if (online.length === 0 && !local) return null

  return (
    <div className="resume-strip">
      {local && (
        <button className="resume-row" onClick={() => navigate('/game/local')}>
          <span style={{ fontWeight: 600 }}>vs AI</span>
          <span className="resume-row__meta">in play · {ago(local.lastActivityAt)}</span>
        </button>
      )}
      {online.map((g) => (
        <button key={g.gameId} className="resume-row" onClick={() => resumeOnline(g)}>
          <span style={{ fontWeight: 600, letterSpacing: 2 }}>{g.code ?? '—'}</span>
          <span className="resume-row__meta">
            {g.status === 'waiting' ? 'in lobby' : 'in play'} · seat {g.seatIndex + 1} · {ago(g.lastActivityAt)}
          </span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viota/client test -- ResumeStrip`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/ResumeStrip.tsx packages/client/src/components/ResumeStrip.test.tsx
git commit -m "feat(client): ResumeStrip — merged online + local resume (seam)"
```

---

### Task 8: PlayVsAiModal

**Files:**
- Create: `packages/client/src/components/PlayVsAiModal.tsx`
- Test: `packages/client/src/components/PlayVsAiModal.test.tsx`

**Interfaces:**
- Consumes: `useGameStore` from `../store/gameStore` (action `startGame(playerCount, difficulty)`), `useNavigate`, `Button` (Task 2).
- Produces: `export default function PlayVsAiModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null`. Start → `startGame(opponents + 1, difficulty)` then `navigate('/game/local')`. `difficulty` is `'easy' | 'expert'`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/components/PlayVsAiModal.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

const navigate = vi.fn()
const startGame = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }))
vi.mock('../store/gameStore', () => ({ useGameStore: (sel: any) => sel({ startGame }) }))

import PlayVsAiModal from './PlayVsAiModal'

test('Start uses selected opponents+difficulty and navigates to the local game', async () => {
  render(<PlayVsAiModal open onClose={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: '3' }))          // 3 opponents
  await userEvent.click(screen.getByRole('button', { name: /expert/i }))    // expert
  await userEvent.click(screen.getByRole('button', { name: /^start/i }))
  expect(startGame).toHaveBeenCalledWith(4, 'expert')                       // 3 opponents + me
  expect(navigate).toHaveBeenCalledWith('/game/local')
})

test('returns null when closed', () => {
  const { container } = render(<PlayVsAiModal open={false} onClose={() => {}} />)
  expect(container.firstChild).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viota/client test -- PlayVsAiModal`
Expected: FAIL — cannot find `./PlayVsAiModal`.

- [ ] **Step 3: Implement**

Create `packages/client/src/components/PlayVsAiModal.tsx`:
```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import Button from './Button'

type Difficulty = 'easy' | 'expert'

export default function PlayVsAiModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [opponents, setOpponents] = useState(1)
  const [difficulty, setDifficulty] = useState<Difficulty>('easy')
  const navigate = useNavigate()
  const startGame = useGameStore((s) => s.startGame)
  if (!open) return null

  const pill = (active: boolean): React.CSSProperties => ({
    background: active ? 'rgba(34,211,238,.18)' : 'rgba(255,255,255,.06)',
    border: active ? '1.5px solid var(--brand-cyan)' : '1.5px solid rgba(255,255,255,.2)',
    color: '#fff', clipPath: 'var(--chamfer)', padding: '8px 16px', cursor: 'pointer',
    fontFamily: 'Fredoka', fontWeight: 500, fontSize: 14,
  })

  function start() {
    startGame(opponents + 1, difficulty)
    navigate('/game/local')
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Play vs AI">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>AI opponents</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          {[1, 2, 3].map((n) => (
            <button key={n} style={pill(opponents === n)} onClick={() => setOpponents(n)}>{n}</button>
          ))}
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>Difficulty</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 22 }}>
          <button style={pill(difficulty === 'easy')} onClick={() => setDifficulty('easy')}>RickBot · not optimizing for points</button>
          <button style={pill(difficulty === 'expert')} onClick={() => setDifficulty('expert')}>Expert</button>
        </div>
        <Button variant="primary" onClick={start}>Start game</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viota/client test -- PlayVsAiModal`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/PlayVsAiModal.tsx packages/client/src/components/PlayVsAiModal.test.tsx
git commit -m "feat(client): Play-vs-AI setup modal (opponents + difficulty)"
```

---

### Task 9: HowToPlayModal (placeholder — SEAM)

**Files:**
- Create: `packages/client/src/components/HowToPlayModal.tsx`
- Test: `packages/client/src/components/HowToPlayModal.test.tsx`

**Interfaces:**
- Produces: `export default function HowToPlayModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null`. **SEAM:** visible "Rules coming soon" placeholder now; the how-to-play agent replaces the body. Keep the name + prop shape.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/components/HowToPlayModal.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import HowToPlayModal from './HowToPlayModal'

test('shows a visible placeholder and closes', async () => {
  const onClose = vi.fn()
  render(<HowToPlayModal open onClose={onClose} />)
  expect(screen.getByText(/rules coming soon/i)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /close/i }))
  expect(onClose).toHaveBeenCalledOnce()
})

test('returns null when closed', () => {
  const { container } = render(<HowToPlayModal open={false} onClose={() => {}} />)
  expect(container.firstChild).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viota/client test -- HowToPlayModal`
Expected: FAIL — cannot find `./HowToPlayModal`.

- [ ] **Step 3: Implement**

Create `packages/client/src/components/HowToPlayModal.tsx`:
```tsx
import Button from './Button'

/** SEAM: placeholder until the how-to-play agent ships the real rules screen.
 *  Keep the component name + { open, onClose } prop shape stable. */
export default function HowToPlayModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="How to play">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontFamily: 'Luckiest Guy', fontSize: 24, marginBottom: 10 }}>How to play</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>Rules coming soon.</p>
        <Button variant="primary" onClick={onClose}>Close</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viota/client test -- HowToPlayModal`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/HowToPlayModal.tsx packages/client/src/components/HowToPlayModal.test.tsx
git commit -m "feat(client): HowToPlayModal placeholder (seam for rules agent)"
```

---

### Task 10: Home → the hero

**Files:**
- Modify (rewrite): `packages/client/src/pages/Home.tsx`
- Modify: `packages/client/src/pages/Home.test.tsx`

**Interfaces:**
- Consumes: `Button`, `PlayVsAiModal`, `HowToPlayModal`, `ResumeStrip`, `Card` (rendered unmodified), `useNavigate`.
- Produces: default `Home` — the hero composition. Renders inside the `Layout` aurora (Task 11), so it does NOT render its own background.

- [ ] **Step 1: Rewrite the test**

Replace `packages/client/src/pages/Home.test.tsx` with:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }))
vi.mock('../store/gameStore', () => ({ useGameStore: (sel: any) => sel({ startGame: vi.fn() }) }))
vi.mock('../components/ResumeStrip', () => ({ default: () => null }))

import Home from './Home'

function renderHome() { return render(<MemoryRouter><Home /></MemoryRouter>) }

test('shows both CTAs and the verbatim tagline', () => {
  renderHome()
  expect(screen.getByRole('button', { name: 'Play vs AI' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Play with friends' })).toBeInTheDocument()
  expect(screen.getByText(/Match on color, shape, and number/)).toBeInTheDocument()
})

test('Play with friends navigates to the lobby', async () => {
  renderHome()
  await userEvent.click(screen.getByRole('button', { name: 'Play with friends' }))
  expect(navigate).toHaveBeenCalledWith('/lobby')
})

test('Play vs AI opens the setup modal', async () => {
  renderHome()
  await userEvent.click(screen.getByRole('button', { name: 'Play vs AI' }))
  expect(screen.getByRole('dialog', { name: /play vs ai/i })).toBeInTheDocument()
})

test('how to play opens the placeholder', async () => {
  renderHome()
  await userEvent.click(screen.getByRole('button', { name: /how to play/i }))
  expect(screen.getByRole('dialog', { name: /how to play/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viota/client test -- Home`
Expected: FAIL (old Home has no such elements / modals).

- [ ] **Step 3: Implement the hero**

Replace `packages/client/src/pages/Home.tsx` with:
```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Card as CardType } from '@viota/engine'
import Card from '../components/Card'
import Button from '../components/Button'
import PlayVsAiModal from '../components/PlayVsAiModal'
import HowToPlayModal from '../components/HowToPlayModal'
import ResumeStrip from '../components/ResumeStrip'

type Scatter = { card: CardType; left?: number; right?: number; top?: number; bottom?: number; rot: number; scale: number; opacity?: number; delay: number }

// Real cards (unmodified) placed on wrappers; size = scale() folded into --t.
const CARDS: Scatter[] = [
  { card: { kind: 'wild' }, right: 130, top: 120, rot: -8, scale: 1.7, delay: 0 },
  { card: { kind: 'regular', color: 'blue', shape: 'circle', number: 4 }, right: 270, top: 230, rot: 10, scale: 1.5, delay: 0.6 },
  { card: { kind: 'regular', color: 'red', shape: 'plus', number: 2 }, right: 60, top: 300, rot: 6, scale: 1.4, delay: 1.1 },
  { card: { kind: 'regular', color: 'yellow', shape: 'square', number: 1 }, right: 210, top: 60, rot: -14, scale: 1.28, delay: 0.3 },
  { card: { kind: 'regular', color: 'green', shape: 'triangle', number: 3 }, right: 340, top: 360, rot: -4, scale: 1.35, delay: 0.9 },
  { card: { kind: 'regular', color: 'red', shape: 'square', number: 3 }, right: 20, top: 150, rot: 14, scale: 1.14, delay: 1.4 },
  { card: { kind: 'regular', color: 'green', shape: 'circle', number: 2 }, left: 30, top: 40, rot: -10, scale: 1.25, opacity: 0.16, delay: 0.5 },
  { card: { kind: 'regular', color: 'blue', shape: 'plus', number: 4 }, left: 120, bottom: 40, rot: 8, scale: 1.4, opacity: 0.14, delay: 1.0 },
]

// mobile: a compact fanned row below the copy (the absolute art is hidden < 760px)
const MOBILE_CARDS: { card: CardType; rot: number }[] = [
  { card: { kind: 'regular', color: 'red', shape: 'triangle', number: 1 }, rot: -12 },
  { card: { kind: 'regular', color: 'blue', shape: 'square', number: 2 }, rot: -4 },
  { card: { kind: 'regular', color: 'yellow', shape: 'circle', number: 3 }, rot: 6 },
  { card: { kind: 'wild' }, rot: 14 },
]

export default function Home() {
  const navigate = useNavigate()
  const [aiOpen, setAiOpen] = useState(false)
  const [howToOpen, setHowToOpen] = useState(false)

  return (
    <div className="hero">
      {/* top bar */}
      <div style={{ position: 'absolute', top: 26, left: '8vw', right: '8vw', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 6 }}>
        <span style={{ fontFamily: 'Luckiest Guy', color: '#fff', fontSize: 22, letterSpacing: '.02em', textShadow: '0 0 16px rgba(34,211,238,.5)' }}>
          vi<span style={{ color: 'var(--brand-cyan)' }}>o</span>ta
        </span>
        <button onClick={() => setHowToOpen(true)}
          style={{ background: 'none', border: 'none', color: '#eaf6fb', fontFamily: 'Fredoka', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
          how to play
        </button>
      </div>

      {/* scattered real-card art (pointer-events none so it never blocks buttons) */}
      <div className="pc-layer" aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none' }}>
        {CARDS.map((c, i) => (
          <div key={i} className="pc"
            style={{
              position: 'absolute', left: c.left, right: c.right, top: c.top, bottom: c.bottom,
              opacity: c.opacity ?? 1,
              // rotation + scale folded into --t so the float keyframe preserves them
              ['--t' as any]: `rotate(${c.rot}deg) scale(${c.scale})`,
              transform: `rotate(${c.rot}deg) scale(${c.scale})`,
              animation: `floaty ${4 + c.delay}s ease-in-out ${c.delay}s infinite`,
            }}>
            <Card card={c.card} />
          </div>
        ))}
      </div>

      {/* left column */}
      <div style={{ position: 'relative', zIndex: 5, maxWidth: 580 }}>
        <h1 style={{ fontFamily: 'Luckiest Guy', fontSize: 'clamp(64px, 11vw, 114px)', lineHeight: 0.9, color: '#fff', letterSpacing: '.01em', textShadow: '0 0 42px rgba(34,211,238,.4)' }}>
          vi<span style={{ color: 'var(--brand-cyan)' }}>o</span>ta
        </h1>
        <p style={{ fontSize: 20, color: 'var(--text-body)', marginTop: 18, maxWidth: 470, lineHeight: 1.45, fontWeight: 500 }}>
          Match on color, shape, and number<span style={{ color: 'var(--text-wink)', fontStyle: 'italic' }}>… and optimize for points.</span>
        </p>
        <div style={{ display: 'flex', gap: 18, marginTop: 34, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={() => setAiOpen(true)}>Play vs AI</Button>
          <Button variant="secondary" onClick={() => navigate('/lobby')}>Play with friends</Button>
        </div>
        <p style={{ marginTop: 22, fontSize: 13.5, letterSpacing: '.06em', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
          2–4 players · free · no download
        </p>
        <div style={{ marginTop: 20 }}><ResumeStrip /></div>
        <div className="hero-cards-mobile" aria-hidden>
          {MOBILE_CARDS.map((c, i) => (
            <div key={i} style={{ transform: `rotate(${c.rot}deg)`, marginLeft: i ? -14 : 0 }}>
              <Card card={c.card} />
            </div>
          ))}
        </div>
      </div>

      <PlayVsAiModal open={aiOpen} onClose={() => setAiOpen(false)} />
      <HowToPlayModal open={howToOpen} onClose={() => setHowToOpen(false)} />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viota/client test -- Home`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/pages/Home.tsx packages/client/src/pages/Home.test.tsx
git commit -m "feat(client): rebuild Home as the Neon-Night hero"
```

---

### Task 11: Router — Layout route + footer navigation test

**Files:**
- Modify: `packages/client/src/main.tsx`
- Test: `packages/client/src/main.routes.test.tsx` (new)

**Interfaces:**
- Consumes: `Layout` (Task 5). Chrome routes (`/`, `/lobby`, `/lobby/:code`) become children of a `<Route element={<Layout/>}>`; game routes stay bare.

- [ ] **Step 1: Extract routes so they're testable, and write the failing test**

First refactor `main.tsx` to export the route tree. Replace `packages/client/src/main.tsx` with:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './theme/fonts'
import './theme.css'
import Layout from './components/Layout'
import Home from './pages/Home'
import Game from './pages/Game'
import Lobby from './pages/Lobby'
import WaitingRoom from './pages/WaitingRoom'
import OnlineGame from './pages/OnlineGame'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/lobby/:code" element={<WaitingRoom />} />
      </Route>
      <Route path="/game/local" element={<Game />} />
      <Route path="/game/online" element={<OnlineGame />} />
    </Routes>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  </StrictMode>,
)
```

Create `packages/client/src/main.routes.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

// stub the heavy pages so the routing test stays about the footer
vi.mock('./pages/Home', () => ({ default: () => <div>home</div> }))
vi.mock('./pages/Lobby', () => ({ default: () => <div>lobby</div> }))
vi.mock('./pages/WaitingRoom', () => ({ default: () => <div>waiting</div> }))
vi.mock('./pages/Game', () => ({ default: () => <div>local game</div> }))
vi.mock('./pages/OnlineGame', () => ({ default: () => <div>online game</div> }))

import { AppRoutes } from './main'

function at(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>)
}

test('footer shows on chrome routes', () => {
  for (const p of ['/', '/lobby', '/lobby/ABC123']) {
    const { unmount } = at(p)
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    unmount()
  }
})

test('footer is absent on game routes', () => {
  for (const p of ['/game/local', '/game/online']) {
    const { unmount } = at(p)
    expect(screen.queryByRole('contentinfo')).toBeNull()
    unmount()
  }
})
```

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `pnpm --filter @viota/client test -- main.routes`
Expected: initially FAIL if `AppRoutes` isn't exported yet; after the `main.tsx` rewrite above, PASS (2 tests). Note: importing `./main` runs the `createRoot` line — guard is unnecessary because jsdom has no `#root`; if it throws, wrap the `createRoot(...)` call in `if (document.getElementById('root'))`.

- [ ] **Step 3: Guard the mount (if needed)**

If the test errored on `createRoot(null)`, change the last block of `main.tsx` to:
```tsx
const rootEl = document.getElementById('root')
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode><BrowserRouter><AppRoutes /></BrowserRouter></StrictMode>,
  )
}
```

- [ ] **Step 4: Run the full suite**

Run: `pnpm --filter @viota/client test`
Expected: all green (existing + new).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/main.tsx packages/client/src/main.routes.test.tsx
git commit -m "feat(client): Layout route wraps chrome pages; footer off game routes"
```

---

### Task 12: Lobby — use ResumeStrip + inherit the chrome background

**Files:**
- Modify: `packages/client/src/pages/Lobby.tsx`

**Interfaces:**
- Consumes: `ResumeStrip` (Task 7). Lobby now renders inside `Layout`'s aurora, so remove any full-page background it sets and swap `ResumeGames` → `ResumeStrip`.

- [ ] **Step 1: Swap the import and usage**

In `packages/client/src/pages/Lobby.tsx`: change `import ResumeGames from '../components/ResumeGames'` → `import ResumeStrip from '../components/ResumeStrip'`, and change `<ResumeGames />` → `<ResumeStrip />`. Change the outer wrapper's `height: '100dvh'` to `minHeight: '100dvh'` (it now lives in the scrolling chrome container) and drop any opaque page background so the aurora shows through (keep the inner panel styling).

- [ ] **Step 2: Run Lobby tests**

Run: `pnpm --filter @viota/client test -- Lobby`
Expected: PASS. If `Lobby.test.tsx` asserted on `ResumeGames`, update it to `ResumeStrip` (don't weaken — assert the strip renders/absent as before).

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/pages/Lobby.tsx packages/client/src/pages/Lobby.test.tsx
git commit -m "feat(client): lobby uses ResumeStrip + inherits chrome aurora"
```

---

### Task 13: Full verification, build, visual check, deploy

**Files:** none (verification).

- [ ] **Step 1: Full test suite**

Run: `pnpm --filter @viota/client test`
Expected: **all green** (existing ~180 + the new tests). Fix any regressions without weakening assertions.

- [ ] **Step 2: Production build**

Run: `VITE_SERVER_URL=https://viota-worker.theonenonlyvj.workers.dev pnpm --filter @viota/client build`
Expected: builds clean; fonts + CSS bundled.

- [ ] **Step 3: Visual verification (real browser)**

Run: `pnpm --filter @viota/client dev`, open the printed URL, and confirm against the mock (`.superpowers/brainstorm/24188-1783540924/content/final-hero-v2.html`):
  - Hero: aurora mesh + grain + vignette, `viota` (Luckiest Guy, cyan "o"), wink tagline, two chamfer buttons that press into their shadow, drifting real cards, top bar.
  - **Scroll down** → the footer is reachable (chrome scroll container working) with cyan links.
  - `Play vs AI` opens the modal; Start begins a local game. `Play with friends` → lobby. `how to play` → "Rules coming soon".
  - Tab through: focus ring is visible on the buttons (inset ring, not clipped).
  - Resize to 320/375px: hero stacks, ~3–4 cards fanned below the copy, no horizontal scroll, footer still reachable.
  - Navigate into a game (`/game/local`) → **no footer**, board unchanged / no new scroll.

- [ ] **Step 4: Deploy (per handoff §10)**

```bash
VITE_SERVER_URL=https://viota-worker.theonenonlyvj.workers.dev pnpm --filter @viota/client build
npx wrangler pages deploy packages/client/dist --project-name viota --branch=main --commit-dirty=true
```
Then load https://viota.pages.dev and re-check the hero + footer live. (Do this only after Vijay signs off on merging the branch.)

- [ ] **Step 5: Final commit / branch is ready to merge**

```bash
git status   # clean
# open a PR from worktree-redesign-landing → main, or merge per Vijay's preference
```

---

## Notes for the executor

- **Never** edit `Card.tsx`, `packages/engine`, `packages/worker`, `net/*` protocol, or `gameStore` action semantics.
- Reduced-motion, focus rings, and the chrome-only footer are correctness-ish requirements from the adversarial spec review — don't drop them to save time.
- If a shared route path or the `useLocalResumableGame` return type needs to change to accommodate the how-to-play / local-persistence agents, change it **here** and tell them — this branch owns those contracts.
