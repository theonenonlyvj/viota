# Viota — App Design Spec
_Date: 2026-03-30_

## Source of Truth

The rulebook at `ref/iota_rules.txt` and its first-order principles are the sole source of truth for all game logic. Nothing in this spec may contradict them.

---

## 1. Scope

**In scope (v1):**
- Local single-player vs AI (1–4 AI opponents, difficulty Easy/Medium/Hard/Expert)
- Online multiplayer (2–4 players, room codes + optional accounts, persistent games with rejoin)

**Out of scope (future):**
- Local pass-the-phone multiplayer

---

## 2. Platform & Stack

- **Platform:** Web app (browser-based, desktop + mobile via URL)
- **Stack:** TypeScript throughout — React (client), Node.js (server)
- **Architecture:** Monorepo with three packages:

```
viota/
  packages/
    engine/     # Pure TS — all game logic, zero dependencies
    server/     # Node.js + WebSocket + REST + SQLite persistence
    client/     # React SPA
```

---

## 3. Architecture

### 3.1 Engine Package (`packages/engine`)

Pure TypeScript, no I/O, no side effects. Shared between client and server.

**Exports:**
- Data types: `Card`, `WildCard`, `RegularCard`, `Grid`, `Position`, `GameState`
- `validatePlay(grid, hand, positions[])` → `{ valid: boolean, error?: string }`
- `score(grid, newPositions[])` → `{ base: number, multipliers: number[], total: number, affectedLines: Line[] }`
- `validateWildRecycle(grid, wildPosition, handCard)` → `boolean`
- `AIAgent(difficulty: Difficulty)` — returns a move given game state

**Data models:**
```ts
type Color  = 'blue' | 'red' | 'yellow' | 'green'
type Shape  = 'triangle' | 'plus' | 'square' | 'circle'
type Num    = 1 | 2 | 3 | 4

type RegularCard = { kind: 'regular'; color: Color; shape: Shape; number: Num }
type WildCard    = { kind: 'wild' }
type Card        = RegularCard | WildCard

type Position = { x: number; y: number }
type Grid     = Map<string, Card>  // key = "x,y"
```

**Wild CSP solver:**
- Collect all lines containing at least one Wild in the affected segments
- Enumerate all 64 possible `(color, shape, number)` assignments per Wild
- Brute-force check all combinations (max 64² = 4096 for 2 Wilds) for a consistent assignment satisfying every affected line
- If no consistent assignment exists → move is invalid
- A Wild has no fixed identity until validation requires one; it must represent the same card across all lines it participates in

**Line validation:**
- A segment of 2–4 consecutive cards (no gaps) is valid if, for each of the three properties (color, shape, number), all cards are either all-same or all-different
- Any 2-card segment is always valid
- Gaps invalidate a line

**Play validation pipeline (all must pass):**
1. All played positions share the same row (fixed y) or column (fixed x)
2. The resulting segment in that row/column is contiguous — no gaps
3. At least one played card is orthogonally adjacent to an existing card on the grid
4. Every maximal contiguous segment on the board touching a newly placed card is a valid line (via Wild CSP if needed)

**Scoring:**
1. Find all maximal contiguous segments (length 2–4) that contain at least one newly placed card
2. Sum face values of all cards in those segments (Wilds = 0; a card in two lines is counted twice)
3. Apply multipliers in order:
   - ×2 for each lot (4-card line) completed this turn
   - ×2 if exactly 4 cards were played this turn
   - ×2 if this move empties the player's hand and the draw pile is already empty (game-ending bonus)

### 3.2 Server Package (`packages/server`)

Node.js. Imports `engine` for authoritative validation of every move.

**Responsibilities:**
- Room management and game state persistence
- Turn loop enforcement
- WebSocket real-time sync (ws library), HTTP polling fallback
- JWT auth (guest tokens + optional accounts)
- AI turn computation for online multiplayer games (server-side, to avoid leaking opponent hands)
- Serving the React SPA statically

**REST endpoints:**
- `POST /rooms` → create room, returns 6-char room code
- `POST /rooms/:code/join` → join as guest (name) or authenticated user
- `POST /auth/register`, `POST /auth/login` → optional account auth

**WebSocket channel:** `WS /rooms/:code`

Turn flow:
1. Client sends `{ type: 'play', positions: [...], cardIds: [...] }`
2. Server validates via `engine.validatePlay()`
3. On success: updates state, scores, draws cards, broadcasts full new state to all players
4. On failure: returns error to sender only

**Persistence:** SQLite. After every move, save: grid (JSON), draw pile order, all hands, scores, turn index, timestamps.

