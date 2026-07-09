# viota Join-by-Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/lobby/:code` an invite that a friend (no session) can click to join, instead of bouncing them home.

**Architecture:** A small gate at `/lobby/:code` (`pages/Room.tsx`) renders the existing `WaitingRoom` when you already hold a session for that room, else a `JoinRoom` card that calls the existing `joinOnlineGame`. Client-only; no worker/engine/protocol change.

**Tech Stack:** React 18, Vite 5, react-router-dom 6, vitest + @testing-library/react + user-event. Client commands are `pnpm --filter @viota/client <script>`.

**Spec:** `docs/superpowers/specs/2026-07-09-viota-join-by-link-design.md`.

## Global Constraints

- **UI/client only.** No `packages/engine`, `packages/worker`, `net/*` protocol/logic, `gameStore`, or `Card.tsx` changes. Reuse `joinOnlineGame` / `saveSession` / `getDisplayName` as-is.
- Reuse the design system: aurora chrome (`Layout`), `viota` wordmark, `.panel`, `.field`, `Button`, `.ghost-btn`, `--text-error` — all already in `theme.css`. Add no new tokens. Every clipped interactive control already has a clip-surviving focus ring; don't add one without it.
- **`WaitingRoom.tsx` stays unchanged.** The gate only mounts it when a valid session exists.
- Button label `Join room`; placeholder `Your name`; error `Name is required`; join errors surfaced verbatim from `joinOnlineGame`.
- Baseline before Task 1: **270 client tests green**, tsc clean, build clean. `test` = `vitest run` (the `-- <name>` filter does not narrow under pnpm — run the whole suite).

## File structure

- Create `packages/client/src/components/JoinRoom.tsx` (+ test) — the join card.
- Create `packages/client/src/pages/Room.tsx` (+ test) — the gate.
- Modify `packages/client/src/main.tsx` — `/lobby/:code` → `<Room/>` (drop the direct `WaitingRoom` import/route).
- Modify `packages/client/src/main.routes.test.tsx` — mock `./pages/Room` instead of `./pages/WaitingRoom`.

---

### Task 1: JoinRoom card

**Files:**
- Create: `packages/client/src/components/JoinRoom.tsx`
- Test: `packages/client/src/components/JoinRoom.test.tsx`

**Interfaces:**
- Produces: `export default function JoinRoom({ code, onJoined }: { code: string; onJoined: () => void }): JSX.Element`. Joins via `joinOnlineGame(SERVER_URL, { code, displayName })`, `saveSession(...)`, then calls `onJoined()`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/components/JoinRoom.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import JoinRoom from './JoinRoom'

const joinOnlineGame = vi.fn()
const saveSession = vi.fn()
vi.mock('../net/lobby', () => ({ joinOnlineGame: (...a: unknown[]) => joinOnlineGame(...a) }))
vi.mock('../net/session', () => ({ saveSession: (...a: unknown[]) => saveSession(...a) }))
vi.mock('../net/identity', () => ({ getDisplayName: () => 'Player' }))
vi.mock('../net/config', () => ({ serverUrl: () => 'http://x' }))

function renderJoin(onJoined = vi.fn()) {
  render(<MemoryRouter><JoinRoom code="ABC123" onJoined={onJoined} /></MemoryRouter>)
  return onJoined
}

beforeEach(() => { joinOnlineGame.mockReset(); saveSession.mockReset() })

test('shows the room code, a name field, and a Join button', () => {
  renderJoin()
  expect(screen.getByText('ABC123')).toBeInTheDocument()
  expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument()
  expect(screen.getByText('Join room')).toBeInTheDocument()
})

test('requires a name', async () => {
  renderJoin()
  await userEvent.click(screen.getByText('Join room'))
  expect(await screen.findByText(/Name is required/)).toBeInTheDocument()
  expect(joinOnlineGame).not.toHaveBeenCalled()
})

test('joins with the URL code + typed name, saves the session, signals onJoined', async () => {
  joinOnlineGame.mockResolvedValue({ gameId: 'g9', code: 'ABC123', mySeat: 2, players: ['a', 'b', 'c'] })
  const onJoined = renderJoin()
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Bob')
  await userEvent.click(screen.getByText('Join room'))
  await waitFor(() => expect(joinOnlineGame).toHaveBeenCalledWith('http://x', { code: 'ABC123', displayName: 'Bob' }))
  expect(saveSession).toHaveBeenCalledWith({ gameId: 'g9', code: 'ABC123', mySeat: 2, players: ['a', 'b', 'c'] })
  expect(onJoined).toHaveBeenCalled()
})

