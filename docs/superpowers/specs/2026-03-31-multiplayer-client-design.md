# Multiplayer Client — Design Spec

## Overview

Add online multiplayer to the Viota client. Players create/join rooms via a lobby, connect over WebSocket to the existing server, and play using the same Board/Hand/Card/Cell components as single-player. Guest-only authentication (no accounts). Room code sharing for discovery (no room browser).

## Lobby Flow

### Routes

- `/lobby` — Create or join a room
- `/lobby/:code` — Waiting room for a specific room
- `/game/online` — Online game (WebSocket-driven)

### Create Room

1. Player enters their name
2. Client POSTs `/rooms` → gets room code
3. Client POSTs `/rooms/:code/join` with name → gets JWT + playerIndex
4. JWT and roomCode stored in sessionStorage
5. Navigate to `/lobby/:code`

### Join Room

1. Player enters room code + name
2. Client POSTs `/rooms/:code/join` → gets JWT + playerIndex
3. JWT and roomCode stored in sessionStorage
4. Navigate to `/lobby/:code`

### Waiting Room (`/lobby/:code`)

- Opens WebSocket connection to receive `playerJoined` messages
- Shows player list (updates in real-time)
- Host (playerIndex 0) sees configuration:
  - **Disconnect timeout**: 30s / 1min / **2min (default)** / 5min
- Host sees "Start Game" button (enabled when 2–4 players present)
- Non-host players see "Waiting for host to start..."
- On `gameStarted` WebSocket message → all clients navigate to `/game/online`
- Room code displayed prominently for sharing

## WebSocket Connection Layer

New file: `packages/client/src/net/connection.ts`

- `connect(serverUrl, roomCode, token)` → returns `{ send, close, onMessage, status }`
- URL format: `ws://<server>/rooms/:code?token=<jwt>`
- Auto-reconnect on unexpected close: exponential backoff (1s, 2s, 4s, max 10s), up to 5 retries
- Connection status: `'connecting' | 'connected' | 'disconnected' | 'reconnecting'`
- Server URL from `VITE_SERVER_URL` env var, defaults to `window.location.origin` (dev: `http://localhost:3000`)
- Pure transport layer — no game logic, just sends/receives JSON

## Store Adaptation

New store field: `mode: 'local' | 'online'`

### Online-specific state

| Field | Type | Purpose |
|-------|------|---------|
| `mode` | `'local' \| 'online'` | Determines action behavior |
| `connectionStatus` | connection state string | UI indicator |
| `playerNames` | `string[]` | All player names |
| `myIndex` | `number` | This player's index |
| `turnTimer` | `number` | Seconds since turn started (counts up) |
| `disconnectVote` | vote state or null | Active vote tracking |
| `handSizes` | `number[]` | Other players' hand sizes |

### Action behavior by mode

| Action | Local mode | Online mode |
|--------|-----------|-------------|
| `confirmPlay()` | Calls `applyPlay` locally | Sends `{ type: 'play', placements }` via WS |
| `pass()` | Calls `applyPass` locally | Sends `{ type: 'pass', trades, tradeOrder }` via WS |
| `confirmRecycle()` | Calls `applyWildRecycle` locally | Sends `{ type: 'wildRecycle', wildPosition, replacement }` via WS |

### Incoming WebSocket messages → store updates

| Message | Store effect |
|---------|-------------|
| `welcome` | Set `myIndex`, `playerNames`, restore view if reconnecting |
| `gameStarted` | Initialize grid/hand/scores from `ClientView` |
| `state` | Replace grid/myHand/handSizes/scores/turnIndex, reset turnTimer |
| `gameOver` | Set `phase: 'game-over'`, store winner + final scores |
| `playerJoined` | Add to `playerNames` |
| `playerDisconnected` | Show disconnect banner |
| `playerReconnected` | Dismiss disconnect banner |
| `voteStart` | Set `disconnectVote` state |
| `aiTakeover` | Update banner, clear vote state |
| `voteCancelled` | Clear vote state |

