# viota Lobby + Waiting-Room Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the two "play with friends" chrome pages — the Lobby (`/lobby`) and the Waiting Room (`/lobby/:code`) — to the established Neon-Night design system, and make the Lobby friends-only (drop the solo Play-vs-AI button).

**Architecture:** Reuse the existing design system (`theme.css` tokens/classes + the `Button` primitive). Add a few additive `theme.css` classes (`.field`, `.panel`, `.seat-row`, `.ghost-btn`) with clip-surviving focus rings, then rebuild `Lobby.tsx` as two panels (Create / Join) and restyle `WaitingRoom.tsx`. No engine/worker/protocol/gameStore/Card/modal changes. Client-only.

**Tech Stack:** React 18, Vite 5, react-router-dom 6, zustand 4, vitest + @testing-library/react + user-event. pnpm monorepo — client commands are `pnpm --filter @viota/client <script>`.

**Spec:** `docs/superpowers/specs/2026-07-09-viota-lobby-redesign-design.md` (read it — every task traces to it).

## Global Constraints

- **UI only.** Do NOT touch `packages/engine`, `packages/worker`, the `net/*` protocol/logic, `gameStore`, `Card.tsx`, or the landing modals. Restyle components; never change what they call or the network contract. (handoff §8)
- **Reuse the design system; add no new tokens.** New CSS is only small additive classes in `theme.css`. Reuse existing tokens (`--brand-cyan`, `--text-hi/body/muted`, `--chamfer`, deepened cyan/coral), the `Button` component, and the `.modal-pill` (+`:focus-visible`) segmented-selector pattern.
- **Every chamfer/clipped interactive control MUST have a clip-surviving `:focus-visible` ring** (`box-shadow`, not the UA outline — the clip removes it). This was the landing slice's one merge-blocker; do not repeat it.
- **Preserve behavior byte-for-byte.** Lobby: `createOnlineRoom` / `joinOnlineGame` / name-required / AI-takeover / ResumeStrip. Waiting room: `fetchRoom` poll + nudge, host-only Start, roster, AI-takeover display, Leave. Keep button labels **`Create Room`**, **`Join Room`**, **`Start Game`**, placeholder **`Your name`** / **`Room code`** verbatim (tests assert them).
- **Players selector = total seats 2/3/4, default 2** → `createOnlineRoom({ playerCount })` (replaces the old "Opponents 1/2/3" which passed `opponents+1`).
- Client commands are pnpm-scoped. Baseline before Task 1: **197 tests green**, tsc clean, build clean.

## File structure

- Modify `packages/client/src/theme.css` — add the slice-2 classes (`.field`, `.panel`, `.seat-row`, `.ghost-btn` + focus rings).
- Rewrite `packages/client/src/pages/Lobby.tsx` — two panels (Create / Join), friends-only.
- Update `packages/client/src/pages/Lobby.test.tsx` — drop the solo assertions; keep create/join/name/AI-takeover; add a Players-selector test.
- Restyle `packages/client/src/pages/WaitingRoom.tsx` — design system; `height`→`minHeight`.
- Update `packages/client/src/pages/WaitingRoom.test.tsx` — one assertion (disabled Start → query by role).

---

### Task 1: theme.css — lobby/waiting-room classes

**Files:**
- Modify: `packages/client/src/theme.css` (append the new block)

**Interfaces:**
- Produces CSS classes consumed by Tasks 2–3: `.field` (+`:focus-visible`), `.panel`, `.panel__label`, `.panel__sublabel`, `.seat-row`, `.seat-row--open`, `.seat-row__tag`, `.ghost-btn` (+`:hover`,`:focus-visible`).

- [ ] **Step 1: Append the classes**

