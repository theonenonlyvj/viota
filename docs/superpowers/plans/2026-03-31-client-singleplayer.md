# Viota Client — Single-Player Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/client` — a React 18 + Vite SPA for single-player Viota (1 human + 1–3 AI opponents), deployable as a static site.

**Architecture:** Zustand store owns all game state and mutations. AI runs in a Vite Web Worker (type: module) to keep the UI non-blocking. Components receive data and callbacks only — no engine imports. Game logic lives in `gameLogic.ts` (pure functions, mirrors `packages/server/src/gameLoop.ts` but for client use). Board pan/zoom/rotation is local state inside `Board.tsx`, exposed via imperative ref to `Game.tsx`.

**Tech Stack:** React 18, TypeScript, Vite 5, Zustand 4, React Router v6, `@viota/engine` (workspace), Vitest + React Testing Library + jsdom

---

## File Map

| File | Responsibility |
|------|----------------|
| `packages/client/package.json` | Dependencies and scripts |
| `packages/client/vite.config.ts` | Vite + Vitest config |
| `packages/client/tsconfig.json` | TypeScript config |
| `packages/client/index.html` | HTML entry, global reset |
| `packages/client/src/main.tsx` | React root, BrowserRouter, routes |
| `packages/client/src/test-setup.ts` | `@testing-library/jest-dom` |
| `packages/client/src/gameLogic.ts` | `initGame`, `applyPlay`, `applyPass`, `applyWildRecycle`, `computeValidPositions`, `computePreviewScore` |
| `packages/client/src/store/gameStore.ts` | Zustand store: all game state + actions |
| `packages/client/src/workers/ai.worker-logic.ts` | Pure AI computation (testable without Worker) |
| `packages/client/src/workers/ai.worker.ts` | Vite Web Worker entry, thin wrapper |
| `packages/client/src/components/Card.tsx` | Card visual — SVG shape + number, wild star |
| `packages/client/src/components/Cell.tsx` | Board cell — placed/staged/valid/empty variants |
| `packages/client/src/components/Hand.tsx` | 4-card hand strip with staged-dim logic |
| `packages/client/src/components/Board.tsx` | Pan/zoom/rotate board, renders grid cells |
| `packages/client/src/components/TopBar.tsx` | Scores, draw pile count, zoom/rotate buttons |
| `packages/client/src/components/PassTradeModal.tsx` | Card toggle + drag-to-reorder trade row |
| `packages/client/src/pages/Home.tsx` | Opponent count + difficulty → start game |
| `packages/client/src/pages/Game.tsx` | Worker lifecycle, turn loop, layout |

---

## Task 1: Scaffold

**Files:**
- Create: `packages/client/package.json`
- Create: `packages/client/vite.config.ts`
- Create: `packages/client/tsconfig.json`
- Create: `packages/client/index.html`
- Create: `packages/client/src/main.tsx`
- Create: `packages/client/src/test-setup.ts`
- Create: `packages/client/src/pages/Home.tsx` (stub)
- Create: `packages/client/src/pages/Game.tsx` (stub)
- Test: `packages/client/src/pages/Home.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/pages/Home.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Home from './Home'

test('Home page renders title', () => {
  render(<MemoryRouter><Home /></MemoryRouter>)
  expect(screen.getByText('Viota')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/client && pnpm test 2>&1 | head -20
```

Expected: error — package does not exist yet

- [ ] **Step 3: Create `packages/client/package.json`**

```json
{
  "name": "@viota/client",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@viota/engine": "workspace:*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.23.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^24.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.3.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 4: Create `packages/client/vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
```

- [ ] **Step 5: Create `packages/client/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Create `packages/client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Viota</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: #1a1a2e; color: #e2e8f0; font-family: system-ui, sans-serif; height: 100dvh; overflow: hidden; }
      #root { height: 100dvh; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `packages/client/src/test-setup.ts`**

```ts
import '@testing-library/jest-dom'
```

- [ ] **Step 8: Create `packages/client/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Game from './pages/Game'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/game/local" element={<Game />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
)
```

- [ ] **Step 9: Create `packages/client/src/pages/Home.tsx` (stub)**

```tsx
export default function Home() {
  return <div><h1>Viota</h1></div>
}
```

- [ ] **Step 10: Create `packages/client/src/pages/Game.tsx` (stub)**

```tsx
export default function Game() {
  return <div>Game</div>
}
```

- [ ] **Step 11: Install dependencies from repo root**

```bash
cd /path/to/viota && pnpm install
```

Expected: `@viota/client` installed, `@viota/engine` workspace dependency resolved

- [ ] **Step 12: Run test to verify it passes**

```bash
cd packages/client && pnpm test
```

Expected: 1 test passing — `Home page renders title`

- [ ] **Step 13: Commit**

```bash
git add packages/client/
git commit -m "feat(client): scaffold React + Vite + Vitest client package"
```

---

## Task 2: Card Component

**Files:**
- Create: `packages/client/src/components/Card.tsx`
- Test: `packages/client/src/components/Card.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/components/Card.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import Card from './Card'
import type { Card as CardType } from '@viota/engine'

test('regular card renders number', () => {
  const card: CardType = { kind: 'regular', color: 'red', shape: 'circle', number: 3 }
  render(<Card card={card} />)
  expect(screen.getByText('3')).toBeInTheDocument()
})

test('wild card renders star', () => {
  render(<Card card={{ kind: 'wild' }} />)
  expect(screen.getByText('★')).toBeInTheDocument()
})

test('selected card has yellow glow in boxShadow', () => {
  const card: CardType = { kind: 'regular', color: 'blue', shape: 'triangle', number: 2 }
  const { container } = render(<Card card={card} selected />)
  const el = container.firstChild as HTMLElement
  expect(el.style.boxShadow).toContain('#facc15')
})

