import { useState } from 'react'
import { posKey } from '@viota/engine'
import type { Card, Grid, Placement, Position, RegularCard } from '@viota/engine'
import Overlay from './Overlay'
import StaticBoard from './StaticBoard'
import Hand from './Hand'
import { RULES_SECTIONS } from '../rules/content'
import { CONCEPT_CHECKS } from '../practice/solver'
import { computeValidPositions } from '../gameLogic'

const R = (color: string, shape: string, number: number): RegularCard => ({ kind: 'regular', color, shape, number } as RegularCard)

// Fixed demo fixture — never mutated, only read to (re)initialize local state.
const DEMO_GRID: Grid = new Map([[posKey({ x: 0, y: 0 }), R('red', 'circle', 1)]])
const DEMO_HAND: Card[] = [
  R('blue', 'triangle', 3),
  R('green', 'square', 4),
  R('yellow', 'plus', 2),
  R('red', 'circle', 4),
]

function Demo() {
  const [selectedCard, setSelectedCard] = useState<Card | null>(null)
  const [staged, setStaged] = useState<Placement[]>([])
  const [solved, setSolved] = useState(false)

  const validPositions = selectedCard ? computeValidPositions(DEMO_GRID, staged, selectedCard) : []

  function onSelectCard(card: Card) {
    setSelectedCard(card)
  }

  function onPlace(position: Position) {
    if (!selectedCard) return
    const next = [...staged, { card: selectedCard, position }]
    setStaged(next)
    setSelectedCard(null)
    if (CONCEPT_CHECKS['any-line'](DEMO_GRID, next)) setSolved(true)
  }

  function onUnstage(position: Position) {
    const key = posKey(position)
    setStaged(s => s.filter(p => posKey(p.position) !== key))
    setSolved(false)
  }

  function onReset() {
    setSelectedCard(null)
    setStaged([])
    setSolved(false)
  }

  return (
    <div style={{ background: '#12122a', border: '1px solid #2a2a4a', borderRadius: 8, padding: 16, marginTop: 8 }}>
      <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 8 }}>
        Try it — tap a hand card, then tap a highlighted cell to complete a line.
      </p>
      <StaticBoard
        grid={DEMO_GRID}
        staged={staged}
        validPositions={validPositions}
        onPlace={onPlace}
        onUnstage={onUnstage}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 16 }}>
        <Hand hand={DEMO_HAND} selectedCard={selectedCard} staged={staged} onSelectCard={onSelectCard} />
        <button
          onClick={onReset}
          style={{ background: '#1e1e3a', border: '1px solid #3a3a5a', color: '#9ca3af', borderRadius: 7, padding: '6px 14px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          Reset demo
        </button>
      </div>
      {solved && (
        <p style={{ color: '#4ade80', fontWeight: 'bold', marginTop: 10 }} aria-label="demo solved">
          ✓ That's a line! Any two cards can start one.
        </p>
      )}
    </div>
  )
}

export default function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="How to Play" onClose={onClose} maxWidth={720}>
      {RULES_SECTIONS.map(section => (
        <section key={section.id} style={{ marginBottom: 18 }}>
          <h3 style={{ fontSize: 15, fontWeight: 'bold', marginBottom: 6, color: '#e2e8f0' }}>{section.title}</h3>
          <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>{section.body}</div>
        </section>
      ))}
      <Demo />
    </Overlay>
  )
}