Append to `packages/client/src/theme.css`:
```css

/* --- lobby / waiting-room (slice 2) --- */
.field { width: 100%; background: rgba(255,255,255,.06); color: var(--text-body);
  border: 1.5px solid rgba(255,255,255,.16); border-radius: 10px; padding: 12px 16px;
  font-family: 'Fredoka'; font-weight: 500; font-size: 15px; }
.field::placeholder { color: var(--text-muted); opacity: .8; }
.field:focus-visible { outline: none; border-color: var(--brand-cyan); box-shadow: 0 0 0 3px rgba(34,211,238,.25); }

.panel { background: #140a1e; border: 1px solid rgba(255,255,255,.12); clip-path: var(--chamfer); padding: 22px; }
.panel__label { margin: 0 0 14px; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: var(--text-muted); font-weight: 600; }
.panel__sublabel { margin: 16px 0 8px; font-size: 12px; color: var(--text-muted); }

.seat-row { display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.14); clip-path: var(--chamfer); padding: 9px 14px;
  color: var(--text-body); font-family: 'Fredoka'; font-size: 14px; }
.seat-row--open { opacity: .5; }
.seat-row__tag { margin-left: auto; font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .08em; }

.ghost-btn { background: transparent; border: 1px solid rgba(255,255,255,.2); color: var(--text-muted);
  border-radius: 8px; padding: 8px 22px; font-family: 'Fredoka'; font-weight: 500; font-size: 13px; cursor: pointer; }
.ghost-btn:hover { color: var(--text-body); border-color: rgba(255,255,255,.35); }
.ghost-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,211,238,.3); }
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @viota/client build`
Expected: builds clean (CSS parses). Then `pnpm --filter @viota/client test` — still **197 passing** (no component consumes the classes yet, so nothing changes).

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/theme.css
git commit -m "feat(client): lobby/waiting-room theme classes (field, panel, seat-row, ghost-btn)"
```

---

### Task 2: Lobby — two panels, friends-only

**Files:**
- Modify (rewrite): `packages/client/src/pages/Lobby.tsx`
- Modify: `packages/client/src/pages/Lobby.test.tsx`

**Interfaces:**
- Consumes: `Button` (primary/secondary), `.field`/`.panel`/`.modal-pill` classes (Task 1 + existing), `createOnlineRoom`/`joinOnlineGame` from `../net/lobby`, `claimGhostGames`, `saveSession`, `serverUrl`, `ResumeStrip`, `useNavigate`.
- Produces: default `Lobby` — friends-only create/join. NO solo path (no `createOnlineGame` import).

- [ ] **Step 1: Rewrite the test (RED)**

Replace `packages/client/src/pages/Lobby.test.tsx` with:
```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Lobby from './Lobby'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const createOnlineRoom = vi.fn()
const joinOnlineGame = vi.fn()
const myGames = vi.fn().mockResolvedValue([])
vi.mock('../net/lobby', () => ({
  createOnlineRoom: (...a: unknown[]) => createOnlineRoom(...a),
  joinOnlineGame: (...a: unknown[]) => joinOnlineGame(...a),
  myGames: (...a: unknown[]) => myGames(...a),
}))
vi.mock('../net/ghost', () => ({ claimGhostGames: vi.fn().mockResolvedValue({ claimed: 0 }) }))

beforeEach(() => {
  mockNavigate.mockClear()
  createOnlineRoom.mockReset()
  joinOnlineGame.mockReset()
  sessionStorage.clear()
})

test('renders name input, Players selector, Create/Join — and NO solo Play-vs-AI', () => {
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument()
  expect(screen.getByText('Players')).toBeInTheDocument()
  expect(screen.getByText('Create Room')).toBeInTheDocument()
  expect(screen.getByText('Join Room')).toBeInTheDocument()
  expect(screen.queryByText('Play vs AI')).not.toBeInTheDocument()
})

test('Create Room creates a multiplayer room and navigates to the waiting room', async () => {
  createOnlineRoom.mockResolvedValue({ gameId: 'g2', code: 'ROOMED', mySeat: 0, players: ['Alice', 'Open'] })
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Alice')
  await userEvent.click(screen.getByText('Create Room'))
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/lobby/ROOMED'))
  expect(sessionStorage.getItem('viota_online_session')).toContain('g2')
})

test('Create Room defaults to 2 players and the 1-min AI takeover', async () => {
  createOnlineRoom.mockResolvedValue({ gameId: 'g2', code: 'ROOMED', mySeat: 0, players: ['Alice', 'Open'] })
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Alice')
  await userEvent.click(screen.getByText('Create Room'))
  await waitFor(() => expect(createOnlineRoom).toHaveBeenCalled())
  expect(createOnlineRoom.mock.calls[0]![1]).toMatchObject({ playerCount: 2, aiTakeoverMs: 60000 })
})

test('the Players selector sets the room size', async () => {
  createOnlineRoom.mockResolvedValue({ gameId: 'g2', code: 'ROOMED', mySeat: 0, players: ['A','B','C','D'] })
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Alice')
  await userEvent.click(screen.getByRole('button', { name: '4' }))
  await userEvent.click(screen.getByText('Create Room'))
  await waitFor(() => expect(createOnlineRoom).toHaveBeenCalled())
  expect(createOnlineRoom.mock.calls[0]![1]).toMatchObject({ playerCount: 4 })
})