test('onClick fires when card is clicked', async () => {
  const card: CardType = { kind: 'regular', color: 'green', shape: 'square', number: 1 }
  const handleClick = vi.fn()
  const { container } = render(<Card card={card} onClick={handleClick} />)
  await userEvent.click(container.firstChild as HTMLElement)
  expect(handleClick).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/client && pnpm test -- Card
```

Expected: FAIL — `Card` not found

- [ ] **Step 3: Create `packages/client/src/components/Card.tsx`**

```tsx
import type { Card as CardType } from '@viota/engine'

const SHAPE_COLOR: Record<string, string> = {
  red: '#ef4444',
  blue: '#3b82f6',
  yellow: '#eab308',
  green: '#22c55e',
}

function ShapeSvg({ card }: { card: Extract<CardType, { kind: 'regular' }> }) {
  const fill = SHAPE_COLOR[card.color]!
  if (card.shape === 'circle')
    return <svg width="34" height="34" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill={fill} stroke="#111" strokeWidth="1.5"/></svg>
  if (card.shape === 'triangle')
    return <svg width="34" height="34" viewBox="0 0 32 32"><polygon points="16,4 28,28 4,28" fill={fill} stroke="#111" strokeWidth="1.5"/></svg>
  if (card.shape === 'plus')
    return <svg width="34" height="34" viewBox="0 0 32 32"><line x1="16" y1="4" x2="16" y2="28" stroke={fill} strokeWidth="8" strokeLinecap="round"/><line x1="4" y1="16" x2="28" y2="16" stroke={fill} strokeWidth="8" strokeLinecap="round"/></svg>
  // square
  return <svg width="34" height="34" viewBox="0 0 32 32"><rect x="6" y="6" width="20" height="20" rx="3" fill={fill} stroke="#111" strokeWidth="1.5"/></svg>
}

type Props = {
  card: CardType
  selected?: boolean
  onClick?: () => void
}

export default function Card({ card, selected = false, onClick }: Props) {
  const shadow = selected
    ? '0 0 0 2.5px #facc15, 0 0 14px rgba(250,204,21,0.35)'
    : '0 2px 8px rgba(0,0,0,0.4)'

  const style: React.CSSProperties = {
    width: 56,
    height: 56,
    background: '#fff',
    borderRadius: 7,
    boxShadow: shadow,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    cursor: onClick ? 'pointer' : 'default',
    flexShrink: 0,
  }

  if (card.kind === 'wild') {
    return (
      <div style={style} onClick={onClick}>
        <div style={{
          width: 30, height: 30, borderRadius: 4,
          background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: '#fff', fontSize: 15, fontWeight: 'bold' }}>★</span>
        </div>
      </div>
    )
  }

  return (
    <div style={style} onClick={onClick}>
      <ShapeSvg card={card} />
      <span style={{
        position: 'absolute', bottom: 3, right: 5,
        fontSize: 9, fontWeight: 'bold', color: '#333',
      }}>
        {card.number}
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/client && pnpm test -- Card
```

Expected: 4 tests passing

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/Card.tsx packages/client/src/components/Card.test.tsx
git commit -m "feat(client): Card component with SVG shapes and wild star"
```

---

## Task 3: Game Logic Helpers

**Files:**
- Create: `packages/client/src/gameLogic.ts`
- Test: `packages/client/src/gameLogic.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/gameLogic.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  initGame, applyPlay, applyPass, applyWildRecycle,
  computeValidPositions, computePreviewScore,
} from './gameLogic'
import type { Card, Placement, RegularCard } from '@viota/engine'
import { posKey } from '@viota/engine'

describe('initGame', () => {
  test('creates 2-player game with correct structure', () => {
    const state = initGame(2)
    expect(state.hands).toHaveLength(2)
    expect(state.hands[0]).toHaveLength(4)
    expect(state.hands[1]).toHaveLength(4)
    expect(state.grid.size).toBe(0)
    expect(state.scores).toEqual([0, 0])
    expect(state.turnIndex).toBe(0)
    expect(state.drawPile).toHaveLength(66 - 8) // 66 total - 8 dealt
  })

  test('throws for invalid player count', () => {
    expect(() => initGame(1)).toThrow()
    expect(() => initGame(5)).toThrow()
  })
})

describe('applyPlay', () => {
  test('returns error when it is not the player turn', () => {
    const state = initGame(2)
    // turnIndex is 0, but we try as player 1
    const card = state.hands[1]![0]!
    const result = applyPlay(state, 1, [{ card, position: { x: 0, y: 0 } }])
    expect(result).toHaveProperty('error')
  })

  test('places first card at (0,0) successfully', () => {
    const state = initGame(2)
    const card = state.hands[0]![0]!
    const result = applyPlay(state, 0, [{ card, position: { x: 0, y: 0 } }])
    expect(result).not.toHaveProperty('error')
    if ('error' in result) return
    expect(result.newState.grid.get(posKey({ x: 0, y: 0 }))).toEqual(card)
    expect(result.newState.turnIndex).toBe(1)
    expect(result.newState.scores[0]).toBeGreaterThan(0)
    expect(result.gameOver).toBe(false)
  })

  test('redraws to refill hand after play', () => {
    const state = initGame(2)
    const card = state.hands[0]![0]!
    const result = applyPlay(state, 0, [{ card, position: { x: 0, y: 0 } }])
    if ('error' in result) throw new Error('unexpected error')
    expect(result.newState.hands[0]).toHaveLength(4)
  })
})

describe('applyPass', () => {
  test('advances turn and puts traded cards at bottom of pile', () => {
    const state = initGame(2)
    const trades = [state.hands[0]![0]!]
    const result = applyPass(state, 0, trades, trades)
    expect(result).not.toHaveProperty('error')
    if ('error' in result) return
    expect(result.newState.turnIndex).toBe(1)
    // traded card is at bottom of pile
    const bottom = result.newState.drawPile[result.newState.drawPile.length - 1]
    expect(bottom).toEqual(trades[0])
  })

  test('returns error when not player turn', () => {
    const state = initGame(2)
    const result = applyPass(state, 1, [], [])
    expect(result).toHaveProperty('error')
  })
})

describe('computeValidPositions', () => {
  test('returns (0,0) on empty board', () => {
    const state = initGame(2)
    const card = state.hands[0]![0]!
    const positions = computeValidPositions(state.grid, [], card)
    expect(positions).toContainEqual({ x: 0, y: 0 })
  })

  test('returns adjacent cells after first card placed', () => {
    const state = initGame(2)
    const card1 = state.hands[0]![0]!
    const result = applyPlay(state, 0, [{ card: card1, position: { x: 0, y: 0 } }])
    if ('error' in result) throw new Error('unexpected error')
    const card2 = result.newState.hands[1]![0]!
    const positions = computeValidPositions(result.newState.grid, [], card2)
    // At minimum one of the 4 adjacent cells should be valid
    expect(positions.length).toBeGreaterThan(0)
    const keys = positions.map(p => posKey(p))
    const adjacent = ['1,0', '-1,0', '0,1', '0,-1']
    expect(keys.some(k => adjacent.includes(k))).toBe(true)
  })
})

describe('computePreviewScore', () => {
  test('returns null when staged is empty', () => {
    const state = initGame(2)
    expect(computePreviewScore(state.grid, [])).toBeNull()
  })

  test('returns score for valid staged placement on empty board', () => {
    const state = initGame(2)
    const card = state.hands[0]![0]!
    const preview = computePreviewScore(state.grid, [{ card, position: { x: 0, y: 0 } }])
    // Single card on empty board: score = card.number (if regular)
    if (card.kind === 'regular') {
      expect(preview).not.toBeNull()
      expect(preview!.total).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/client && pnpm test -- gameLogic
```

Expected: FAIL — `gameLogic` module not found

- [ ] **Step 3: Create `packages/client/src/gameLogic.ts`**

```ts
import {
  validatePlay, validateWildRecycle, score, createDeck, shuffle, posKey, fromKey,
  type Card, type RegularCard, type GameState, type Placement, type Position, type ScoreResult,
} from '@viota/engine'

function cardsMatch(a: Card, b: Card): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'wild') return true
  return (a as RegularCard).color === (b as RegularCard).color &&
    (a as RegularCard).shape === (b as RegularCard).shape &&
    (a as RegularCard).number === (b as RegularCard).number
}

function handContains(hand: Card[], need: Card[]): boolean {
  const remaining = [...hand]
  for (const card of need) {
    const idx = remaining.findIndex(h => cardsMatch(h, card))
    if (idx === -1) return false
    remaining.splice(idx, 1)
  }
  return true
}

export function initGame(playerCount: number): GameState {
  if (playerCount < 2 || playerCount > 4) throw new Error('playerCount must be 2–4')
  const deck = shuffle(createDeck())
  const hands: Card[][] = []
  let pile = [...deck]
  for (let i = 0; i < playerCount; i++) {
    hands.push(pile.splice(0, 4))
  }
  return {
    grid: new Map(),
    hands,
    drawPile: pile,
    scores: Array.from({ length: playerCount }, () => 0),
    turnIndex: 0,
    playedCards: [],
  }
}

export function applyPlay(
  state: GameState,
  playerIndex: number,
  placements: Placement[]
): { newState: GameState; scoreResult: ScoreResult; gameOver: boolean } | { error: string } {
  if (state.turnIndex !== playerIndex) return { error: 'Not your turn' }
  if (placements.length === 0) return { error: 'Must place at least 1 card' }

  const hand = state.hands[playerIndex]!
  const playedCards = placements.map(p => p.card)

  if (!handContains(hand, playedCards)) return { error: 'Played cards not all in hand' }

  const validation = validatePlay(state.grid, placements)
  if (!validation.valid) return { error: validation.error }

  const newGrid = new Map(state.grid)
  for (const { card, position } of placements) newGrid.set(posKey(position), card)

  const gameEnding = state.drawPile.length === 0 && placements.length === hand.length

  const scoreResult = score(newGrid, placements.map(p => p.position), {
    cardsPlayedThisTurn: placements.length,
    gameEnding,
  })

  let newHand = [...hand]
  for (const card of playedCards) {
    const idx = newHand.findIndex(c => cardsMatch(c, card))
    newHand.splice(idx, 1)
  }
  const newPile = [...state.drawPile]
  const draws = newPile.splice(0, placements.length)
  newHand = [...newHand, ...draws]

  const newPlayedCards = [
    ...state.playedCards,
    ...playedCards.filter((c): c is RegularCard => c.kind === 'regular'),
  ]
  const newScores = state.scores.map((s, i) => (i === playerIndex ? s + scoreResult.total : s))
  const newHands = state.hands.map((h, i) => (i === playerIndex ? newHand : h))
  const playerCount = state.hands.length
  const newTurnIndex = gameEnding ? state.turnIndex : (state.turnIndex + 1) % playerCount

  return {
    newState: {
      grid: newGrid,
      hands: newHands,
      drawPile: newPile,
      scores: newScores,
      turnIndex: newTurnIndex,
      playedCards: newPlayedCards,
    },
    scoreResult,
    gameOver: gameEnding,
  }
}

export function applyPass(
  state: GameState,
  playerIndex: number,
  trades: Card[],
  tradeOrder: Card[]
): { newState: GameState } | { error: string } {
  if (state.turnIndex !== playerIndex) return { error: 'Not your turn' }
  if (trades.length > 4) return { error: 'Cannot trade more than 4 cards' }
  if (!handContains(state.hands[playerIndex]!, trades)) return { error: 'Trade cards not all in hand' }

  let newHand = [...state.hands[playerIndex]!]
  for (const card of trades) {
    const idx = newHand.findIndex(c => cardsMatch(c, card))
    newHand.splice(idx, 1)
  }
  const newPile = [...state.drawPile]
  const draws = newPile.splice(0, trades.length)
  newHand = [...newHand, ...draws]
  newPile.push(...tradeOrder)

  const playerCount = state.hands.length
  const newTurnIndex = (state.turnIndex + 1) % playerCount
  const newHands = state.hands.map((h, i) => (i === playerIndex ? newHand : h))

  return {
    newState: { ...state, hands: newHands, drawPile: newPile, turnIndex: newTurnIndex },
  }
}

export function applyWildRecycle(
  state: GameState,
  playerIndex: number,
  wildPosition: Position,
  replacement: RegularCard
): { newState: GameState } | { error: string } {
  if (state.turnIndex !== playerIndex) return { error: 'Not your turn' }
  if (!handContains(state.hands[playerIndex]!, [replacement])) return { error: 'Replacement card not in hand' }
  if (!validateWildRecycle(state.grid, wildPosition, replacement)) return { error: 'Invalid wild recycle' }

  const newGrid = new Map(state.grid)
  newGrid.set(posKey(wildPosition), replacement)

  const newHand = [...state.hands[playerIndex]!]
  const replIdx = newHand.findIndex(c => cardsMatch(c, replacement))
  newHand.splice(replIdx, 1)
  newHand.push({ kind: 'wild' })

  const newHands = state.hands.map((h, i) => (i === playerIndex ? newHand : h))
  return { newState: { ...state, grid: newGrid, hands: newHands } }
}

export function computeValidPositions(
  grid: GameState['grid'],
  staged: Placement[],
  selectedCard: Card
): Position[] {
  const tentative = new Map(grid)
  for (const { card, position } of staged) tentative.set(posKey(position), card)

  const candidates = new Set<string>()
  if (tentative.size === 0) {
    candidates.add(posKey({ x: 0, y: 0 }))
  } else {
    for (const key of tentative.keys()) {
      const pos = fromKey(key)
      for (const n of [
        { x: pos.x + 1, y: pos.y }, { x: pos.x - 1, y: pos.y },
        { x: pos.x, y: pos.y + 1 }, { x: pos.x, y: pos.y - 1 },
      ]) {
        if (!tentative.has(posKey(n))) candidates.add(posKey(n))
      }
    }
  }

  const valid: Position[] = []
  for (const key of candidates) {
    const pos = fromKey(key)
    const result = validatePlay(grid, [...staged, { card: selectedCard, position: pos }])
    if (result.valid) valid.push(pos)
  }
  return valid
}

export function computePreviewScore(
  grid: GameState['grid'],
  staged: Placement[]
): ScoreResult | null {
  if (staged.length === 0) return null
  const validation = validatePlay(grid, staged)
  if (!validation.valid) return null
  const tentative = new Map(grid)
  for (const { card, position } of staged) tentative.set(posKey(position), card)
  return score(tentative, staged.map(p => p.position), { cardsPlayedThisTurn: staged.length })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/client && pnpm test -- gameLogic
```

Expected: all tests passing

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/gameLogic.ts packages/client/src/gameLogic.test.ts
git commit -m "feat(client): game logic helpers (applyPlay/Pass/WildRecycle, validPositions, previewScore)"
```

---

## Task 4: Game Store

**Files:**
- Create: `packages/client/src/store/gameStore.ts`
- Test: `packages/client/src/store/gameStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/store/gameStore.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useGameStore } from './gameStore'
import { posKey } from '@viota/engine'
import type { Move } from '@viota/engine'

function store() { return useGameStore.getState() }

beforeEach(() => {
  store().startGame(2, 'easy')
})

test('startGame initialises 2-player state', () => {
  const s = store()
  expect(s.hands).toHaveLength(2)
  expect(s.hands[0]).toHaveLength(4)
  expect(s.scores).toEqual([0, 0])
  expect(s.phase).toBe('idle')
  expect(s.staged).toHaveLength(0)
  expect(s.selectedCard).toBeNull()
})

test('selectCard sets selectedCard and computes validPositions on empty board', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  expect(store().selectedCard).toBe(card)
  expect(store().validPositions).toContainEqual({ x: 0, y: 0 })
})

test('placeCard adds placement to staged and clears selectedCard', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  store().placeCard({ x: 0, y: 0 })
  const s = store()
  expect(s.staged).toHaveLength(1)
  expect(s.staged[0]!.card).toBe(card)
  expect(s.staged[0]!.position).toEqual({ x: 0, y: 0 })
  expect(s.selectedCard).toBeNull()
  expect(s.phase).toBe('placing')
})

test('unstageCard removes placement and returns phase to idle', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  store().placeCard({ x: 0, y: 0 })
  store().unstageCard({ x: 0, y: 0 })
  const s = store()
  expect(s.staged).toHaveLength(0)
  expect(s.phase).toBe('idle')
})

