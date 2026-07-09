import { useRef, useState } from 'react'
import { posKey } from '@viota/engine'
import type { Card, Grid, Placement, Position, RegularCard } from '@viota/engine'
import { useModalDismiss } from '../hooks/useModalDismiss'
import Button from './Button'
import StaticBoard from './StaticBoard'
import Hand from './Hand'
import { RULES_SECTIONS } from '../rules/content'
import { CONCEPT_CHECKS } from '../practice/solver'
import { computeValidPositions } from '../gameLogic'

const R = (color: string, shape: string, number: number): RegularCard =>
  ({ kind: 'regular', color, shape, number } as RegularCard)

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
    <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.12)', clipPath: 'var(--chamfer)', padding: 16, marginTop: 8 }}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
        Try it — tap a hand card, then tap a highlighted cell to complete a line.
      </p>
      <StaticBoard grid={DEMO_GRID} staged={staged} validPositions={validPositions} onPlace={onPlace} onUnstage={onUnstage} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 16, flexWrap: 'wrap' }}>
        <Hand hand={DEMO_HAND} selectedCard={selectedCard} staged={staged} onSelectCard={setSelectedCard} />
        <button
          type="button"
          onClick={onReset}
          style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.16)', color: 'var(--text-muted)', clipPath: 'var(--chamfer)', padding: '6px 14px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'Fredoka' }}
        >
          Reset demo
        </button>
      </div>
      {solved && (
        <p style={{ color: 'var(--brand-cyan)', fontWeight: 700, marginTop: 10 }} aria-label="demo solved">
          ✓ That's a line! Any two cards can start one.
        </p>
      )}
    </div>
  )
}

export default function HowToPlayModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null)
  useModalDismiss(open, onClose, cardRef)
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="How to play">
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        ref={cardRef}
        tabIndex={-1}
        style={{ maxWidth: 720, maxHeight: '86dvh', overflowY: 'auto' }}
      >
        <h2 style={{ fontFamily: 'Luckiest Guy', fontSize: 24, marginBottom: 14 }}>How to play</h2>
        {RULES_SECTIONS.map(section => (
          <section key={section.id} style={{ marginBottom: 18 }}>
            <h3 style={{ fontFamily: 'Luckiest Guy', fontSize: 16, marginBottom: 6, color: 'var(--text-hi, #fff)' }}>{section.title}</h3>
            <div style={{ fontSize: 14, color: 'var(--text-body)', lineHeight: 1.55 }}>{section.body}</div>
          </section>
        ))}
        <Demo />
        <div style={{ marginTop: 18 }}>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  )
}
