# Wild Card Recycling UI — Design Spec

## Feature

Allow the human player to recycle a wild card on the board by tapping it and selecting a valid replacement from their hand. Two-tap interaction, no modal.

## Rules Reference

> "You may 'recycle' a Wild card already in play prior to starting your turn by exchanging it with a card from your hand that fits any and all line(s) it may be a part of. You may then replay it on any turn."

## Interaction Flow

1. **It's the human's turn** (phase: `idle` or `placing`)
2. Player taps a wild card on the board
3. The wild gets a **purple glow** (`#c084fc`), and the store computes which unstaged hand cards are valid replacements using `validateWildRecycle`
4. Valid hand cards get a **purple glow**; invalid/staged cards dim to 0.3 opacity
5. Player taps a valid hand card → `recycleWild(wildPosition, replacement)` fires
6. The replacement card moves to the board, the wild returns to the player's hand
7. A brief **green flash** confirms the swap
8. Any staged placements remain — player continues their turn

**Cancel:** Tap the highlighted wild again, or tap empty board space → exits recycle mode.

## State Changes

New store field: `recycleTarget: Position | null` — the board position of the wild being recycled, or `null` when not in recycle mode.

New store actions:
- `startRecycle(position: Position)` — sets `recycleTarget`, computes valid replacements
- `cancelRecycle()` — clears `recycleTarget`
- `confirmRecycle(replacement: RegularCard)` — calls existing `recycleWild`, clears `recycleTarget`

New derived state: `recycleValidCards: Card[]` — unstaged hand cards that pass `validateWildRecycle` for the target position.

## Component Changes

- **Board.tsx:** Wild cards on the board become clickable during human's turn. Clicking sets `recycleTarget`. Purple glow on the targeted wild. Clicking the wild again or empty space cancels.
- **Hand.tsx:** When `recycleTarget` is set, valid replacement cards get purple glow, invalid/staged cards dim. Clicking a valid card fires `confirmRecycle`.
- **Cell.tsx:** New variant or conditional styling for wild cards when they're recyclable (subtle indicator) vs actively targeted (purple glow).

## Visual Language

- **Purple** (`#c084fc` / `#7c3aed`) for recycle mode — distinct from yellow (card selection) and green (valid placement)
- Dimming at 0.3 opacity for unavailable cards (same as staged-card dimming)
- Green flash on completion (same as existing score feedback)
