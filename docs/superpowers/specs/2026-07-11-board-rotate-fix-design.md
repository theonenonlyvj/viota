# Board rotate fix — cards stay upright + rotation persists (Design Spec)

**Date:** 2026-07-11 · **Scope:** viota client only (no engine, no worker, no protocol, no gameplay logic).
**Approved by Vijay 2026-07-11.**

## Problem (two bugs in the existing board-rotate)
The board's ↺/↻ buttons rotate the whole cell grid with one CSS transform
(`packages/client/src/components/Board.tsx:191`, `rotate(${rotation}deg)` on the container holding all cells).

1. **Cards become unreadable when rotated.** Because every card is a child of that rotated container, each
   card's shape + number (`Card.tsx`, the number is `position:absolute; bottom:1; right:3`) spins with the
   board — so after 90° it's sideways, after 180° it's upside-down.
2. **Rotation isn't saved.** `rotation` is local component state (`useState(0)`) and `autofit()` calls
   `setRotation(0)` (`Board.tsx:79,91`). autofit runs on board changes / re-fits, which in online play happen
   on every move + sync — so the rotation constantly snaps back to 0. It also resets on reload.

## Design
**Wanted behavior (Vijay-confirmed):** rotating re-orients the board *layout*, but each card stays **upright
and readable** at every angle; the chosen rotation **persists**. There is no "proper" card orientation — an
Iota card is its color+shape+number regardless of visual turn — so cards are simply always shown upright.

### 1. Counter-rotate card content (cards stay upright)
Thread the board `rotation` down to the card render and counter-rotate the card by `-rotation` so its net
on-screen orientation is always 0 (upright), while its *position* still rides the rotated layout.
- `Board.tsx` passes `rotation` into each `Cell` (and/or `Card`).
- The card element applies `transform: rotate(${-rotation}deg)` (compose with any existing transform).
- Apply to **every readable card variant**: `placed`, `staged`, `wild` (★), `wild-targeted` (glow),
  and the selected/valid highlights. Empty/border-only cells (no content) don't need it.
- Rotation is always a 90° multiple, so counter-rotated cards stay axis-aligned (crisp, no blurriness) and
  their bounding boxes stay axis-aligned → **click/tap hit-testing is unaffected** (placement + wild-recycle
  clicks keep working). Verify handlers remain wired.

### 2. Persist the rotation
- **Remove the `setRotation(0)` resets** in `autofit()`. autofit re-centers/zooms to fit the board; it must
  **preserve the current rotation**.
- **Re-centering must be correct for a rotated board.** Today the transform is
  `translate(panX,panY) scale(zoom) rotate(rotation)` with `transformOrigin: '0 0'`, and autofit computes
  pan to center the board's center assuming no rotation — so with rotation≠0 the board would drift off-center.
  Fix so that after `autofit` at any rotation the board is centered + fully visible. Simplest robust approach:
  rotate about the board's **center** (set `transformOrigin` to the board center, or fold the rotation into
  the pan math) so rotation doesn't move the center autofit targets. Implementer picks the cleanest; the
  acceptance test is behavioral (below).
- **Survive reload:** persist the angle to `localStorage` (e.g. key `viota_board_rotation`) and restore on
  mount. (A personal view preference; global is fine.)

## Acceptance criteria / tests (client, vitest + testing-library)
1. At each of 0/90/180/270, a rendered placed card carries a `-rotation` counter-transform (net upright).
   (Assert the card/cell style contains `rotate(-90deg)` etc., or the composed transform nets to upright.)
2. Rotating, then triggering an autofit / board-state update (simulating an online move+sync), **keeps** the
   rotation (it is NOT reset to 0).
3. On mount, rotation is restored from `localStorage`; changing rotation writes it back.
4. `onPlace` / `onRecycle` / `onUnstage` handlers are still invoked when the corresponding cell/card is
   clicked at a non-zero rotation (hit-testing intact).
5. Full client suite stays green (≥294) + the new tests. Worker/engine untouched.

## Non-goals
- Wild-recycle **affordance/hint** (the functionality already works via clicking the wild — only the
  discoverability is missing). Deferred to the backlog.
- Pan/zoom behavior (unchanged, except autofit no longer nukes rotation).
- Any gameplay/engine/worker/protocol change.

## Files
`packages/client/src/components/Board.tsx`, `Cell.tsx`, `Card.tsx` (+ their tests). Client-only.
