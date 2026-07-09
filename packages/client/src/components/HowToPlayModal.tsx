import { useRef } from 'react'
import { useModalDismiss } from '../hooks/useModalDismiss'
import Button from './Button'

/** SEAM: placeholder until the how-to-play agent ships the real rules screen.
 *  Keep the component name + { open, onClose } prop shape stable. */
export default function HowToPlayModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null)
  useModalDismiss(open, onClose, cardRef)
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="How to play">
      <div className="modal-card" onClick={(e) => e.stopPropagation()} ref={cardRef} tabIndex={-1}>
        <h2 style={{ fontFamily: 'Luckiest Guy', fontSize: 24, marginBottom: 10 }}>How to play</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>Rules coming soon.</p>
        <Button variant="primary" onClick={onClose}>Close</Button>
      </div>
    </div>
  )
}