test('surfaces a join error and does not signal onJoined', async () => {
  joinOnlineGame.mockRejectedValue(new Error('That room is full or already started'))
  const onJoined = renderJoin()
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Bob')
  await userEvent.click(screen.getByText('Join room'))
  expect(await screen.findByText(/full or already started/)).toBeInTheDocument()
  expect(onJoined).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @viota/client test`. Expected: the JoinRoom tests FAIL (cannot find `./JoinRoom`).

- [ ] **Step 3: Implement**

Create `packages/client/src/components/JoinRoom.tsx`:
```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { serverUrl } from '../net/config'
import { joinOnlineGame } from '../net/lobby'
import { getDisplayName } from '../net/identity'
import { saveSession } from '../net/session'
import Button from './Button'

const SERVER_URL = serverUrl()

/** Shareable-link join card shown at /lobby/:code when the visitor isn't yet in
 *  the room. On success saves the session + calls onJoined so the Room gate
 *  swaps in the WaitingRoom. Reuses joinOnlineGame — no new network. */
export default function JoinRoom({ code, onJoined }: { code: string; onJoined: () => void }) {
  const initial = getDisplayName()
  const [name, setName] = useState(initial === 'Player' ? '' : initial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function handleJoin() {
    if (!name.trim()) { setError('Name is required'); return }
    setError(''); setBusy(true)
    try {
      const joined = await joinOnlineGame(SERVER_URL, { code, displayName: name.trim() })
      saveSession({ gameId: joined.gameId, code: joined.code, mySeat: joined.mySeat, players: joined.players })
      onJoined()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join room')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, padding: '84px 20px 48px' }}>
      <h1 style={{ fontFamily: 'Luckiest Guy', fontSize: 'clamp(36px, 7vw, 56px)', color: '#fff', textShadow: '0 0 42px rgba(34,211,238,.4)' }}>
        vi<span style={{ color: 'var(--brand-cyan)' }}>o</span>ta
      </h1>
      <div className="panel" style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
        <p className="panel__label" style={{ textAlign: 'center' }}>You're invited</p>
        <div style={{ fontFamily: 'Luckiest Guy', fontSize: 40, color: 'var(--brand-cyan)', letterSpacing: 8, textShadow: '0 0 28px rgba(34,211,238,.5)' }}>{code}</div>
        <input className="field" style={{ margin: '20px 0 0' }} placeholder="Your name" value={name}
          onChange={(e) => setName(e.target.value)} maxLength={24}
          onKeyDown={(e) => { if (e.key === 'Enter') handleJoin() }} />
        {error && <p style={{ color: 'var(--text-error)', fontSize: 13, margin: '10px 0 0' }}>{error}</p>}
        <div style={{ marginTop: 16 }}>
          <Button variant="primary" disabled={busy} onClick={handleJoin}>Join room</Button>
        </div>
      </div>
      <button className="ghost-btn" onClick={() => navigate('/')}>Back to Home</button>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @viota/client test` (JoinRoom green; full suite = 270 + 4 new = 274). Then `pnpm --filter @viota/client exec tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/JoinRoom.tsx packages/client/src/components/JoinRoom.test.tsx
git commit -m "feat(client): JoinRoom card (shareable-link join)"
```

---

### Task 2: Room gate + route wiring

**Files:**
- Create: `packages/client/src/pages/Room.tsx`
- Test: `packages/client/src/pages/Room.test.tsx`
- Modify: `packages/client/src/main.tsx`
- Modify: `packages/client/src/main.routes.test.tsx`

**Interfaces:**
- Consumes: `JoinRoom` (Task 1), `WaitingRoom`, `loadSession`, `useParams`.
- Produces: `export default function Room(): JSX.Element` — renders `WaitingRoom` if the saved session's code matches `:code` (case-insensitive), else `JoinRoom`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/pages/Room.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi } from 'vitest'

const loadSession = vi.fn()
vi.mock('../net/session', () => ({ loadSession: () => loadSession() }))
vi.mock('./WaitingRoom', () => ({ default: () => <div>waiting-room</div> }))
vi.mock('../components/JoinRoom', () => ({ default: ({ code }: { code: string }) => <div>join {code}</div> }))

import Room from './Room'

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/lobby/:code" element={<Room />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => loadSession.mockReset())

test('shows the waiting room when the session is for this room', () => {
  loadSession.mockReturnValue({ gameId: 'g1', code: 'ABC123', mySeat: 0, players: ['me'] })
  at('/lobby/ABC123')
  expect(screen.getByText('waiting-room')).toBeInTheDocument()
})

test('shows the join card (with the code) when there is no session', () => {
  loadSession.mockReturnValue(null)
  at('/lobby/ABC123')
  expect(screen.getByText(/join ABC123/i)).toBeInTheDocument()
})

test('shows the join card when the session is for a different room', () => {
  loadSession.mockReturnValue({ gameId: 'g2', code: 'ZZZ999', mySeat: 0, players: ['me'] })
  at('/lobby/ABC123')
  expect(screen.getByText(/join ABC123/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @viota/client test`. Expected: Room tests FAIL (cannot find `./Room`).

- [ ] **Step 3: Implement the gate**

Create `packages/client/src/pages/Room.tsx`:
```tsx
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { loadSession } from '../net/session'
import WaitingRoom from './WaitingRoom'
import JoinRoom from '../components/JoinRoom'

/** Gate for /lobby/:code. If the caller already holds a session for THIS room,
 *  show the waiting room; otherwise show the join card (the shareable-link path).
 *  onJoined bumps local state so the next render re-reads the session and mounts
 *  the waiting room. */
export default function Room() {
  const { code } = useParams<{ code: string }>()
  const [, forceRecheck] = useState(0)
  const session = loadSession()
  const inThisRoom =
    !!session?.gameId && (session.code ?? '').toUpperCase() === (code ?? '').toUpperCase()

  if (inThisRoom) return <WaitingRoom />
  return <JoinRoom code={(code ?? '').toUpperCase()} onJoined={() => forceRecheck((n) => n + 1)} />
}
```

- [ ] **Step 4: Wire the route**

In `packages/client/src/main.tsx`: remove `import WaitingRoom from './pages/WaitingRoom'`, add `import Room from './pages/Room'`, and change the route element from `<WaitingRoom />` to `<Room />`:
```tsx
        <Route path="/lobby/:code" element={<Room />} />
```

In `packages/client/src/main.routes.test.tsx`: replace the WaitingRoom mock with a Room mock (the route now renders `Room`, which stays inside `Layout`, so the footer still shows). Change:
```tsx
vi.mock('./pages/WaitingRoom', () => ({ default: () => <div>waiting</div> }))
```
to:
```tsx
vi.mock('./pages/Room', () => ({ default: () => <div>room</div> }))
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @viota/client test` — Room tests + main.routes footer tests green; full suite green (270 + 4 JoinRoom + 3 Room = 277). Then `pnpm --filter @viota/client exec tsc --noEmit` — clean (confirm no unused `WaitingRoom` import remains in `main.tsx`).

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/pages/Room.tsx packages/client/src/pages/Room.test.tsx packages/client/src/main.tsx packages/client/src/main.routes.test.tsx
git commit -m "feat(client): /lobby/:code gate — join card for non-members (shareable link)"
```

---

### Task 3: Verify + build

**Files:** none.

- [ ] **Step 1:** `pnpm --filter @viota/client test` → all green (fix any regression without weakening).
- [ ] **Step 2:** `pnpm --filter @viota/client exec tsc --noEmit` clean, then `VITE_SERVER_URL=https://viota-worker.theonenonlyvj.workers.dev pnpm --filter @viota/client build` clean.
- [ ] **Step 3 (visual, real browser):** `pnpm --filter @viota/client dev`; open `/lobby/TESTCODE` in a fresh/incognito window (no session) → the Join card shows the code + name + Join + Back to Home, focus rings visible; a bad code shows an error. Opening a room you host still shows the waiting room. (Deploy only after Vijay signs off.)
- [ ] **Step 4:** `git status` clean; hand back for the final review + Vijay's merge/deploy call.

## Notes for the executor
- Never touch engine/worker/net protocol/gameStore/Card/WaitingRoom.
- Keep labels/placeholders exact (`Join room`, `Your name`, `Name is required`).
- The gate uppercases the code before display/join; `joinOnlineGame` also trims/uppercases.