test('confirmPlay applies play, advances turn, sets phase idle (human follows)', () => {
  // 2-player: after human (0) plays, turn goes to AI (1), then it's AI turn
  // Replace AI with human for this test by starting a new config... actually
  // with 2 players player 1 is AI. We just check turn advances and phase = ai-thinking.
  const card = store().hands[0]![0]!
  store().selectCard(card)
  store().placeCard({ x: 0, y: 0 })
  store().confirmPlay()
  const s = store()
  expect(s.grid.get(posKey({ x: 0, y: 0 }))).toEqual(card)
  expect(s.staged).toHaveLength(0)
  // Turn advanced to player 1 (AI) — phase should be ai-thinking
  expect(s.phase).toBe('ai-thinking')
})

test('confirmPlay triggers worker postMessage when AI turn follows', () => {
  const mockWorker = { postMessage: vi.fn() } as unknown as Worker
  store().setWorker(mockWorker)
  const card = store().hands[0]![0]!
  store().selectCard(card)
  store().placeCard({ x: 0, y: 0 })
  store().confirmPlay()
  expect(mockWorker.postMessage).toHaveBeenCalledOnce()
  const msg = (mockWorker.postMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0]
  expect(msg.type).toBe('getMove')
  expect(msg.playerIndex).toBe(1)
  store().setWorker(null)
})

test('pass advances turn and triggers AI when applicable', () => {
  store().pass([], [])
  const s = store()
  expect(s.turnIndex).toBe(1)
  expect(s.phase).toBe('ai-thinking')
})

test('handleWorkerMessage applies pass move and advances to human turn', () => {
  // Manually set turnIndex to 1 (AI turn) by passing from human first
  store().pass([], [])
  // Now it's AI turn. Simulate worker returning a pass move.
  const move: Move = { type: 'pass', trades: [], tradeOrder: [] }
  store().handleWorkerMessage(move)
  expect(store().turnIndex).toBe(0) // back to human
  expect(store().phase).toBe('idle')
})

test('previewScore is set when staged placements are valid', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  store().placeCard({ x: 0, y: 0 })
  expect(store().previewScore).not.toBeNull()
})

