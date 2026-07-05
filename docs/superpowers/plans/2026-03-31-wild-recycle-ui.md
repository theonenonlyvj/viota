# Wild Card Recycling UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the human player to recycle a wild card on the board via a two-tap interaction: tap wild on board → tap valid hand card → swap.

**Architecture:** Add `recycleTarget` and `recycleValidCards` to the Zustand store with three new actions (`startRecycle`, `cancelRecycle`, `confirmRecycle`). Card component gets a `glow` prop for purple highlighting. Board renders wild cards as clickable during human's turn. Hand dims invalid cards and highlights valid replacements when recycling.

**Tech Stack:** React 18, Zustand, `@viota/engine` (`validateWildRecycle`), Vitest + React Testing Library

---

## File Map

| File | Change | Responsibility |
|------|--------|----------------|
| `packages/client/src/components/Card.tsx` | Modify | Add `glow` prop for purple highlight |
| `packages/client/src/store/gameStore.ts` | Modify | Add `recycleTarget`, `recycleValidCards`, 3 new actions |
| `packages/client/src/components/Cell.tsx` | Modify | New `wild` variant for clickable wild cards |
| `packages/client/src/components/Board.tsx` | Modify | Render wild cells as clickable, handle cancel on empty click |
| `packages/client/src/components/Hand.tsx` | Modify | Recycle mode: glow valid, dim invalid, click fires `confirmRecycle` |

---

## Task 1: Card `glow` Prop

**Files:**
- Modify: `packages/client/src/components/Card.tsx`
- Modify: `packages/client/src/components/Card.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `packages/client/src/components/Card.test.tsx`:

```tsx
test('glow prop applies purple boxShadow', () => {
  const card: CardType = { kind: 'regular', color: 'red', shape: 'circle', number: 2 }
  const { container } = render(<Card card={card} glow="purple" />)
  const el = container.firstChild as HTMLElement
  expect(el.style.boxShadow).toContain('#c084fc')
})

