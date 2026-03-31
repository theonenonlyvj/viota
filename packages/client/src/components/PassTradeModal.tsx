import { useState } from 'react'
import type { Card } from '@viota/engine'
import CardComp from './Card'

type Props = {
  hand: Card[]
  onConfirm: (trades: Card[], tradeOrder: Card[]) => void
  onClose: () => void
}

export default function PassTradeModal({ hand, onConfirm, onClose }: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
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