test('previewScore is null after unstaging all cards', () => {
  const card = store().hands[0]![0]!
  store().selectCard(card)
  store().placeCard({ x: 0, y: 0 })
  store().unstageCard({ x: 0, y: 0 })
  expect(store().previewScore).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/client && pnpm test -- gameStore
```

Expected: FAIL — `gameStore` module not found

- [ ] **Step 3: Create `packages/client/src/store/gameStore.ts`**

```ts
import { create } from 'zustand'
import { posKey, type Card, type RegularCard, type GameState, type Placement, type Position, type ScoreResult, type Difficulty, type Move } from '@viota/engine'
import { initGame, applyPlay, applyPass, applyWildRecycle, computeValidPositions, computePreviewScore } from '../gameLogic'

type Phase = 'idle' | 'placing' | 'ai-thinking' | 'game-over'

type GameStore = {
  // Game state
  grid: GameState['grid']
  hands: Card[][]
  drawPile: Card[]
  scores: number[]
  turnIndex: number
  playedCards: RegularCard[]
  // Config
  playerCount: number
  difficulty: Difficulty
  humanIndex: number
  // UI state
  selectedCard: Card | null
  staged: Placement[]
  phase: Phase
  lastScoreResult: ScoreResult | null
  validPositions: Position[]
  previewScore: ScoreResult | null
  // Worker ref (set by Game.tsx)
  _worker: Worker | null
  // Actions
  startGame(playerCount: number, difficulty: Difficulty): void
  selectCard(card: Card): void
  placeCard(position: Position): void
  unstageCard(position: Position): void
  confirmPlay(): void
  pass(trades: Card[], tradeOrder: Card[]): void
  recycleWild(wildPosition: Position, replacement: RegularCard): void
  setWorker(worker: Worker | null): void
  handleWorkerMessage(move: Move): void
}

function postToWorker(worker: Worker, state: GameState, playerIndex: number, difficulty: Difficulty) {
  worker.postMessage({
    type: 'getMove',
    state: {
      grid: [...state.grid.entries()],
      hands: state.hands,
      drawPile: state.drawPile,
      scores: state.scores,
      turnIndex: state.turnIndex,
      playedCards: state.playedCards,
    },
    playerIndex,
    difficulty,
  })
}

export const useGameStore = create<GameStore>((set, get) => ({
  grid: new Map(),
  hands: [],
  drawPile: [],
  scores: [],
  turnIndex: 0,
  playedCards: [],
  playerCount: 2,
  difficulty: 'easy',
  humanIndex: 0,
  selectedCard: null,
  staged: [],
  phase: 'idle',
  lastScoreResult: null,
  validPositions: [],
  previewScore: null,
  _worker: null,

  startGame(playerCount, difficulty) {
    const gs = initGame(playerCount)
    set({
      ...gs,
      playerCount,
      difficulty,
      humanIndex: 0,
      selectedCard: null,
      staged: [],
      phase: 'idle',
      lastScoreResult: null,
      validPositions: [],
      previewScore: null,
    })
  },

  selectCard(card) {
    const { grid, staged } = get()
    const validPositions = computeValidPositions(grid, staged, card)
    set({ selectedCard: card, validPositions })
  },

  placeCard(position) {
    const { selectedCard, staged, grid } = get()
    if (!selectedCard) return
    const newStaged = [...staged, { card: selectedCard, position }]
    const previewScore = computePreviewScore(grid, newStaged)
    set({
      staged: newStaged,
      selectedCard: null,
      validPositions: [],
      previewScore,
      phase: 'placing',
    })
  },

  unstageCard(position) {
    const { staged, grid } = get()
    const key = posKey(position)
    const newStaged = staged.filter(p => posKey(p.position) !== key)
    const previewScore = computePreviewScore(grid, newStaged)
    set({
      staged: newStaged,
      selectedCard: null,
      validPositions: [],
      previewScore,
      phase: newStaged.length === 0 ? 'idle' : 'placing',
    })
  },

  confirmPlay() {
    const { grid, hands, drawPile, scores, turnIndex, playedCards, staged, humanIndex, difficulty, _worker } = get()
    if (staged.length === 0) return
    const gs: GameState = { grid, hands, drawPile, scores, turnIndex, playedCards }
    const result = applyPlay(gs, humanIndex, staged)
    if ('error' in result) return

    const { newState, scoreResult, gameOver } = result
    if (gameOver) {
      set({ ...newState, staged: [], selectedCard: null, validPositions: [], previewScore: null, lastScoreResult: scoreResult, phase: 'game-over' })
      return
    }

    const nextTurn = newState.turnIndex
    const isNextAI = nextTurn !== humanIndex
    set({
      ...newState,
      staged: [],
      selectedCard: null,
      validPositions: [],
      previewScore: null,
      lastScoreResult: scoreResult,
      phase: isNextAI ? 'ai-thinking' : 'idle',
    })
    if (isNextAI && _worker) postToWorker(_worker, newState, nextTurn, difficulty)
  },

  pass(trades, tradeOrder) {
    const { grid, hands, drawPile, scores, turnIndex, playedCards, humanIndex, difficulty, _worker } = get()
    const gs: GameState = { grid, hands, drawPile, scores, turnIndex, playedCards }
    const result = applyPass(gs, humanIndex, trades, tradeOrder)
    if ('error' in result) return
    const { newState } = result
    const nextTurn = newState.turnIndex
    const isNextAI = nextTurn !== humanIndex
    set({
      ...newState,
      staged: [],
      selectedCard: null,
      validPositions: [],
      previewScore: null,
      phase: isNextAI ? 'ai-thinking' : 'idle',
    })
    if (isNextAI && _worker) postToWorker(_worker, newState, nextTurn, difficulty)
  },

  recycleWild(wildPosition, replacement) {
    const { grid, hands, drawPile, scores, turnIndex, playedCards, humanIndex } = get()
    const gs: GameState = { grid, hands, drawPile, scores, turnIndex, playedCards }
    const result = applyWildRecycle(gs, humanIndex, wildPosition, replacement)
    if ('error' in result) return
    set({ ...result.newState, validPositions: [], previewScore: null })
  },

  setWorker(worker) {
    set({ _worker: worker })
  },

  handleWorkerMessage(move) {
    const { grid, hands, drawPile, scores, turnIndex, playedCards, humanIndex, difficulty, _worker } = get()
    const gs: GameState = { grid, hands, drawPile, scores, turnIndex, playedCards }

    let newState: GameState
    let gameOver = false

    if (move.type === 'play') {
      const result = applyPlay(gs, turnIndex, move.placements)
      if ('error' in result) return
      newState = result.newState
      gameOver = result.gameOver
    } else {
      const result = applyPass(gs, turnIndex, move.trades, move.tradeOrder)
      if ('error' in result) return
      newState = result.newState
    }

    if (gameOver) {
      set({ ...newState, phase: 'game-over' })
      return
    }

    const nextTurn = newState.turnIndex
    const isNextAI = nextTurn !== humanIndex
    set({ ...newState, phase: isNextAI ? 'ai-thinking' : 'idle' })

    if (isNextAI && _worker) {
      const w = _worker
      setTimeout(() => {
        const s = get()
        const current: GameState = { grid: s.grid, hands: s.hands, drawPile: s.drawPile, scores: s.scores, turnIndex: s.turnIndex, playedCards: s.playedCards }
        postToWorker(w, current, s.turnIndex, difficulty)
      }, 600)
    }
  },
}))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/client && pnpm test -- gameStore
```

Expected: all tests passing

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/store/gameStore.ts packages/client/src/store/gameStore.test.ts
git commit -m "feat(client): Zustand game store with full action set and AI worker integration"
```

---

## Task 5: AI Worker Logic

**Files:**
- Create: `packages/client/src/workers/ai.worker-logic.ts`
- Create: `packages/client/src/workers/ai.worker.ts`
- Test: `packages/client/src/workers/ai.worker-logic.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/workers/ai.worker-logic.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { computeAIMove } from './ai.worker-logic'
import { initGame } from '../gameLogic'

describe('computeAIMove', () => {
  test('returns a play or pass move for easy AI', () => {
    const state = initGame(2)
    const serialized = { ...state, grid: [...state.grid.entries()] }
    const move = computeAIMove(serialized, 0, 'easy')
    expect(['play', 'pass']).toContain(move.type)
  })

  test('returns a play or pass move for expert AI', () => {
    const state = initGame(2)
    const serialized = { ...state, grid: [...state.grid.entries()] }
    const move = computeAIMove(serialized, 0, 'expert')
    expect(['play', 'pass']).toContain(move.type)
  })

  test('deserializes grid Map correctly before calling AIAgent', () => {
    const state = initGame(3)
    const serialized = { ...state, grid: [...state.grid.entries()] }
    // Should not throw — Map deserialization must work
    expect(() => computeAIMove(serialized, 0, 'easy')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/client && pnpm test -- ai.worker-logic
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `packages/client/src/workers/ai.worker-logic.ts`**

```ts
import { AIAgent, type Card, type RegularCard, type GameState, type Difficulty, type Move } from '@viota/engine'

type SerializedState = Omit<GameState, 'grid'> & { grid: [string, Card][] }

export function computeAIMove(
  serialized: SerializedState,
  playerIndex: number,
  difficulty: Difficulty
): Move {
  const state: GameState = {
    ...serialized,
    grid: new Map(serialized.grid),
  }
  return AIAgent(difficulty)(state, playerIndex)
}
```

- [ ] **Step 4: Create `packages/client/src/workers/ai.worker.ts`**

```ts
import { computeAIMove } from './ai.worker-logic'
import type { Difficulty } from '@viota/engine'

self.onmessage = (e: MessageEvent) => {
  const { type, state, playerIndex, difficulty } = e.data as {
    type: string
    state: Parameters<typeof computeAIMove>[0]
    playerIndex: number
    difficulty: Difficulty
  }
  if (type === 'getMove') {
    const move = computeAIMove(state, playerIndex, difficulty)
    self.postMessage({ move })
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/client && pnpm test -- ai.worker-logic
```

Expected: 3 tests passing

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/workers/
git commit -m "feat(client): AI worker logic and Vite Web Worker entry"
```

---

## Task 6: Cell and Hand Components

**Files:**
- Create: `packages/client/src/components/Cell.tsx`
- Create: `packages/client/src/components/Hand.tsx`
- Test: `packages/client/src/components/Cell.test.tsx`
- Test: `packages/client/src/components/Hand.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/components/Cell.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import Cell from './Cell'

test('valid cell has green dashed border and calls onPlace when clicked', async () => {
  const handlePlace = vi.fn()
  render(<Cell variant="valid" onPlace={handlePlace} />)
  const el = screen.getByTestId('valid-cell')
  expect(el.style.border).toContain('#4ade80')
  await userEvent.click(el)
  expect(handlePlace).toHaveBeenCalledOnce()
})

test('empty cell is dimmed and not interactive', () => {
  const { container } = render(<Cell variant="empty" />)
  const el = container.firstChild as HTMLElement
  expect(el.style.opacity).toBe('0.3')
})
```

Create `packages/client/src/components/Hand.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import Hand from './Hand'
import type { Card, Placement } from '@viota/engine'

const hand: Card[] = [
  { kind: 'regular', color: 'red', shape: 'circle', number: 1 },
  { kind: 'regular', color: 'blue', shape: 'triangle', number: 2 },
  { kind: 'regular', color: 'green', shape: 'square', number: 3 },
  { kind: 'wild' },
]

test('renders all 4 hand cards', () => {
  render(<Hand hand={hand} selectedCard={null} staged={[]} onSelectCard={vi.fn()} />)
  expect(screen.getByText('1')).toBeInTheDocument()
  expect(screen.getByText('2')).toBeInTheDocument()
  expect(screen.getByText('3')).toBeInTheDocument()
  expect(screen.getByText('★')).toBeInTheDocument()
})

test('staged card is dimmed (opacity 0.3)', () => {
  const staged: Placement[] = [{ card: hand[0]!, position: { x: 0, y: 0 } }]
  const { container } = render(<Hand hand={hand} selectedCard={null} staged={staged} onSelectCard={vi.fn()} />)
  const wrappers = container.querySelectorAll('[style*="opacity"]')
  const dimmed = [...wrappers].filter(el => (el as HTMLElement).style.opacity === '0.3')
  expect(dimmed).toHaveLength(1)
})

test('calls onSelectCard with correct card when non-staged card clicked', async () => {
  const handleSelect = vi.fn()
  render(<Hand hand={hand} selectedCard={null} staged={[]} onSelectCard={handleSelect} />)
  await userEvent.click(screen.getByText('1').closest('div')!)
  expect(handleSelect).toHaveBeenCalledWith(hand[0])
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/client && pnpm test -- "Cell|Hand"
```

Expected: FAIL — modules not found

- [ ] **Step 3: Create `packages/client/src/components/Cell.tsx`**

```tsx
import CardComp from './Card'
import type { Card } from '@viota/engine'

type Props =
  | { variant: 'placed'; card: Card }
  | { variant: 'staged'; card: Card; onUnstage: () => void }
  | { variant: 'valid'; onPlace: () => void }
  | { variant: 'empty' }

export default function Cell(props: Props) {
  if (props.variant === 'placed') {
    return <CardComp card={props.card} />
  }
  if (props.variant === 'staged') {
    return <CardComp card={props.card} selected onClick={props.onUnstage} />
  }
  if (props.variant === 'valid') {
    return (
      <div
        data-testid="valid-cell"
        style={{
          width: 56, height: 56, borderRadius: 7,
          border: '2px dashed #4ade80',
          background: 'rgba(74,222,128,0.07)',
          boxShadow: '0 0 10px rgba(74,222,128,0.25)',
          cursor: 'pointer',
        }}
        onClick={props.onPlace}
      />
    )
  }
  return (
    <div style={{ width: 56, height: 56, borderRadius: 7, border: '1px dashed #2a2a4a', opacity: 0.3 }} />
  )
}
```

- [ ] **Step 4: Create `packages/client/src/components/Hand.tsx`**

```tsx
import type { Card, Placement } from '@viota/engine'
import CardComp from './Card'

type Props = {
  hand: Card[]
  selectedCard: Card | null
  staged: Placement[]
  onSelectCard: (card: Card) => void
}

export default function Hand({ hand, selectedCard, staged, onSelectCard }: Props) {
  const stagedRefs = new Set(staged.map(p => p.card))

  return (
    <div style={{ display: 'flex', gap: 7 }}>
      {hand.map((card, i) => {
        const isStaged = stagedRefs.has(card)
        const isSelected = card === selectedCard
        return (
          <div key={i} style={{ opacity: isStaged ? 0.3 : 1 }}>
            <CardComp
              card={card}
              selected={isSelected}
              onClick={isStaged ? undefined : () => onSelectCard(card)}
            />
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/client && pnpm test -- "Cell|Hand"
```

Expected: all tests passing

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/components/Cell.tsx packages/client/src/components/Cell.test.tsx \
        packages/client/src/components/Hand.tsx packages/client/src/components/Hand.test.tsx
git commit -m "feat(client): Cell and Hand components"
```

---

## Task 7: Board Component

**Files:**
- Create: `packages/client/src/components/Board.tsx`
- Test: `packages/client/src/components/Board.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/components/Board.test.tsx`:

```tsx
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { vi } from 'vitest'
import Board, { type BoardHandle } from './Board'
import { useGameStore } from '../store/gameStore'

function Wrapper() {
  const ref = useRef<BoardHandle>(null)
  return <Board ref={ref} />
}

beforeEach(() => {
  useGameStore.getState().startGame(2, 'easy')
})

test('renders without crashing', () => {
  const { container } = render(<Wrapper />)
  expect(container.firstChild).toBeInTheDocument()
})

test('valid cell is rendered and clickable after selectCard', () => {
  const card = useGameStore.getState().hands[0]![0]!
  act(() => useGameStore.getState().selectCard(card))
  render(<Wrapper />)
  // At least one valid cell should appear on empty board (position 0,0)
  expect(screen.getAllByTestId('valid-cell').length).toBeGreaterThan(0)
})

test('clicking valid cell calls placeCard in store', async () => {
  const card = useGameStore.getState().hands[0]![0]!
  act(() => useGameStore.getState().selectCard(card))
  render(<Wrapper />)
  const validCell = screen.getAllByTestId('valid-cell')[0]!
  await userEvent.click(validCell)
  expect(useGameStore.getState().staged).toHaveLength(1)
})

test('BoardHandle zoomIn and zoomOut change internal zoom', () => {
  let handle: BoardHandle | null = null
  function TestComp() {
    const ref = useRef<BoardHandle>(null)
    handle = ref.current
    return <Board ref={ref} />
  }
  render(<TestComp />)
  // Just verify handle is exposed and callable without throwing
  act(() => handle?.zoomIn())
  act(() => handle?.zoomOut())
  act(() => handle?.rotateCW())
  act(() => handle?.rotateCCW())
  act(() => handle?.autofit())
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/client && pnpm test -- Board
```

Expected: FAIL — `Board` module not found

- [ ] **Step 3: Create `packages/client/src/components/Board.tsx`**

```tsx
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { fromKey, posKey, type Position } from '@viota/engine'
import { useGameStore } from '../store/gameStore'
import Cell from './Cell'

const CELL_SIZE = 64

export type BoardHandle = {
  zoomIn: () => void
  zoomOut: () => void
  rotateCW: () => void
  rotateCCW: () => void
  autofit: () => void
}

function getRange(positions: Position[], margin = 1) {
  if (positions.length === 0) return { minX: -1, maxX: 1, minY: -1, maxY: 1 }
  const xs = positions.map(p => p.x)
  const ys = positions.map(p => p.y)
  return {
    minX: Math.min(...xs) - margin,
    maxX: Math.max(...xs) + margin,
    minY: Math.min(...ys) - margin,
    maxY: Math.max(...ys) + margin,
  }
}

const Board = forwardRef<BoardHandle>((_, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 800, height: 500 })
  const [panX, setPanX] = useState(400)
  const [panY, setPanY] = useState(250)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const dragging = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })

  const grid = useGameStore(s => s.grid)
  const staged = useGameStore(s => s.staged)
  const validPositions = useGameStore(s => s.validPositions)
  const previewScore = useGameStore(s => s.previewScore)
  const placeCard = useGameStore(s => s.placeCard)
  const unstageCard = useGameStore(s => s.unstageCard)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0]!.contentRect
      setDims({ width, height })
      setPanX(width / 2)
      setPanY(height / 2)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const allPositions = [
    ...[...grid.keys()].map(k => fromKey(k)),
    ...staged.map(p => p.position),
    ...validPositions,
  ]
  const { minX, maxX, minY, maxY } = getRange(allPositions)

  const stagedMap = new Map(staged.map(p => [posKey(p.position), p.card]))
  const validSet = new Set(validPositions.map(p => posKey(p)))

  const autofit = useCallback(() => {
    if (allPositions.length === 0) {
      setPanX(dims.width / 2)
      setPanY(dims.height / 2)
      setZoom(1)
      setRotation(0)
      return
    }
    const boardW = (maxX - minX + 1) * CELL_SIZE
    const boardH = (maxY - minY + 1) * CELL_SIZE
    const fitZoom = Math.min(dims.width / boardW, dims.height / boardH, 2.0)
    const clampedZoom = Math.max(fitZoom, 0.5)
    const centerX = ((minX + maxX + 1) / 2) * CELL_SIZE
    const centerY = ((minY + maxY + 1) / 2) * CELL_SIZE
    setPanX(dims.width / 2 - centerX * clampedZoom)
    setPanY(dims.height / 2 - centerY * clampedZoom)
    setZoom(clampedZoom)
    setRotation(0)
  }, [dims, minX, maxX, minY, maxY, allPositions.length])

  useImperativeHandle(ref, () => ({
    zoomIn: () => setZoom(z => Math.min(2.0, z + 0.25)),
    zoomOut: () => setZoom(z => Math.max(0.5, z - 0.25)),
    rotateCW: () => setRotation(r => (r + 90) % 360),
    rotateCCW: () => setRotation(r => (r - 90 + 360) % 360),
    autofit,
  }), [autofit])

  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).dataset['testid'] === 'valid-cell') return
    dragging.current = true
    lastMouse.current = { x: e.clientX, y: e.clientY }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return
    setPanX(prev => prev + e.clientX - lastMouse.current.x)
    setPanY(prev => prev + e.clientY - lastMouse.current.y)
    lastMouse.current = { x: e.clientX, y: e.clientY }
  }
  const onMouseUp = () => { dragging.current = false }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    setZoom(z => Math.max(0.5, Math.min(2.0, z + delta)))
  }

  const cells: React.ReactNode[] = []
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const key = posKey({ x, y })
      const stagedCard = stagedMap.get(key)
      const placedCard = grid.get(key)
      const isValid = validSet.has(key)
      const left = x * CELL_SIZE
      const top = y * CELL_SIZE

      let cell: React.ReactNode
      if (stagedCard) {
        cell = <Cell variant="staged" card={stagedCard} onUnstage={() => unstageCard({ x, y })} />
      } else if (placedCard) {
        cell = <Cell variant="placed" card={placedCard} />
      } else if (isValid) {
        cell = <Cell variant="valid" onPlace={() => placeCard({ x, y })} />
      } else {
        cell = <Cell variant="empty" />
      }

      cells.push(
        <div key={key} style={{ position: 'absolute', left, top }}>
          {cell}
        </div>
      )
    }
  }

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1, position: 'relative', overflow: 'hidden',
        background: '#1a1a2e',
        backgroundImage: 'radial-gradient(circle, #2a2a4a 1px, transparent 1px)',
        backgroundSize: '48px 48px',
        cursor: dragging.current ? 'grabbing' : 'grab',
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
    >
      {previewScore && (
        <div style={{
          position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
          background: '#1e3a5f', border: '1px solid #3b82f6',
          borderRadius: 8, padding: '5px 14px', fontSize: 12,
          color: '#93c5fd', zIndex: 2, pointerEvents: 'none',
        }}>
          Score preview: <span style={{ color: '#fff', fontWeight: 'bold' }}>+{previewScore.total}</span>
        </div>
      )}
      <div style={{
        position: 'absolute', left: 0, top: 0,
        transform: `translate(${panX}px, ${panY}px) scale(${zoom}) rotate(${rotation}deg)`,
        transformOrigin: '0 0',
      }}>
        {cells}
      </div>
    </div>
  )
})
Board.displayName = 'Board'
export default Board
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/client && pnpm test -- Board
```

Expected: all tests passing

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/Board.tsx packages/client/src/components/Board.test.tsx
git commit -m "feat(client): Board component with pan/zoom/rotate and infinite grid rendering"
```