test('the AI-takeover picker sends the chosen value (Wait for me -> 0)', async () => {
  createOnlineRoom.mockResolvedValue({ gameId: 'g2', code: 'ROOMED', mySeat: 0, players: ['Alice', 'Open'] })
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Alice')
  await userEvent.click(screen.getByText('Wait for me'))
  await userEvent.click(screen.getByText('Create Room'))
  await waitFor(() => expect(createOnlineRoom).toHaveBeenCalled())
  expect(createOnlineRoom.mock.calls[0]![1]).toMatchObject({ aiTakeoverMs: 0 })
})

test('a create failure surfaces an error and does not navigate', async () => {
  createOnlineRoom.mockRejectedValue(new Error('boom'))
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Alice')
  await userEvent.click(screen.getByText('Create Room'))
  await waitFor(() => expect(screen.getByText(/Cannot reach server/)).toBeInTheDocument())
  expect(mockNavigate).not.toHaveBeenCalled()
})

test('a create requires a name', async () => {
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.click(screen.getByText('Create Room'))
  expect(await screen.findByText(/Name is required/)).toBeInTheDocument()
  expect(createOnlineRoom).not.toHaveBeenCalled()
})

test('Join Room joins by code and navigates to the waiting room', async () => {
  joinOnlineGame.mockResolvedValue({ gameId: 'g7', code: 'ABCDEF', mySeat: 1, players: ['Alice', 'Bob'] })
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Bob')
  await userEvent.type(screen.getByPlaceholderText('Room code'), 'ABCDEF')
  await userEvent.click(screen.getByText('Join Room'))
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/lobby/ABCDEF'))
  expect(sessionStorage.getItem('viota_online_session')).toContain('g7')
})