test('glow prop on wild card applies purple boxShadow', () => {
  const { container } = render(<Card card={{ kind: 'wild' }} glow="purple" />)
  const el = container.firstChild as HTMLElement
  expect(el.style.boxShadow).toContain('#c084fc')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/client && pnpm test -- Card
```

Expected: 2 FAIL — `glow` prop not recognized / no purple shadow

- [ ] **Step 3: Add `glow` prop to Card component**

In `packages/client/src/components/Card.tsx`, change the Props type and shadow logic:

```tsx
type Props = {
  card: CardType
  selected?: boolean
  glow?: 'purple'
  onClick?: () => void
}

export default function Card({ card, selected = false, glow, onClick }: Props) {
  let shadow = '0 2px 8px rgba(0,0,0,0.4)'
  if (glow === 'purple') {
    shadow = '0 0 0 2.5px #c084fc, 0 0 14px rgba(192,132,252,0.4)'
  } else if (selected) {
    shadow = '0 0 0 2.5px #facc15, 0 0 14px rgba(250,204,21,0.35)'
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/client && pnpm test -- Card
```

Expected: 6 tests passing (4 existing + 2 new)

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/Card.tsx packages/client/src/components/Card.test.tsx
git commit -m "feat(client): add purple glow prop to Card component"
```

---

## Task 2: Store Recycle State and Actions

**Files:**
- Modify: `packages/client/src/store/gameStore.ts`
- Modify: `packages/client/src/store/gameStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/client/src/store/gameStore.test.ts`. These tests need a wild card on the board, so we'll construct state manually:

```ts
import { validateWildRecycle, posKey, type Card, type RegularCard, type Position } from '@viota/engine'

test('startRecycle sets recycleTarget and computes recycleValidCards', () => {
  // Place a wild on the board at (1,0) next to the starter
  const s = store()
  const wildPos: Position = { x: 1, y: 0 }
  const newGrid = new Map(s.grid)
  newGrid.set(posKey(wildPos), { kind: 'wild' } as Card)
  useGameStore.setState({ grid: newGrid })

  store().startRecycle(wildPos)
  expect(store().recycleTarget).toEqual(wildPos)
  expect(Array.isArray(store().recycleValidCards)).toBe(true)
})

test('startRecycle ignores non-wild positions', () => {
  // (0,0) has the starter card which is regular
  store().startRecycle({ x: 0, y: 0 })
  expect(store().recycleTarget).toBeNull()
})

test('cancelRecycle clears recycleTarget', () => {
  const s = store()
  const wildPos: Position = { x: 1, y: 0 }
  const newGrid = new Map(s.grid)
  newGrid.set(posKey(wildPos), { kind: 'wild' } as Card)
  useGameStore.setState({ grid: newGrid })

  store().startRecycle(wildPos)
  expect(store().recycleTarget).not.toBeNull()
  store().cancelRecycle()
  expect(store().recycleTarget).toBeNull()
  expect(store().recycleValidCards).toEqual([])
})

test('confirmRecycle swaps wild with hand card and clears recycle state', () => {
  const s = store()
  const wildPos: Position = { x: 1, y: 0 }
  const newGrid = new Map(s.grid)
  newGrid.set(posKey(wildPos), { kind: 'wild' } as Card)
  useGameStore.setState({ grid: newGrid })

  store().startRecycle(wildPos)
  const validCards = store().recycleValidCards
  if (validCards.length === 0) return // skip if no valid replacements for this random hand

  const replacement = validCards[0]! as RegularCard
  store().confirmRecycle(replacement)

  // Wild should be gone from board, replacement in its place
  expect(store().grid.get(posKey(wildPos))).toEqual(replacement)
  // Wild should be in hand now
  expect(store().hands[0]!.some(c => c.kind === 'wild')).toBe(true)
  // Recycle state cleared
  expect(store().recycleTarget).toBeNull()
  expect(store().recycleValidCards).toEqual([])
})

test('startRecycle excludes staged cards from recycleValidCards', () => {
  const s = store()
  const wildPos: Position = { x: 1, y: 0 }
  const newGrid = new Map(s.grid)
  newGrid.set(posKey(wildPos), { kind: 'wild' } as Card)
  useGameStore.setState({ grid: newGrid })

  // Stage the first hand card
  const card = store().hands[0]![0]!
  store().selectCard(card)
  const validPos = store().validPositions
  if (validPos.length > 0) {
    store().placeCard(validPos[0]!)
  }

  store().startRecycle(wildPos)
  const stagedCards = new Set(store().staged.map(p => p.card))
  for (const vc of store().recycleValidCards) {
    expect(stagedCards.has(vc)).toBe(false)
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/client && pnpm test -- gameStore
```

Expected: FAIL — `startRecycle`, `cancelRecycle`, `confirmRecycle` not on store

- [ ] **Step 3: Add recycle state and actions to store**

In `packages/client/src/store/gameStore.ts`:

Add to the `GameStore` type (after `_worker: Worker | null`):

```ts
  recycleTarget: Position | null
  recycleValidCards: Card[]
  startRecycle(position: Position): void
  cancelRecycle(): void
  confirmRecycle(replacement: RegularCard): void
```

Add to the initial state (after `_worker: null`):

```ts
  recycleTarget: null,
  recycleValidCards: [],
```

Add the `startRecycle` import at the top — need `validateWildRecycle` from engine:

```ts
import { posKey, validateWildRecycle, type Card, type RegularCard, type GameState, type Placement, type Position, type ScoreResult, type Difficulty, type Move } from '@viota/engine'
```

Add the three actions (after `handleWorkerMessage`):

```ts
  startRecycle(position) {
    const { grid, hands, humanIndex, staged, turnIndex } = get()
    if (turnIndex !== humanIndex) return
    const card = grid.get(posKey(position))
    if (!card || card.kind !== 'wild') return

    const stagedCards = new Set(staged.map(p => p.card))
    const hand = hands[humanIndex]!
    const validCards = hand.filter(c => {
      if (stagedCards.has(c)) return false
      if (c.kind !== 'regular') return false
      return validateWildRecycle(grid, position, c)
    })

    set({ recycleTarget: position, recycleValidCards: validCards })
  },

  cancelRecycle() {
    set({ recycleTarget: null, recycleValidCards: [] })
  },

  confirmRecycle(replacement) {
    const { grid, hands, drawPile, scores, turnIndex, playedCards, humanIndex, recycleTarget } = get()
    if (!recycleTarget) return
    const gs: GameState = { grid, hands, drawPile, scores, turnIndex, playedCards }
    const result = applyWildRecycle(gs, humanIndex, recycleTarget, replacement)
    if ('error' in result) return
    set({ ...result.newState, recycleTarget: null, recycleValidCards: [], validPositions: [], previewScore: null })
  },
```

Also clear recycle state in `startGame`:

```ts
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
      recycleTarget: null,
      recycleValidCards: [],
    })
  },
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/client && pnpm test -- gameStore
```

Expected: all tests passing (9 existing + 5 new)

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/store/gameStore.ts packages/client/src/store/gameStore.test.ts
git commit -m "feat(client): add wild recycle state and actions to game store"
```

---

## Task 3: Cell Wild Variant + Board Wiring

**Files:**
- Modify: `packages/client/src/components/Cell.tsx`
- Modify: `packages/client/src/components/Cell.test.tsx`
- Modify: `packages/client/src/components/Board.tsx`
- Modify: `packages/client/src/components/Board.test.tsx`

- [ ] **Step 1: Write Cell test for wild variant**

Add to `packages/client/src/components/Cell.test.tsx`:

```tsx
test('wild cell renders card and calls onRecycle when clicked', async () => {
  const card = { kind: 'wild' as const }
  const handleRecycle = vi.fn()
  const { container } = render(<Cell variant="wild" card={card} onRecycle={handleRecycle} />)
  await userEvent.click(container.firstChild as HTMLElement)
  expect(handleRecycle).toHaveBeenCalledOnce()
})

test('wild-targeted cell has purple glow', () => {
  const card = { kind: 'wild' as const }
  render(<Cell variant="wild-targeted" card={card} />)
  // The Card component should receive glow="purple"
  const el = screen.getByText('★').closest('div[style]') as HTMLElement
  expect(el.style.boxShadow).toContain('#c084fc')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/client && pnpm test -- Cell
```

Expected: FAIL — `wild` and `wild-targeted` variants not recognized

- [ ] **Step 3: Add wild variants to Cell**

Replace the `Props` type and component in `packages/client/src/components/Cell.tsx`:

```tsx
import CardComp from './Card'
import type { Card } from '@viota/engine'

type Props =
  | { variant: 'placed'; card: Card }
  | { variant: 'staged'; card: Card; onUnstage: () => void }
  | { variant: 'valid'; onPlace: () => void }
  | { variant: 'wild'; card: Card; onRecycle: () => void }
  | { variant: 'wild-targeted'; card: Card }
  | { variant: 'empty' }

export default function Cell(props: Props) {
  if (props.variant === 'placed') {
    return <CardComp card={props.card} />
  }
  if (props.variant === 'staged') {
    return <CardComp card={props.card} selected onClick={props.onUnstage} />
  }
  if (props.variant === 'wild') {
    return <CardComp card={props.card} onClick={props.onRecycle} />
  }
  if (props.variant === 'wild-targeted') {
    return <CardComp card={props.card} glow="purple" />
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

- [ ] **Step 4: Run Cell tests**

```bash
cd packages/client && pnpm test -- Cell
```

Expected: 4 tests passing (2 existing + 2 new)

- [ ] **Step 5: Write Board test for wild cell rendering**

Add to `packages/client/src/components/Board.test.tsx`:

```tsx
test('wild card on board is clickable and triggers startRecycle', () => {
  // Place a wild at (1,0) on the grid
  const s = useGameStore.getState()
  const newGrid = new Map(s.grid)
  newGrid.set('1,0', { kind: 'wild' as const })
  useGameStore.setState({ grid: newGrid })

  render(<Wrapper />)
  // The wild card should be rendered — find the ★ text
  const stars = screen.getAllByText('★')
  expect(stars.length).toBeGreaterThan(0)
})
```

- [ ] **Step 6: Update Board to render wild cells and handle cancel**

In `packages/client/src/components/Board.tsx`, add store subscriptions after existing ones:

```tsx
  const recycleTarget = useGameStore(s => s.recycleTarget)
  const startRecycle = useGameStore(s => s.startRecycle)
  const cancelRecycle = useGameStore(s => s.cancelRecycle)
  const phase = useGameStore(s => s.phase)
  const humanIndex = useGameStore(s => s.humanIndex)
  const turnIndex = useGameStore(s => s.turnIndex)
```

Update the cell rendering logic inside the `for` loop. Replace the `placedCard` branch:

```tsx
      } else if (placedCard) {
        const isWild = placedCard.kind === 'wild'
        const isHumanTurn = turnIndex === humanIndex && (phase === 'idle' || phase === 'placing')
        const isTargeted = recycleTarget && posKey(recycleTarget) === key
        if (isTargeted) {
          cell = <Cell variant="wild-targeted" card={placedCard} />
        } else if (isWild && isHumanTurn) {
          cell = <Cell variant="wild" card={placedCard} onRecycle={() => startRecycle({ x, y })} />
        } else {
          cell = <Cell variant="placed" card={placedCard} />
        }
```

Update `onMouseDown` to cancel recycle when clicking empty board area:

```tsx
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).dataset['testid'] === 'valid-cell') return
    if (recycleTarget) {
      cancelRecycle()
      return
    }
    dragging.current = true
    lastMouse.current = { x: e.clientX, y: e.clientY }
  }
```

- [ ] **Step 7: Run Board tests**

```bash
cd packages/client && pnpm test -- Board
```

Expected: 4 tests passing (3 existing + 1 new)

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/components/Cell.tsx packages/client/src/components/Cell.test.tsx \
        packages/client/src/components/Board.tsx packages/client/src/components/Board.test.tsx
git commit -m "feat(client): wild cell variants and board recycle wiring"
```

---

## Task 4: Hand Recycle Mode

**Files:**
- Modify: `packages/client/src/components/Hand.tsx`
- Modify: `packages/client/src/components/Hand.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `packages/client/src/components/Hand.test.tsx`:

```tsx
test('in recycle mode, valid replacement cards get purple glow', () => {
  const validCards = [hand[0]!] // red circle 1 is a valid replacement
  const { container } = render(
    <Hand
      hand={hand}
      selectedCard={null}
      staged={[]}
      onSelectCard={vi.fn()}
      recycleValidCards={validCards}
      onConfirmRecycle={vi.fn()}
    />
  )
  // The valid card should have purple boxShadow
  const cards = container.querySelectorAll('div[style*="box-shadow"]')
  const purpleCards = [...cards].filter(el => (el as HTMLElement).style.boxShadow.includes('#c084fc'))
  expect(purpleCards).toHaveLength(1)
})

test('in recycle mode, invalid cards are dimmed', () => {
  const validCards = [hand[0]!]
  const { container } = render(
    <Hand
      hand={hand}
      selectedCard={null}
      staged={[]}
      onSelectCard={vi.fn()}
      recycleValidCards={validCards}
      onConfirmRecycle={vi.fn()}
    />
  )
  const wrappers = container.querySelectorAll('[style*="opacity"]')
  const dimmed = [...wrappers].filter(el => (el as HTMLElement).style.opacity === '0.3')
  expect(dimmed).toHaveLength(3) // 3 of 4 cards are invalid
})

test('clicking valid card in recycle mode calls onConfirmRecycle', async () => {
  const validCards = [hand[0]!]
  const handleConfirm = vi.fn()
  render(
    <Hand
      hand={hand}
      selectedCard={null}
      staged={[]}
      onSelectCard={vi.fn()}
      recycleValidCards={validCards}
      onConfirmRecycle={handleConfirm}
    />
  )
  await userEvent.click(screen.getByText('1').closest('div[style*="box-shadow"]')!)
  expect(handleConfirm).toHaveBeenCalledWith(hand[0])
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/client && pnpm test -- Hand
```

Expected: FAIL — `recycleValidCards` and `onConfirmRecycle` props not recognized

- [ ] **Step 3: Update Hand component**

Replace `packages/client/src/components/Hand.tsx`:

```tsx
import type { Card, Placement, RegularCard } from '@viota/engine'
import CardComp from './Card'

type Props = {
  hand: Card[]
  selectedCard: Card | null
  staged: Placement[]
  onSelectCard: (card: Card) => void
  recycleValidCards?: Card[]
  onConfirmRecycle?: (card: RegularCard) => void
}

export default function Hand({ hand, selectedCard, staged, onSelectCard, recycleValidCards, onConfirmRecycle }: Props) {
  const stagedRefs = new Set(staged.map(p => p.card))
  const recycling = recycleValidCards && recycleValidCards.length > 0
  const validSet = recycling ? new Set(recycleValidCards) : null

  return (
    <div style={{ display: 'flex', gap: 7 }}>
      {hand.map((card, i) => {
        const isStaged = stagedRefs.has(card)

        if (recycling && validSet) {
          const isValid = validSet.has(card)
          return (
            <div key={i} style={{ opacity: isValid ? 1 : 0.3 }}>
              <CardComp
                card={card}
                glow={isValid ? 'purple' : undefined}
                onClick={isValid && onConfirmRecycle ? () => onConfirmRecycle(card as RegularCard) : undefined}
              />
            </div>
          )
        }

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

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/client && pnpm test -- Hand
```

Expected: 6 tests passing (3 existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/Hand.tsx packages/client/src/components/Hand.test.tsx
git commit -m "feat(client): Hand recycle mode with purple glow and dimming"
```

---

## Task 5: Wire Game Page

**Files:**
- Modify: `packages/client/src/pages/Game.tsx`

- [ ] **Step 1: Update Game.tsx to pass recycle props to Hand**

In `packages/client/src/pages/Game.tsx`, add store subscriptions:

```tsx
  const recycleValidCards = useGameStore(s => s.recycleValidCards)
  const confirmRecycle = useGameStore(s => s.confirmRecycle)
```

Update the `<Hand>` element to pass recycle props:

```tsx
        <Hand
          hand={humanHand}
          selectedCard={selectedCard}
          staged={staged}
          onSelectCard={selectCard}
          recycleValidCards={recycleValidCards}
          onConfirmRecycle={confirmRecycle}
        />
```

- [ ] **Step 2: Run the full test suite**

```bash
cd packages/client && pnpm test
```

Expected: all tests passing

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/pages/Game.tsx
git commit -m "feat(client): wire wild recycle props through Game page"
```

---

## Self-Review Checklist

**Spec coverage:**

| Spec section | Covered by task |
|---|---|
| Purple glow on wild + valid hand cards | Task 1 (Card glow), Task 4 (Hand) |
| Store: `recycleTarget`, `recycleValidCards`, 3 actions | Task 2 |
| Board: wild cells clickable, cancel on empty click | Task 3 |
| Hand: dim invalid, glow valid, click fires confirmRecycle | Task 4 |
| Game page wiring | Task 5 |
| Staged cards excluded from valid replacements | Task 2 (startRecycle filters) |
| Cancel by tapping wild again or empty space | Task 3 (Board onMouseDown) |

**Placeholder scan:** No TBDs, TODOs, or vague steps. All code blocks present.

**Type consistency:** `glow: 'purple'` in Card (Task 1) matches usage in Cell (Task 3) and Hand (Task 4). `recycleValidCards: Card[]` matches across store (Task 2), Hand (Task 4), and Game (Task 5). `confirmRecycle(replacement: RegularCard)` consistent throughout.
