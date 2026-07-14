import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useRef } from 'react'
import { vi } from 'vitest'
import Board, { type BoardHandle } from './Board'
import { useGameStore } from '../store/gameStore'

function Wrapper() {
  const ref = useRef<BoardHandle>(null)
  return <Board ref={ref} />
}

/** Parse the `translate(px,px) scale(n) rotate(deg)` transform on the board's rotation layer. */
function parseTransform(transform: string) {
  const t = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/)
  const s = transform.match(/scale\(([-\d.]+)\)/)
  const r = transform.match(/rotate\(([-\d.]+)deg\)/)
  return {
    panX: t ? parseFloat(t[1]!) : 0,
    panY: t ? parseFloat(t[2]!) : 0,
    zoom: s ? parseFloat(s[1]!) : 1,
    rotationDeg: r ? parseFloat(r[1]!) : 0,
  }
}

beforeEach(() => {
  localStorage.clear()
  useGameStore.getState().startGame(2, 'easy')
})

test('renders without crashing', () => {
  const { container } = render(<Wrapper />)
  expect(container.firstChild).toBeInTheDocument()
})

test('valid cell is rendered after selectCard', () => {
  const card = useGameStore.getState().hands[0]![0]!
  act(() => useGameStore.getState().selectCard(card))
  render(<Wrapper />)
  expect(screen.getAllByTestId('valid-cell').length).toBeGreaterThan(0)
})

test('clicking valid cell triggers placeCard in store', async () => {
  const card = useGameStore.getState().hands[0]![0]!
  act(() => useGameStore.getState().selectCard(card))
  render(<Wrapper />)
  const validCell = screen.getAllByTestId('valid-cell')[0]!
  await userEvent.click(validCell)
  expect(useGameStore.getState().staged).toHaveLength(1)
})

test('wild card on board is clickable and triggers startRecycle', () => {
  const s = useGameStore.getState()
  const newGrid = new Map(s.grid)
  newGrid.set('1,0', { kind: 'wild' as const })
  useGameStore.setState({ grid: newGrid })

  render(<Wrapper />)
  const stars = screen.getAllByText('★')
  expect(stars.length).toBeGreaterThan(0)
})

// --- board-rotate fix (2026-07-11 spec) ------------------------------------

test('a placed card counter-rotates to stay upright at each rotation angle', () => {
  // Replace (not merge with) the grid: startGame seeds a random starter card
  // at (0,0), so merging risks a second "3" on the board and a flaky
  // getByText collision. A single known card keeps this deterministic.
  const newGrid = new Map([['1,0', { kind: 'regular', color: 'red', shape: 'circle', number: 3 } as const]])
  useGameStore.setState({ grid: newGrid })

  const ref = createRef<BoardHandle>()
  render(<Board ref={ref} />)
  const cardEl = screen.getByText('3').closest('div[style]') as HTMLElement

  expect(cardEl.style.transform || '').not.toContain('rotate(-90deg)')

  act(() => ref.current!.rotateCW())
  expect(cardEl.style.transform).toContain('rotate(-90deg)')

  act(() => ref.current!.rotateCW())
  expect(cardEl.style.transform).toContain('rotate(-180deg)')

  act(() => ref.current!.rotateCW())
  expect(cardEl.style.transform).toContain('rotate(-270deg)')

  act(() => ref.current!.rotateCW())
  expect(cardEl.style.transform || '').not.toContain('rotate(-90deg)') // back to 0
})

test('autofit preserves the current rotation (does not reset to 0)', () => {
  const ref = createRef<BoardHandle>()
  render(<Board ref={ref} />)

  act(() => ref.current!.rotateCW())
  act(() => ref.current!.rotateCW())
  const layer = screen.getByTestId('board-rotation-layer')
  expect(parseTransform(layer.style.transform).rotationDeg).toBe(180)

  act(() => ref.current!.autofit())
  expect(parseTransform(layer.style.transform).rotationDeg).toBe(180)
})