test('a join failure surfaces the error message', async () => {
  joinOnlineGame.mockRejectedValue(new Error('No open game found for code ZZZZZZ'))
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Bob')
  await userEvent.type(screen.getByPlaceholderText('Room code'), 'ZZZZZZ')
  await userEvent.click(screen.getByText('Join Room'))
  await waitFor(() => expect(screen.getByText(/No open game found/)).toBeInTheDocument())
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @viota/client test` (the `-- <name>` filter does not narrow under pnpm; run the whole suite and read the Lobby results). Expected: the new Lobby tests FAIL against the old Lobby (it still shows "Play vs AI"/"Opponents", lacks the Players-role button, etc.).

- [ ] **Step 3: Rewrite `Lobby.tsx` (GREEN)**

Replace `packages/client/src/pages/Lobby.tsx` with:
```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { serverUrl } from '../net/config'
import { createOnlineRoom, joinOnlineGame } from '../net/lobby'
import { claimGhostGames } from '../net/ghost'
import { saveSession } from '../net/session'
import Button from '../components/Button'
import ResumeStrip from '../components/ResumeStrip'

const SERVER_URL = serverUrl()

/** AI-takeover patience for a dropped player. `0` = "wait for me" (never cover). */
const AI_TAKEOVER_OPTIONS: { label: string; value: number }[] = [
  { label: '30 sec', value: 30000 },
  { label: '1 min', value: 60000 },
  { label: '2 min', value: 120000 },
  { label: '5 min', value: 300000 },
  { label: 'Wait for me', value: 0 },
]

const pill = (active: boolean): React.CSSProperties => ({
  background: active ? 'rgba(34,211,238,.18)' : 'rgba(255,255,255,.06)',
  border: active ? '1.5px solid var(--brand-cyan)' : '1.5px solid rgba(255,255,255,.2)',
  color: '#fff', clipPath: 'var(--chamfer)', padding: '8px 16px', cursor: 'pointer',
  fontFamily: 'Fredoka', fontWeight: 500, fontSize: 14,
})

export default function Lobby() {
  const [name, setName] = useState('')
  const [players, setPlayers] = useState(2)          // total seats (2–4)
  const [roomCode, setRoomCode] = useState('')
  const [aiTakeoverMs, setAiTakeoverMs] = useState(60000)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function handleCreateRoom() {
    if (!name.trim()) { setError('Name is required'); return }
    setError(''); setBusy(true)
    try {
      const created = await createOnlineRoom(SERVER_URL, { displayName: name.trim(), playerCount: players, aiTakeoverMs })
      claimGhostGames(SERVER_URL).catch(() => {})
      saveSession({ gameId: created.gameId, code: created.code, mySeat: created.mySeat, players: created.players })
      navigate(`/lobby/${created.code}`)
    } catch {
      setError(`Cannot reach server at ${SERVER_URL}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleJoin() {
    if (!name.trim()) { setError('Name is required'); return }
    if (!roomCode.trim()) { setError('Room code is required'); return }
    setError(''); setBusy(true)
    try {
      const joined = await joinOnlineGame(SERVER_URL, { code: roomCode.trim().toUpperCase(), displayName: name.trim() })
      saveSession({ gameId: joined.gameId, code: joined.code, mySeat: joined.mySeat, players: joined.players })
      navigate(`/lobby/${joined.code}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join room')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: '84px 20px 48px' }}>
      <h1 style={{ fontFamily: 'Luckiest Guy', fontSize: 'clamp(44px, 8vw, 68px)', color: '#fff', letterSpacing: '.01em', textShadow: '0 0 42px rgba(34,211,238,.4)' }}>
        vi<span style={{ color: 'var(--brand-cyan)' }}>o</span>ta
      </h1>

      <input className="field" style={{ maxWidth: 360 }} placeholder="Your name" value={name} onChange={e => setName(e.target.value)} maxLength={24} />
      {error && <p style={{ color: '#ff6b6b', fontSize: 13, maxWidth: 340, textAlign: 'center' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', justifyContent: 'center', width: '100%', maxWidth: 780 }}>
        {/* CREATE */}
        <div className="panel" style={{ flex: '1 1 300px', maxWidth: 380 }}>
          <p className="panel__label">Create a room</p>
          <p className="panel__sublabel" style={{ marginTop: 0 }}>Players</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {[2, 3, 4].map(n => (
              <button key={n} className="modal-pill" aria-pressed={players === n} style={pill(players === n)} onClick={() => setPlayers(n)}>{n}</button>
            ))}
          </div>
          <p className="panel__sublabel">If someone drops, AI covers after</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {AI_TAKEOVER_OPTIONS.map(o => (
              <button key={o.value} className="modal-pill" aria-pressed={aiTakeoverMs === o.value} style={pill(aiTakeoverMs === o.value)} onClick={() => setAiTakeoverMs(o.value)}>{o.label}</button>
            ))}
          </div>
          <div style={{ marginTop: 22 }}>
            <Button variant="primary" disabled={busy} onClick={handleCreateRoom}>Create Room</Button>
          </div>
        </div>

        {/* JOIN */}
        <div className="panel" style={{ flex: '1 1 240px', maxWidth: 380, display: 'flex', flexDirection: 'column' }}>
          <p className="panel__label">Join a room</p>
          <input className="field" style={{ textTransform: 'uppercase', textAlign: 'center', letterSpacing: 6, fontSize: 16, marginBottom: 16 }} placeholder="Room code" value={roomCode} onChange={e => setRoomCode(e.target.value)} maxLength={8} />
          <Button variant="secondary" disabled={busy} onClick={handleJoin}>Join Room</Button>
        </div>
      </div>

      <ResumeStrip />

      <button className="ghost-btn" onClick={() => navigate('/')}>Back to Home</button>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @viota/client test` — the Lobby tests pass; the full suite is green (count = 197 − 1 removed solo test + 1 new name-required + 1 new Players test = 198; confirm no other regressions). Then `pnpm --filter @viota/client exec tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/pages/Lobby.tsx packages/client/src/pages/Lobby.test.tsx
git commit -m "feat(client): rebuild lobby as two-panel Create/Join (friends-only, drop solo vs-AI)"
```

---

### Task 3: Waiting Room — restyle to the system

**Files:**
- Modify: `packages/client/src/pages/WaitingRoom.tsx` (render only; ALL logic/handlers/effects UNCHANGED)
- Modify: `packages/client/src/pages/WaitingRoom.test.tsx` (one assertion)

**Interfaces:**
- Consumes: `Button` (primary), `.panel`/`.seat-row`/`.ghost-btn` classes. Everything else (`fetchRoom` poll, nudge channel, `handleStart`/`handleLeave`, `aiTakeoverLabel`, `canStart`, host logic) is unchanged.

- [ ] **Step 1: Update the one brittle test assertion (RED for that case)**

In `packages/client/src/pages/WaitingRoom.test.tsx`, the "Start is disabled" test currently does `expect(screen.getByText('Start Game')).toBeDisabled()`. Once Start becomes a `<Button>` (its label is a `<span>`), `getByText` returns the span and `.toBeDisabled()` is meaningless on it. Replace that test's assertion with a role query. Change:
```tsx
  expect(screen.getByText('Start Game')).toBeDisabled()
```
to:
```tsx
  expect(screen.getByRole('button', { name: 'Start Game' })).toBeDisabled()
```
(Leave every other test as-is — the click tests use `getByText('Start Game')`, which still works because a click on the label span bubbles to the button.)

- [ ] **Step 2: Restyle the render (GREEN)**

In `packages/client/src/pages/WaitingRoom.tsx`, add `import Button from '../components/Button'` near the other imports, and replace the JSX `return (…)` (everything from `return (` to the closing `)` — the `pill` const at the top of the component body may be deleted, it is now unused) with:
```tsx
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, padding: '84px 20px 48px' }}>
      <h1 style={{ fontFamily: 'Luckiest Guy', fontSize: 'clamp(36px, 7vw, 56px)', color: '#fff', textShadow: '0 0 42px rgba(34,211,238,.4)' }}>
        vi<span style={{ color: 'var(--brand-cyan)' }}>o</span>ta
      </h1>

      <div className="panel" style={{ width: '100%', maxWidth: 380 }}>
        <p className="panel__label" style={{ textAlign: 'center' }}>Room</p>
        <div style={{ fontFamily: 'Luckiest Guy', fontSize: 40, color: 'var(--brand-cyan)', letterSpacing: 8, textAlign: 'center', textShadow: '0 0 28px rgba(34,211,238,.5)' }}>{roomCode}</div>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6, textAlign: 'center' }}>share this code with friends</p>

        <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '18px 0 8px' }}>Players ({humanCount})</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {seats.map((s) => (
            <div key={s.seatIndex} className={`seat-row${s.ownerType === 'open' ? ' seat-row--open' : ''}`}>
              {s.ownerType === 'open' ? (
                <span>Open seat…</span>
              ) : (
                <>
                  <span>{s.displayName ?? (s.ownerType === 'ai' ? 'AI' : 'Player')}{s.seatIndex === mySeat ? ' (you)' : ''}</span>
                  {s.seatIndex === hostSeat && <span className="seat-row__tag">host</span>}
                </>
              )}
            </div>
          ))}
          {humanCount < 2 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>Waiting for more players…</p>
          )}
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 16 }}>AI takeover: {aiTakeoverLabel(aiTakeoverMs)}</p>
      </div>

      {error && <p style={{ color: '#ff6b6b', fontSize: 13 }}>{error}</p>}

      {isHost ? (
        <Button variant="primary" disabled={!canStart} onClick={handleStart}>Start Game</Button>
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: 14, fontStyle: 'italic' }}>Waiting for host to start…</p>
      )}

      <button className="ghost-btn" onClick={handleLeave}>Leave</button>
    </div>
  )