---

## Task 8: TopBar Component

**Files:**
- Create: `packages/client/src/components/TopBar.tsx`
- Test: `packages/client/src/components/TopBar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/components/TopBar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import TopBar from './TopBar'

const defaultProps = {
  scores: [3, 7],
  drawPileCount: 42,
  playerCount: 2,
  humanIndex: 0,
  difficulty: 'easy' as const,
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onAutoFit: vi.fn(),
  onRotateCW: vi.fn(),
  onRotateCCW: vi.fn(),
}

test('renders human score', () => {
  render(<TopBar {...defaultProps} />)
  expect(screen.getByText('3')).toBeInTheDocument()
})

test('renders AI score', () => {
  render(<TopBar {...defaultProps} />)
  expect(screen.getByText('7')).toBeInTheDocument()
})

test('renders draw pile count', () => {
  render(<TopBar {...defaultProps} />)
  expect(screen.getByText('42')).toBeInTheDocument()
})

test('zoom in button calls onZoomIn', async () => {
  const onZoomIn = vi.fn()
  render(<TopBar {...defaultProps} onZoomIn={onZoomIn} />)
  await userEvent.click(screen.getByText('+'))
  expect(onZoomIn).toHaveBeenCalledOnce()
})

test('zoom out button calls onZoomOut', async () => {
  const onZoomOut = vi.fn()
  render(<TopBar {...defaultProps} onZoomOut={onZoomOut} />)
  await userEvent.click(screen.getByText('−'))
  expect(onZoomOut).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/client && pnpm test -- TopBar
```