### Hand data in online mode

Server sends `ClientView` with `myHand` (only this player's cards) and `handSizes` (array of hand counts). The store populates `hands[myIndex]` with `myHand` and stores `handSizes` separately. Hand component already only renders `hands[humanIndex]`.

## Disconnect Vote System

### Server changes (`packages/server/src/wsHandler.ts`)

Replace the hardcoded 5-minute AI fill-in timer:

1. Room stores `disconnectTimeout` (configurable, default 120s)
2. Server needs new field on room creation: `POST /rooms` accepts optional `{ disconnectTimeout }` in body
3. On player disconnect:
   - Start timer for `disconnectTimeout` seconds
   - When timer fires: broadcast `{ type: 'voteStart', disconnectedPlayer }` to connected players
4. New inbound message: `{ type: 'vote', choice: 'wait' | 'easy' | 'expert' }`
5. Server tallies votes from all connected players:
   - **Wait wins** (majority, or ties with any AI) → restart disconnect timer, will re-vote after timeout
   - **AI option wins** → trigger AI fill-in at that difficulty, broadcast `{ type: 'aiTakeover', playerIndex, difficulty }`
   - **AI options tie** → pick the harder difficulty (`expert` > `easy`)
6. On reconnect before vote completes → cancel timer/vote, broadcast `{ type: 'voteCancelled' }`

### Difficulty ordering for tiebreaker

Uses engine's `Difficulty` type ordering: `easy < medium < hard < expert`. When we add Medium/Hard later, they slot in naturally.

### Client UI: `VoteBanner.tsx`

- Renders at the top of the board area when `disconnectVote` is active
- Shows: "[Player name] disconnected" + vote buttons: **Wait** / **AI Easy** / **AI Expert**
- Tally updates as votes arrive ("2/3 voted")
- On `aiTakeover` → banner becomes informational: "AI (Easy) playing for [name]"
- On `voteCancelled` or reconnect → banner disappears

## OnlineGame Page

New file: `packages/client/src/pages/OnlineGame.tsx`

- On mount: reads `roomCode` and `token` from sessionStorage, opens WebSocket
- On `welcome`: sets `myIndex`, `playerNames`
- On `gameStarted`: initializes game view
- Renders same components: `TopBar`, `Board`, `Hand`, `PassTradeModal`, plus `VoteBanner`
- On unmount: closes WebSocket

### Reused components (no changes needed)

- `Board.tsx` — reads from store, no changes
- `Hand.tsx` — reads from store, no changes
- `Card.tsx` — no changes
- `Cell.tsx` — no changes
- `PassTradeModal.tsx` — no changes

### TopBar adjustments for online mode

- Player names instead of "You" / "AI" labels
- Turn timer display (MM:SS counting up, non-enforced)
- Connection status dot: green (connected), yellow (reconnecting), red (disconnected)

### Game over for online

- Shows winner by name
- "Play Again" returns to `/lobby/:code` (not instant restart)
- "Home" goes to `/`

## Turn Timer

- Non-enforced — purely visual, counts up from 0 each turn
- Stored as `turnTimer: number` in the store, incremented by a `setInterval` (1s)
- Reset to 0 when `turnIndex` changes (on incoming `state` message)
- Displayed in TopBar as `MM:SS`
- Future: add configurable enforcement (auto-pass after time limit)

## Server URL Configuration

- `VITE_SERVER_URL` env var for Vite build
- Default: `window.location.origin` (works when client and server are co-deployed)
- Dev default: `http://localhost:3000`
- WebSocket URL derived by replacing `http` with `ws` in the server URL

## Out of Scope

- Account registration/login (guest-only for now)
- Room browser / public room listing
- Turn time enforcement (visual timer only)
- Spectator mode
- Chat
- Medium/Hard AI difficulties in vote options (Easy + Expert only)