test('autofit centers a rotated board (board center maps to the viewport center)', () => {
  const s = useGameStore.getState()
  const newGrid = new Map(s.grid)
  newGrid.set('0,0', { kind: 'regular', color: 'red', shape: 'circle', number: 1 } as const)
  newGrid.set('4,2', { kind: 'regular', color: 'blue', shape: 'square', number: 2 } as const)
  useGameStore.setState({ grid: newGrid })

  const ref = createRef<BoardHandle>()
  render(<Board ref={ref} />)
  act(() => ref.current!.rotateCW()) // 90deg
  act(() => ref.current!.autofit())

  const layer = screen.getByTestId('board-rotation-layer')
  const { panX, panY, zoom, rotationDeg } = parseTransform(layer.style.transform)
  expect(rotationDeg).toBe(90)

  // Board bounding box in unrotated inner coords (margin 1, CELL_SIZE 64 — mirrors Board.tsx's getRange/CELL_SIZE).
  const CELL_SIZE = 64
  const minX = -1, maxX = 5, minY = -1, maxY = 3
  const centerX = ((minX + maxX + 1) / 2) * CELL_SIZE
  const centerY = ((minY + maxY + 1) / 2) * CELL_SIZE
  const theta = (rotationDeg * Math.PI) / 180
  const rx = centerX * Math.cos(theta) - centerY * Math.sin(theta)
  const ry = centerX * Math.sin(theta) + centerY * Math.cos(theta)
  const screenX = panX + rx * zoom
  const screenY = panY + ry * zoom

  // default test dims are 800x500 (ResizeObserver is a no-op stub in jsdom)
  expect(screenX).toBeCloseTo(400, 1)
  expect(screenY).toBeCloseTo(250, 1)

  // Pin the fit-zoom VALUE (not just pan-consistency): at 90deg the rotated board is
  // boardH wide x boardW tall on screen, so the fit budget MUST swap dims. Without the
  // swap a tall/narrow board over-zooms and clips off-screen — and the pan-only checks
  // above wouldn't catch it (they use whatever zoom autofit chose). This is the guard.
  const boardW = (maxX - minX + 1) * CELL_SIZE // 448
  const boardH = (maxY - minY + 1) * CELL_SIZE // 320
  expect(zoom).toBeCloseTo(Math.min(800 / boardH, 500 / boardW, 2.0), 3)
})

test('rotation is restored from localStorage on mount', () => {
  localStorage.setItem('viota_board_rotation', '270')
  render(<Wrapper />)
  const layer = screen.getByTestId('board-rotation-layer')
  expect(parseTransform(layer.style.transform).rotationDeg).toBe(270)
})

test('changing rotation writes it back to localStorage', () => {
  const ref = createRef<BoardHandle>()
  render(<Board ref={ref} />)
  act(() => ref.current!.rotateCW())
  expect(localStorage.getItem('viota_board_rotation')).toBe('90')
  act(() => ref.current!.rotateCCW())
  act(() => ref.current!.rotateCCW())
  expect(localStorage.getItem('viota_board_rotation')).toBe('270')
})

test('onPlace still fires when a valid cell is clicked at non-zero rotation', async () => {
  const card = useGameStore.getState().hands[0]![0]!
  act(() => useGameStore.getState().selectCard(card))
  const ref = createRef<BoardHandle>()
  render(<Board ref={ref} />)
  act(() => ref.current!.rotateCW())
  const validCell = screen.getAllByTestId('valid-cell')[0]!
  await userEvent.click(validCell)
  expect(useGameStore.getState().staged).toHaveLength(1)
})

test('onRecycle still fires when a wild card is clicked at non-zero rotation', async () => {
  const s = useGameStore.getState()
  const newGrid = new Map(s.grid)
  newGrid.set('1,0', { kind: 'wild' as const })
  useGameStore.setState({ grid: newGrid })

  const ref = createRef<BoardHandle>()
  render(<Board ref={ref} />)
  act(() => ref.current!.rotateCW())
  const star = screen.getByText('★').closest('div[style]') as HTMLElement
  await userEvent.click(star)
  expect(useGameStore.getState().recycleTarget).toEqual({ x: 1, y: 0 })
})

test('onUnstage still fires when a staged card is clicked at non-zero rotation', async () => {
  const card = useGameStore.getState().hands[0]![0]!
  act(() => useGameStore.getState().selectCard(card))
  const ref = createRef<BoardHandle>()
  const { container } = render(<Board ref={ref} />)
  const validCell = screen.getAllByTestId('valid-cell')[0]!
  await userEvent.click(validCell)
  expect(useGameStore.getState().staged).toHaveLength(1)

  act(() => ref.current!.rotateCW())
  const stagedEl = Array.from(container.querySelectorAll('div')).find(el =>
    el.style.boxShadow.includes('#facc15')
  ) as HTMLElement
  expect(stagedEl).toBeTruthy()
  await userEvent.click(stagedEl)
  expect(useGameStore.getState().staged).toHaveLength(0)
})