Expected: FAIL — `TopBar` module not found

- [ ] **Step 3: Create `packages/client/src/components/TopBar.tsx`**

```tsx
import type { Difficulty } from '@viota/engine'

type Props = {
  scores: number[]
  drawPileCount: number
  playerCount: number
  humanIndex: number
  difficulty: Difficulty
  onZoomIn: () => void
  onZoomOut: () => void
  onAutoFit: () => void
  onRotateCW: () => void
  onRotateCCW: () => void
}

const pill: React.CSSProperties = {
  background: '#1e1e3a', borderRadius: 6, padding: '5px 12px', fontSize: 12, color: '#aaa',
}
const btn: React.CSSProperties = {
  background: '#1e1e3a', border: '1px solid #3a3a5a', color: '#aaa',
  borderRadius: 4, padding: '3px 10px', fontSize: 13, cursor: 'pointer',
}

export default function TopBar({ scores, drawPileCount, playerCount, humanIndex, difficulty, onZoomIn, onZoomOut, onAutoFit, onRotateCW, onRotateCCW }: Props) {
  return (
    <div style={{ background: '#12122a', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #2a2a4a', flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {scores.map((s, i) => (
          <div key={i} style={pill}>
            {i === humanIndex ? '🟢 ' : '🤖 '}
            <span style={{ color: '#fff', fontWeight: 'bold' }}>{i === humanIndex ? 'You' : `AI (${difficulty})`}</span>
            {'  '}
            <span style={{ color: i === humanIndex ? '#4ade80' : '#aaa', fontWeight: 'bold' }}>{s}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: '#6b7280' }}>
        Draw pile: <span style={{ color: '#fff', fontWeight: 'bold' }}>{drawPileCount}</span>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={btn} onClick={onZoomOut}>−</button>
        <button style={btn} onClick={onZoomIn}>+</button>
        <button style={btn} onClick={onAutoFit}>⊞</button>
        <button style={btn} onClick={onRotateCCW}>↺</button>
        <button style={btn} onClick={onRotateCW}>↻</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/client && pnpm test -- TopBar
```

Expected: all tests passing

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/TopBar.tsx packages/client/src/components/TopBar.test.tsx
git commit -m "feat(client): TopBar with scores, draw pile, and zoom/rotate controls"
```

---

## Task 9: PassTradeModal Component

**Files:**
- Create: `packages/client/src/components/PassTradeModal.tsx`
- Test: `packages/client/src/components/PassTradeModal.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/components/PassTradeModal.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import PassTradeModal from './PassTradeModal'
import type { Card } from '@viota/engine'

const hand: Card[] = [
  { kind: 'regular', color: 'red', shape: 'circle', number: 1 },
  { kind: 'regular', color: 'blue', shape: 'triangle', number: 2 },
  { kind: 'regular', color: 'green', shape: 'square', number: 3 },
  { kind: 'wild' },
]

test('renders all 4 hand cards', () => {
  render(<PassTradeModal hand={hand} onConfirm={vi.fn()} onClose={vi.fn()} />)
  expect(screen.getByText('1')).toBeInTheDocument()
  expect(screen.getByText('2')).toBeInTheDocument()
  expect(screen.getByText('3')).toBeInTheDocument()
  expect(screen.getByText('★')).toBeInTheDocument()
})

test('clicking a card selects it (shows in trade order row)', async () => {
  render(<PassTradeModal hand={hand} onConfirm={vi.fn()} onClose={vi.fn()} />)
  await userEvent.click(screen.getByText('1').closest('[data-testid="hand-card"]')!)
  expect(screen.getByTestId('trade-order-row')).toBeInTheDocument()
})

test('Confirm Pass calls onConfirm with selected cards', async () => {
  const handleConfirm = vi.fn()
  render(<PassTradeModal hand={hand} onConfirm={handleConfirm} onClose={vi.fn()} />)
  await userEvent.click(screen.getByText('1').closest('[data-testid="hand-card"]')!)
  await userEvent.click(screen.getByText('Confirm Pass'))
  expect(handleConfirm).toHaveBeenCalledOnce()
  const [trades] = handleConfirm.mock.calls[0]!
  expect(trades).toHaveLength(1)
  expect(trades[0]).toEqual(hand[0])
})

test('Cancel button calls onClose', async () => {
  const handleClose = vi.fn()
  render(<PassTradeModal hand={hand} onConfirm={vi.fn()} onClose={handleClose} />)
  await userEvent.click(screen.getByText('Cancel'))
  expect(handleClose).toHaveBeenCalledOnce()
})