**Rejoin:**
- Guest: rejoin within 30-minute window using same room code + guest name
- Authenticated user: rejoin any time while game is paused
- On disconnect: player's turn is paused. After 5 minutes, an AI fills in temporarily. AI moves are permanent — the game continues normally. The disconnected player rejoins at the current game state.

**Game pause/resume:** Games persist indefinitely server-side. Players can close the browser and return later.

### 3.3 Client Package (`packages/client`)

React SPA. Imports `engine` for local validation (zero round-trips for UI feedback).

**Single-player mode:** Entire game loop runs in-browser. No server calls. AI runs in a Web Worker to avoid blocking the UI.

**Online multiplayer mode:** Client sends moves to server; server is authoritative. Local engine used only for UI feedback (highlighting valid cells, previewing scores).

---

## 4. Pages & Navigation

| Route | Description |
|-------|-------------|
| `/` | Home: New Game vs AI, Create Room, Join Room, Login/Register |
| `/game/:roomCode` | Game board (single-player uses a local-only session ID, not a real server room; online multiplayer uses a real room code) |
| `/account` | Stats and game history (authenticated users only) |

---

## 5. Game Board UI

**Visual style:** Dark Premium — dark board (`#1a1a2e`), white square cards with subtle drop shadows, vivid colored SVG shapes (circle=red, triangle=blue, plus=yellow, square=green) with thin black outlines, numbers overlaid on shapes in white bold text with black outline.

**Board:**
- Infinite scrollable/pannable grid centered on the active play area
- Zoom in/out controls
- AutoFit / Recenter button — fits the entire board in view

**Hand:**
- 4 square cards displayed at the bottom of the screen
- Cards can be reordered by drag within the hand (visual only, no game effect)

**Placement interaction:**
- **Desktop:** Drag card from hand onto a valid grid cell, OR tap/click card to select then tap/click cell to place
- **Mobile:** Tap card to select (highlight), tap valid cell to place
- Invalid cells are dimmed; valid placement cells glow
- Placed cards can be pulled back before confirming
- Up to 4 cards may be staged before confirming

**Score preview:** After staging cards, the current score for the turn is shown live before confirming.

**Confirm Play button:** Submits staged placement to server (or local engine). Score animation plays, hand replenishes.

**Pass/Trade flow:**
- Player selects 0–4 cards from hand to trade
- Player sets the order (order matters — they go to bottom of draw pile in chosen order)
- Hand refreshes with new draws

**Wild card recycle:**
- Available at the start of your turn, before placing any cards
- Player taps a Wild on the board
- Engine checks whether a card from the player's hand can legally replace it in all lines it belongs to
- If valid: the Wild is swapped to the player's hand; the hand card takes its board position
- The recycled Wild may be played later in the same turn

**Top bar:** Scores for all players, current turn indicator, draw pile count.

**Side panel (collapsible):** Turn history, pass/trade controls.

**AI turns:** Brief "AI is thinking..." animation with short artificial delay, then AI cards appear on board with highlight animation.

---

## 6. AI Difficulty Levels

All AI agents are pure functions in `engine`: they receive `(grid, hand, playedCards[])` and return a `Move`.

| Level | Behavior |
|-------|----------|
| **Easy** | Random legal move. If no play possible, pass with random card trades. |
| **Medium** | Enumerate all legal plays, pick highest-scoring move this turn. No lookahead. |
| **Hard** | Highest-scoring move + heuristics: avoid opening lot completions for opponents, prefer moves that build toward lots, avoid leaving high-value positions for the next player. |
| **Expert** | Hard heuristics + 1-ply opponent modeling: tracks played cards to infer opponent hands, evaluates best opponent reply to each candidate move, picks move that maximizes own score while minimizing best opponent response. |

---

## 7. Auth & Sessions

- **Guest play:** Ephemeral JWT tied to room code + guest name. Valid for 30 minutes after last activity.
- **Accounts:** Email + password registration. JWT access tokens. Enables persistent history and stats across sessions.
- **Both modes** support pausing and resuming games.

---

## 8. Key Invariants (from rulebook)

- Hand size is always 4 at the start of a turn unless the draw pile is empty
- No cell may hold more than one card
- All line validations including Wild CSP must be deterministic and exhaustive
- When trading on Pass, player chooses which cards and the exact order placed at bottom of draw pile
- When replenishing after Play, draw from the top of the draw pile
- Game ends when draw pile is empty AND a player plays their last card on a Play action
- That player's final turn receives the ×2 game-ending bonus in addition to all other multipliers
- Highest total score wins; no further turns after game end

---

## 9. Out of Scope for v1

- Local pass-the-phone multiplayer (designed for future addition — board state is already server-serializable)
- Spectator mode
- Rematch / lobby browser
- Push notifications for async play
- ML-based AI (all AI is heuristic/search-based)
