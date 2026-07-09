import Cell from './Cell'
import { posKey, fromKey } from '@viota/engine'
import type { Grid, Placement, Position } from '@viota/engine'

const SIZE = 64 // cell + gap footprint

type Props = { grid: Grid; staged: Placement[]; validPositions: Position[]; onPlace: (pos: Position) => void; onUnstage: (pos: Position) => void }

export default function StaticBoard({ grid, staged, validPositions, onPlace, onUnstage }: Props) {
  const stagedMap = new Map(staged.map(p => [posKey(p.position), p.card]))
  const cells: { pos: Position; node: React.ReactNode }[] = []
  const allKeys = new Set<string>([...grid.keys(), ...stagedMap.keys(), ...validPositions.map(posKey)])
  const positions = [...allKeys].map(fromKey)
  const minX = Math.min(...positions.map(p => p.x)), maxX = Math.max(...positions.map(p => p.x))
  const minY = Math.min(...positions.map(p => p.y)), maxY = Math.max(...positions.map(p => p.y))
  const cols = maxX - minX + 1, rows = maxY - minY + 1

  for (const key of grid.keys()) cells.push({ pos: fromKey(key), node: <Cell variant="placed" card={grid.get(key)!} /> })
  for (const [key, card] of stagedMap) cells.push({ pos: fromKey(key), node: <Cell variant="staged" card={card} onUnstage={() => onUnstage(fromKey(key))} /> })
  for (const pos of validPositions) cells.push({ pos, node: <Cell variant="valid" onPlace={() => onPlace(pos)} /> })

  return (
    <div style={{ overflow: 'auto', maxWidth: '100%', display: 'flex', justifyContent: 'center', padding: 8 }}>
      <div style={{ position: 'relative', width: cols * SIZE, height: rows * SIZE, flexShrink: 0 }}>
        {cells.map((c, i) => (
          <div key={i} style={{ position: 'absolute', left: (c.pos.x - minX) * SIZE, top: (maxY - c.pos.y) * SIZE }}>
            {c.node}
          </div>
        ))}
      </div>
    </div>
  )
}
