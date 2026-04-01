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
  const recycleTarget = useGameStore(s => s.recycleTarget)
  const startRecycle = useGameStore(s => s.startRecycle)
  const cancelRecycle = useGameStore(s => s.cancelRecycle)
  const phase = useGameStore(s => s.phase)
  const humanIndex = useGameStore(s => s.humanIndex)
  const turnIndex = useGameStore(s => s.turnIndex)

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
    if (recycleTarget) {
      cancelRecycle()
      return
    }
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
