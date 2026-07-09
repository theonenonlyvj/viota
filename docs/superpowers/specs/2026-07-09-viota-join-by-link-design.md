# viota — Join-by-Link (spec)

**Date:** 2026-07-09
**Author:** Claude (with Vijay)
**Scope:** Make the shareable room URL `https://viota.pages.dev/lobby/:code` work as an **invite**
for someone who isn't in the room yet (auto-join). **Client-only** — reuses the existing
`joinOnlineGame`; no worker/engine/protocol/D1 change.

## Problem

Today `/lobby/:code` (`WaitingRoom`) only works if you already hold a local session for that room.
A friend clicking the link has no session → `WaitingRoom` **redirects them to `/`**
([WaitingRoom.tsx:45](../../packages/client/src/pages/WaitingRoom.tsx#L45)). The code in the URL is
never used to join. So the link looks shareable but only works for the host.

## Design

Put a small **gate** on `/lobby/:code`:

- **Caller already in this room** — a saved session whose `code` matches the URL `:code`
  (case-insensitive) → render `WaitingRoom` exactly as today.
- **Not in this room** — no session, or a session for a *different* room → render a **join card**
  (`JoinRoom`) for `:code`: a name field (prefilled from the last-used display name, editable) + a
  **Join room** button. On success → save the session → the gate re-renders → `WaitingRoom` mounts.
  Bad/full/already-started codes surface the server's message.

This replaces the current "bounce to home" behavior. Reuses the design system (aurora chrome,
`viota` wordmark, `.panel` card, `.field`, `Button`, `.ghost-btn`), matching the waiting room.

### Behavior (reuse existing net layer — no new calls)
- Join → `joinOnlineGame(SERVER_URL, { code, displayName })` (already trims/uppercases the code,
  quick-auths a fresh ghost account, resolves the code, claims a seat) → `saveSession(...)` →
  `onJoined()`. Same call the Lobby's "Join a room" uses.
- Errors surfaced verbatim from `joinOnlineGame`: `No open game found for code …` (unknown),
  `That room is full or already started` (409), else `Failed to join room`.
- Name required (`Name is required`); prefilled from `getDisplayName()` (blank if it's the default
  `'Player'`); Enter submits.
- A **Back to Home** ghost button (`→ /`).

### Architecture / files
- **New `pages/Room.tsx`** — the gate. Reads `:code`; `inThisRoom = session?.gameId && session.code
  (upper) === code (upper)`; renders `<WaitingRoom/>` or `<JoinRoom code onJoined/>`. A `useState`
  bump on `onJoined` forces the re-check so `WaitingRoom` mounts after a successful join.
- **New `components/JoinRoom.tsx`** — the join card (+ test).
- **Modify `main.tsx`** — `/lobby/:code` → `<Room/>` (was `<WaitingRoom/>`); add the import.
- **Modify `main.routes.test.tsx`** — mock `./pages/Room` instead of `./pages/WaitingRoom` (the
  route now renders `Room`; footer still shows because `Room` is under `Layout`).
- **`WaitingRoom.tsx` unchanged** — the gate only mounts it when a valid session exists; keep its
  `if (!gameId) navigate('/')` as a harmless safety net.

## Accessibility
- `.field` + `Button` + `.ghost-btn` already carry clip-surviving focus rings — reuse them; add no
  clipped control without one. Name field has a placeholder; Enter submits.

## Out of scope
- Account persistence / login (the deferred **VGames account** scope).
- Any worker/engine/protocol/D1/gameStore change. `Lobby`'s own "Join a room" panel stays (typing a
  code still works); this only adds the link path.

## Testing / DoD
- `JoinRoom`: renders the code + name + Join; empty name → error, no join call; success →
  `saveSession` + `onJoined`; failure → the error message.
- `Room` gate: session matching the code → `WaitingRoom`; no session → `JoinRoom`; session for a
  *different* code → `JoinRoom`.
- `main.routes` footer test still green (mock updated to `Room`). `WaitingRoom` tests unchanged.
- Full client suite + `tsc` + build green. Client-only; deploy gated on Vijay.
