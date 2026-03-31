# Viota Client — Single-Player Mode Design Spec
_Date: 2026-03-31_

## Source of Truth

The app design spec at `docs/superpowers/specs/2026-03-30-viota-design.md` and the rulebook at `ref/iota_rules.txt` are the authoritative references. This spec narrows scope to the single-player client only.

---

## 1. Scope

**In scope (this spec):**
- `packages/client` React SPA — single-player mode only
- Game board: infinite pannable/zoomable/rotatable grid, card placement, scoring
- Hand management: tap/click-to-place interaction
- Pass/Trade modal
- AI opponents: Easy and Expert difficulty only
- Home screen: minimal new-game setup
- Static build deployable to any web host (no server required)

**Out of scope (future specs):**
- Online multiplayer (WebSocket to server)
- Auth, accounts, game history
- Medium and Hard AI difficulty levels
- Drag-and-drop card placement from hand to board
- Branded lobby home screen

---

## 2. Tech Stack

- **Framework:** React 18, TypeScript
- **Build:** Vite — outputs static `dist/` deployable to any static host
- **State:** Zustand
- **Routing:** React Router v6
- **Engine:** `@viota/engine` workspace package (imported directly — no network)
- **AI:** Runs in a Vite Web Worker (`{ type: 'module' }`) to keep UI non-blocking

---

## 3. File Structure

```
packages/client/
  package.json
  vite.config.ts
  index.html
  src/
    main.tsx                  # ReactDOM.createRoot, BrowserRouter
    pages/
      Home.tsx                # difficulty + opponent count → start game
      Game.tsx                # mounts board, wires store ↔ AI worker
    store/
      gameStore.ts            # Zustand store: all game state + actions
    workers/
      ai.worker.ts            # Web Worker: receives state snapshot, returns Move
    components/
      Board.tsx               # pannable/zoomable/rotatable board container
      Cell.tsx                # single grid cell (placed card or valid target)
      Card.tsx                # card visual — SVG shape + number
      Hand.tsx                # 4-card hand strip at bottom
      TopBar.tsx              # scores, draw pile, zoom/rotate controls
      PassTradeModal.tsx      # card selection + reorder for pass/trade
```

**Key boundaries:**
- `gameStore.ts` owns all game state and all mutations — components never call engine functions directly
- `Game.tsx` owns the AI Worker lifecycle (create on mount, terminate on unmount)
- `Board.tsx` owns pan/zoom/rotation as local UI state — not in the Zustand store
- `Cell.tsx` and `Hand.tsx` receive only data and callbacks — no game logic

---

## 4. Game Store

```ts
type GameStore = {
  // Game state (mirrors engine's GameState)
  grid: Map<string, Card>
  hands: Card[][]
  drawPile: Card[]
  scores: number[]
  turnIndex: number
  playedCards: RegularCard[]

  // Single-player config
  playerCount: number       // total players (1 human + N AI)
  difficulty: Difficulty    // 'easy' | 'expert'
  humanIndex: number        // always 0

  // UI state
  selectedCard: Card | null
  staged: Placement[]
  phase: 'idle' | 'placing' | 'ai-thinking' | 'game-over'
  lastScoreResult: ScoreResult | null

  // Actions
  startGame(playerCount: number, difficulty: 'easy' | 'expert'): void
  selectCard(card: Card): void
  placeCard(position: Position): void
  unstageCard(position: Position): void
  confirmPlay(): void
  pass(trades: Card[], tradeOrder: Card[]): void
  recycleWild(wildPosition: Position, replacement: RegularCard): void
  // Available at start of human turn before any staged placements.
  // Calls engine's validateWildRecycle — if valid, swaps wild from board to hand.
}
```

`staged` holds placements not yet confirmed. Valid cells are computed synchronously from `staged` + `selectedCard` using `validatePlay` — no debouncing needed at this board size.

---

## 5. Board Interaction