```

If the old `pill` const (`const pill: React.CSSProperties = {…}`) is now unused after this replacement, delete it to keep tsc/lint clean.

- [ ] **Step 3: Run tests + typecheck**

Run: `pnpm --filter @viota/client test` — all WaitingRoom tests green (room code, roster Alice/Bob, "AI takeover: 1 min", host sees/clicks Start, non-host waiting message, host_changed flip, open-seat confirm, not_host error, auto-nav started ×2, Leave, disabled-Start). Then `pnpm --filter @viota/client exec tsc --noEmit` — clean.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/pages/WaitingRoom.tsx packages/client/src/pages/WaitingRoom.test.tsx
git commit -m "feat(client): restyle waiting room to the design system"
```

---

### Task 4: Full verification + build

**Files:** none (verification).

- [ ] **Step 1: Full suite** — `pnpm --filter @viota/client test` → all green. Fix any regression without weakening.
- [ ] **Step 2: Typecheck + build** — `pnpm --filter @viota/client exec tsc --noEmit` clean, then `VITE_SERVER_URL=https://viota-worker.theonenonlyvj.workers.dev pnpm --filter @viota/client build` clean.
- [ ] **Step 3: Visual check (real browser)** — `pnpm --filter @viota/client dev`, open the URL, go to `/lobby`: two panels (Create / Join) on the aurora, `viota` wordmark, chamfer inputs + pills + Buttons, no solo Play-vs-AI, focus rings visible on every control (Tab through), resume strip when present, no 320px overflow. Create a room → the waiting room shows the code card, roster chips, host Start (disabled until ≥2), Leave. (Deploy only after Vijay signs off.)
- [ ] **Step 4: Branch ready** — `git status` clean; hand back to the controller for the final whole-branch review + Vijay's merge/deploy call.

---

## Notes for the executor

- Never edit `packages/engine`, `packages/worker`, `net/*` protocol, `gameStore`, `Card.tsx`, or the landing modals.
- Keep the exact labels/placeholders the tests assert (`Create Room`, `Join Room`, `Start Game`, `Your name`, `Room code`).
- Every chamfer/clipped control needs a clip-surviving `:focus-visible` ring — audit the panels' pills, the fields, the Buttons (built-in), the ghost buttons.
- The online-vs-AI mode + the modal's Local/Online toggle + real online difficulty are a SEPARATE next slice — do not touch the landing `PlayVsAiModal` here.