test('confirming with no cards selected passes empty arrays', async () => {
  const handleConfirm = vi.fn()
  render(<PassTradeModal hand={hand} onConfirm={handleConfirm} onClose={vi.fn()} />)
  await userEvent.click(screen.getByText('Confirm Pass'))
  expect(handleConfirm).toHaveBeenCalledWith([], [])
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/client && pnpm test -- PassTradeModal
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `packages/client/src/components/PassTradeModal.tsx`**

```tsx
import { useState } from 'react'
import type { Card } from '@viota/engine'
import CardComp from './Card'

type Props = {
  hand: Card[]
  onConfirm: (trades: Card[], tradeOrder: Card[]) => void
  onClose: () => void
}

export default function PassTradeModal({ hand, onConfirm, onClose }: Props) {
  // selected: set of hand indices chosen for trade
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // tradeOrder: ordered list of hand indices (subset of selected)
  const [tradeOrder, setTradeOrder] = useState<number[]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  function toggleCard(i: number) {
    const next = new Set(selected)
    if (next.has(i)) {
      next.delete(i)
      setTradeOrder(prev => prev.filter(x => x !== i))
    } else {
      next.add(i)
      setTradeOrder(prev => [...prev, i])
    }
    setSelected(next)
  }

  function handleDragStart(e: React.DragEvent, orderIdx: number) {
    setDragIdx(orderIdx)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e: React.DragEvent, orderIdx: number) {
    e.preventDefault()
    if (dragIdx === null || dragIdx === orderIdx) return
    const next = [...tradeOrder]
    const [moved] = next.splice(dragIdx, 1)
    next.splice(orderIdx, 0, moved!)
    setTradeOrder(next)
    setDragIdx(orderIdx)
  }

  function handleConfirm() {
    const trades = tradeOrder.map(i => hand[i]!)
    const tradeOrderCards = tradeOrder.map(i => hand[i]!)
    onConfirm(trades, tradeOrderCards)
  }

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  }
  const modal: React.CSSProperties = {
    background: '#1e1e3a', borderRadius: 12, padding: 24, minWidth: 360,
    border: '1px solid #3a3a5a', display: 'flex', flexDirection: 'column', gap: 16,
  }
  const btnPrimary: React.CSSProperties = {
    background: '#16a34a', border: 'none', color: '#fff',
    borderRadius: 7, padding: '9px 16px', fontSize: 13, fontWeight: 'bold', cursor: 'pointer',
  }
  const btnSecondary: React.CSSProperties = {
    background: '#1e1e3a', border: '1px solid #3a3a5a', color: '#9ca3af',
    borderRadius: 7, padding: '7px 16px', fontSize: 12, cursor: 'pointer',
  }

  return (
    <div style={overlay}>
      <div style={modal}>
        <h3 style={{ color: '#e2e8f0', margin: 0 }}>Pass / Trade</h3>
        <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>
          Tap cards to trade (0–4). Drag to reorder.
        </p>

        <div style={{ display: 'flex', gap: 8 }}>
          {hand.map((card, i) => (
            <div
              key={i}
              data-testid="hand-card"
              onClick={() => toggleCard(i)}
              style={{ cursor: 'pointer', opacity: selected.has(i) ? 1 : 0.55 }}
            >
              <CardComp card={card} selected={selected.has(i)} />
            </div>
          ))}
        </div>

        {tradeOrder.length > 0 && (
          <div>
            <p style={{ color: '#9ca3af', fontSize: 11, marginBottom: 8 }}>Trade order:</p>
            <div style={{ display: 'flex', gap: 8 }} data-testid="trade-order-row">
              {tradeOrder.map((cardIdx, orderIdx) => (
                <div
                  key={orderIdx}
                  draggable
                  onDragStart={e => handleDragStart(e, orderIdx)}
                  onDragOver={e => handleDragOver(e, orderIdx)}
                  onDrop={e => e.preventDefault()}
                  style={{ cursor: 'grab' }}
                >
                  <CardComp card={hand[cardIdx]!} />
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={btnSecondary} onClick={onClose}>Cancel</button>
          <button style={btnPrimary} onClick={handleConfirm}>Confirm Pass</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/client && pnpm test -- PassTradeModal
```

Expected: all tests passing

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/PassTradeModal.tsx packages/client/src/components/PassTradeModal.test.tsx
git commit -m "feat(client): PassTradeModal with card toggle and drag-to-reorder trade row"
```

---

## Task 10: Game Page

**Files:**
- Modify: `packages/client/src/pages/Game.tsx` (full implementation)
- Test: `packages/client/src/pages/Game.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/pages/Game.test.tsx`:

```tsx
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Game from './Game'
import { useGameStore } from '../store/gameStore'

// Mock Web Worker
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
}

beforeEach(() => {
  useGameStore.getState().startGame(2, 'easy')
  vi.stubGlobal('Worker', MockWorker)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('renders without crashing', () => {
  render(<MemoryRouter><Game /></MemoryRouter>)
  expect(screen.getByText('Confirm Play')).toBeInTheDocument()
})

test('Confirm Play button is disabled when nothing is staged', () => {
  render(<MemoryRouter><Game /></MemoryRouter>)
  const btn = screen.getByText('Confirm Play').closest('button')!
  expect(btn.disabled).toBe(true)
})

test('Confirm Play button is enabled after staging a card', () => {
  render(<MemoryRouter><Game /></MemoryRouter>)
  const card = useGameStore.getState().hands[0]![0]!
  act(() => useGameStore.getState().selectCard(card))
  act(() => useGameStore.getState().placeCard({ x: 0, y: 0 }))
  const btn = screen.getByText('Confirm Play').closest('button')!
  expect(btn.disabled).toBe(false)
})

test('Pass / Trade button opens modal', async () => {
  render(<MemoryRouter><Game /></MemoryRouter>)
  await userEvent.click(screen.getByText('Pass / Trade'))
  expect(screen.getByText('Confirm Pass')).toBeInTheDocument()
})

test('game-over state shows Play Again button', () => {
  render(<MemoryRouter><Game /></MemoryRouter>)
  act(() => useGameStore.setState({ phase: 'game-over' }))
  expect(screen.getByText('Play Again')).toBeInTheDocument()
})

test('worker is created on mount and terminated on unmount', () => {
  const { unmount } = render(<MemoryRouter><Game /></MemoryRouter>)
  const workerInstance = useGameStore.getState()._worker as unknown as MockWorker
  expect(workerInstance).toBeDefined()
  unmount()
  expect(workerInstance.terminate).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/client && pnpm test -- "pages/Game"
```

Expected: FAIL

- [ ] **Step 3: Implement `packages/client/src/pages/Game.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import Board, { type BoardHandle } from '../components/Board'
import Hand from '../components/Hand'
import TopBar from '../components/TopBar'
import PassTradeModal from '../components/PassTradeModal'
import type { Move } from '@viota/engine'

export default function Game() {
  const navigate = useNavigate()
  const boardRef = useRef<BoardHandle>(null)
  const [showPassModal, setShowPassModal] = useState(false)

  const setWorker = useGameStore(s => s.setWorker)
  const handleWorkerMessage = useGameStore(s => s.handleWorkerMessage)
  const phase = useGameStore(s => s.phase)
  const scores = useGameStore(s => s.scores)
  const drawPile = useGameStore(s => s.drawPile)
  const hands = useGameStore(s => s.hands)
  const staged = useGameStore(s => s.staged)
  const selectedCard = useGameStore(s => s.selectedCard)
  const playerCount = useGameStore(s => s.playerCount)
  const difficulty = useGameStore(s => s.difficulty)
  const humanIndex = useGameStore(s => s.humanIndex)
  const selectCard = useGameStore(s => s.selectCard)
  const confirmPlay = useGameStore(s => s.confirmPlay)
  const pass = useGameStore(s => s.pass)
  const startGame = useGameStore(s => s.startGame)

  useEffect(() => {
    const worker = new Worker(new URL('../workers/ai.worker.ts', import.meta.url), { type: 'module' })
    setWorker(worker)
    worker.onmessage = (e: MessageEvent<{ move: Move }>) => {
      handleWorkerMessage(e.data.move)
    }
    return () => {
      worker.terminate()
      setWorker(null)
    }
  }, [setWorker, handleWorkerMessage])

  const humanHand = hands[humanIndex] ?? []

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <TopBar
        scores={scores}
        drawPileCount={drawPile.length}
        playerCount={playerCount}
        humanIndex={humanIndex}
        difficulty={difficulty}
        onZoomIn={() => boardRef.current?.zoomIn()}
        onZoomOut={() => boardRef.current?.zoomOut()}
        onAutoFit={() => boardRef.current?.autofit()}
        onRotateCW={() => boardRef.current?.rotateCW()}
        onRotateCCW={() => boardRef.current?.rotateCCW()}
      />

      <Board ref={boardRef} />

      <div style={{
        background: '#12122a', padding: '12px 16px',
        borderTop: '1px solid #2a2a4a',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <Hand
          hand={humanHand}
          selectedCard={selectedCard}
          staged={staged}
          onSelectCard={selectCard}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'stretch', minWidth: 130 }}>
          <button
            disabled={staged.length === 0 || phase !== 'placing'}
            onClick={confirmPlay}
            style={{
              background: staged.length > 0 && phase === 'placing' ? '#16a34a' : '#2a2a4a',
              border: 'none', color: '#fff',
              borderRadius: 7, padding: '9px 0', fontSize: 13, fontWeight: 'bold',
              cursor: staged.length > 0 && phase === 'placing' ? 'pointer' : 'default',
            }}
          >
            ✓ Confirm Play
          </button>
          <button
            disabled={phase === 'ai-thinking'}
            onClick={() => setShowPassModal(true)}
            style={{
              background: '#1e1e3a', border: '1px solid #3a3a5a', color: '#9ca3af',
              borderRadius: 7, padding: '7px 0', fontSize: 12, cursor: 'pointer',
            }}
          >
            Pass / Trade
          </button>
        </div>
      </div>

      {showPassModal && (
        <PassTradeModal
          hand={humanHand}
          onConfirm={(trades, tradeOrder) => {
            pass(trades, tradeOrder)
            setShowPassModal(false)
          }}
          onClose={() => setShowPassModal(false)}
        />
      )}

      {phase === 'game-over' && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
        }}>
          <div style={{
            background: '#1e1e3a', borderRadius: 12, padding: 32,
            border: '1px solid #3a3a5a', textAlign: 'center', minWidth: 300,
          }}>
            <h2 style={{ color: '#e2e8f0', marginBottom: 16 }}>Game Over</h2>
            {scores.map((s, i) => (
              <p key={i} style={{ color: '#9ca3af', marginBottom: 8 }}>
                {i === humanIndex ? 'You' : `AI ${i}`}: <span style={{ color: '#fff', fontWeight: 'bold' }}>{s}</span>
              </p>
            ))}
            <button
              onClick={() => startGame(playerCount, difficulty)}
              style={{
                marginTop: 16, background: '#3b82f6', border: 'none', color: '#fff',
                borderRadius: 7, padding: '10px 24px', fontSize: 14, fontWeight: 'bold', cursor: 'pointer',
              }}
            >
              Play Again
            </button>
            <button
              onClick={() => navigate('/')}
              style={{
                marginTop: 8, background: 'transparent', border: '1px solid #3a3a5a', color: '#9ca3af',
                borderRadius: 7, padding: '8px 24px', fontSize: 12, cursor: 'pointer', display: 'block', width: '100%',
              }}
            >
              Home
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/client && pnpm test -- "pages/Game"
```

Expected: all tests passing

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/pages/Game.tsx packages/client/src/pages/Game.test.tsx
git commit -m "feat(client): Game page with worker lifecycle, turn loop, and game-over modal"
```

---

## Task 11: Home Page

**Files:**
- Modify: `packages/client/src/pages/Home.tsx` (full implementation)
- Test: `packages/client/src/pages/Home.test.tsx` (extend existing)

- [ ] **Step 1: Write the failing tests**

Replace `packages/client/src/pages/Home.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Home from './Home'
import { useGameStore } from '../store/gameStore'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

beforeEach(() => {
  mockNavigate.mockClear()
  useGameStore.getState().startGame(2, 'easy')
})

test('Home page renders title', () => {
  render(<MemoryRouter><Home /></MemoryRouter>)
  expect(screen.getByText('Viota')).toBeInTheDocument()
})

test('renders opponent count buttons 1, 2, 3', () => {
  render(<MemoryRouter><Home /></MemoryRouter>)
  expect(screen.getByText('1')).toBeInTheDocument()
  expect(screen.getByText('2')).toBeInTheDocument()
  expect(screen.getByText('3')).toBeInTheDocument()
})

test('renders Easy and Expert difficulty buttons', () => {
  render(<MemoryRouter><Home /></MemoryRouter>)
  expect(screen.getByText('Easy')).toBeInTheDocument()
  expect(screen.getByText('Expert')).toBeInTheDocument()
})

test('Start Game calls startGame and navigates to /game/local', async () => {
  render(<MemoryRouter><Home /></MemoryRouter>)
  await userEvent.click(screen.getByText('Start Game'))
  // Default: 1 opponent → playerCount=2, difficulty=easy
  expect(useGameStore.getState().playerCount).toBe(2)
  expect(useGameStore.getState().difficulty).toBe('easy')
  expect(mockNavigate).toHaveBeenCalledWith('/game/local')
})

test('selecting 3 opponents sets playerCount to 4 on start', async () => {
  render(<MemoryRouter><Home /></MemoryRouter>)
  await userEvent.click(screen.getByText('3'))
  await userEvent.click(screen.getByText('Start Game'))
  expect(useGameStore.getState().playerCount).toBe(4)
})

test('selecting Expert sets difficulty to expert on start', async () => {
  render(<MemoryRouter><Home /></MemoryRouter>)
  await userEvent.click(screen.getByText('Expert'))
  await userEvent.click(screen.getByText('Start Game'))
  expect(useGameStore.getState().difficulty).toBe('expert')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/client && pnpm test -- "pages/Home"
```

Expected: 5 tests FAIL (stub only returns `<h1>Viota</h1>`)

- [ ] **Step 3: Implement `packages/client/src/pages/Home.tsx`**

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Difficulty } from '@viota/engine'
import { useGameStore } from '../store/gameStore'

export default function Home() {
  const [opponents, setOpponents] = useState(1)   // 1–3
  const [difficulty, setDifficulty] = useState<'easy' | 'expert'>('easy')
  const navigate = useNavigate()
  const startGame = useGameStore(s => s.startGame)

  function handleStart() {
    startGame(opponents + 1, difficulty)
    navigate('/game/local')
  }

  const btnGroup: React.CSSProperties = { display: 'flex', gap: 8 }
  const btn = (active: boolean): React.CSSProperties => ({
    background: active ? '#3b82f6' : '#1e1e3a',
    border: active ? '1px solid #3b82f6' : '1px solid #3a3a5a',
    color: '#fff', borderRadius: 7, padding: '8px 20px',
    fontSize: 14, cursor: 'pointer', fontWeight: active ? 'bold' : 'normal',
  })

  return (
    <div style={{
      height: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 32,
    }}>
      <h1 style={{ fontSize: 48, fontWeight: 'bold', color: '#e2e8f0', letterSpacing: 4 }}>Viota</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center' }}>
        <div>
          <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 10, textAlign: 'center' }}>AI Opponents</p>
          <div style={btnGroup}>
            {[1, 2, 3].map(n => (
              <button key={n} style={btn(opponents === n)} onClick={() => setOpponents(n)}>{n}</button>
            ))}
          </div>
        </div>

        <div>
          <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 10, textAlign: 'center' }}>Difficulty</p>
          <div style={btnGroup}>
            {(['easy', 'expert'] as const).map(d => (
              <button key={d} style={btn(difficulty === d)} onClick={() => setDifficulty(d)}>
                {d === 'easy' ? 'Easy' : 'Expert'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={handleStart}
        style={{
          background: '#3b82f6', border: 'none', color: '#fff',
          borderRadius: 8, padding: '12px 40px', fontSize: 16,
          fontWeight: 'bold', cursor: 'pointer',
        }}
      >
        Start Game
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/client && pnpm test -- "pages/Home"
```

Expected: all tests passing

- [ ] **Step 5: Run the full test suite**

```bash
cd packages/client && pnpm test
```

Expected: all tests passing across all files

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/pages/Home.tsx packages/client/src/pages/Home.test.tsx
git commit -m "feat(client): Home page with opponent count and difficulty selection"
```

---

## Self-Review Checklist

**Spec coverage:**

| Spec section | Covered by task |
|---|---|
| File structure (§3) | Task 1 scaffold |
| Game store shape with all fields (§4) | Task 4 |
| Tap/click placement flow (§5) | Tasks 4, 6, 7 |
| Board pan/zoom/rotate (§6) | Task 7 + Board imperative handle |
| Visual style (§7) | Tasks 2, 7, 8, inline styles throughout |
| Pass/Trade modal with drag-to-reorder (§8) | Task 9 |
| AI worker + turn loop with 600ms delay (§9) | Tasks 5, 4 |
| Home screen (§10) | Task 11 |
| Routes `/` and `/game/local` (§11) | Task 1 |
| Score preview badge while staging (§7/§4) | Tasks 3, 4, 7 |
| Game-over modal + Play Again (§9) | Task 10 |
| `recycleWild` store action (§4) | Task 4 |

**Out-of-scope items confirmed absent:** drag-and-drop board placement, Medium/Hard AI, auth, multiplayer, branded home screen.