**Tap/click placement flow:**
1. Click a hand card → `selectCard(card)` → card highlighted yellow
2. Valid placement cells computed: empty cells orthogonally adjacent to existing cards (or `{0,0}` if grid is empty), filtered by `validatePlay`
3. Valid cells glow green; all other empty cells dimmed
4. Click a valid cell → `placeCard(position)` → card added to `staged`, appears on board with yellow border
5. Up to 4 cards may be staged; valid cells recompute after each placement
6. Click a staged card on the board → `unstageCard(position)` → card returns to hand
7. "Confirm Play" active once ≥1 card staged

**Drag-and-drop:** Out of scope for v1. Documented as a future enhancement.

---

## 6. Board Pan / Zoom / Rotate

Pan, zoom, and rotation are local state in `Board.tsx` (not in the Zustand store).

CSS transform applied to the card container:
```css
transform: translate(panX px, panY px) scale(zoom) rotate(rotation deg)
```

| Control | Behaviour |
|---------|-----------|
| Click-drag | Pan |
| Scroll wheel | Zoom |
| One-finger drag (touch) | Pan |
| Pinch (touch) | Zoom |
| `−` / `+` buttons | Zoom step ±0.25, clamped 0.5–2.0 |
| `↻` / `↺` buttons | Rotate 90° CW / CCW (values: 0, 90, 180, 270) |
| `⊞` AutoFit | Fits all cards in viewport, resets rotation to 0 |

---

## 7. Visual Style

Matches the app design spec (Section 5):

- Board background: `#1a1a2e`, dot-grid overlay
- Top/bottom bars: `#12122a`
- Cards: white, rounded corners, subtle drop shadow
- Shapes: circle = red (`#ef4444`), triangle = blue (`#3b82f6`), plus = yellow (`#eab308`), square = green (`#22c55e`) — SVG with thin black outline, number overlaid bottom-right
- Wild card: purple gradient background, white ★
- Selected / staged card border: `#facc15` (yellow)
- Valid placement cell: dashed green border + glow (`#4ade80`)
- Score preview badge: shown above board while cards staged

---

## 8. Pass / Trade Modal

Opened by "Pass / Trade" button. Steps:

1. Modal shows all 4 hand cards; tap to toggle which to trade (0–4 selectable)
2. Selected cards appear in a "Trade order" row — drag to reorder within the row (order matters for draw pile placement)
3. "Confirm Pass" applies `pass(trades, tradeOrder)` in the store; modal closes; turn advances

Drag-to-reorder within the trade order row is included in v1 (simple fixed-size list, max 4 items — distinct from the deferred full board drag-and-drop).

---

## 9. AI Worker & Turn Loop

`Game.tsx` creates one `ai.worker.ts` on mount (Vite `{ type: 'module' }` worker).

Turn loop after each human move:
1. Store checks `turnIndex` — if AI player, sets `phase = 'ai-thinking'`
2. Store posts serializable state snapshot to Worker (`Map` → `Array` for structured clone)
3. Worker calls `AIAgent(difficulty)(state, playerIndex)`, posts `Move` back
4. Store receives move, applies via `applyPlay` or `applyPass`, advances `turnIndex`
5. If next turn is also AI, repeat from step 2 with 600 ms artificial delay
6. When `turnIndex === humanIndex`, sets `phase = 'idle'`

**Game over:** `applyPlay` returns `gameOver: true` → `phase = 'game-over'` → modal shows final scores + "Play Again" (calls `startGame` with same config).

---

## 10. Home Screen

Route `/`:

- Title: "Viota"
- AI opponents: 1 / 2 / 3 (button group, default 1)
- Difficulty: Easy / Expert (button group, default Easy)
- "Start Game" → navigate to `/game/local`, call `startGame(playerCount, difficulty)`

Future: branded lobby with visual card motif (noted as Option B).

---

## 11. Routing

| Route | Component | Notes |
|-------|-----------|-------|
| `/` | `Home.tsx` | New game setup |
| `/game/local` | `Game.tsx` | Single-player session, all state in memory |

No server calls anywhere in this spec. The full build is a static site.

---

## 12. Out of Scope for This Spec

- Online multiplayer (separate future spec)
- Auth / accounts / game history
- Medium and Hard AI difficulty
- Drag-and-drop card placement
- Branded home screen
- `/account` route
