import { useRef } from 'react'
import { useModalDismiss } from '../hooks/useModalDismiss'
import Button from './Button'
import { QUICK_REF } from '../rules/content'

type Props = {
  open: boolean
  onClose: () => void
  onOpenHowToPlay: () => void
  onQuit: () => void
  onNewGame?: () => void
}

export default function SettingsMenu({ open, onClose, onOpenHowToPlay, onQuit, onNewGame }: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  useModalDismiss(open, onClose, cardRef)
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Settings">
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        ref={cardRef}
        tabIndex={-1}
        style={{ maxWidth: 460, maxHeight: '86dvh', overflowY: 'auto' }}
      >
        <h2 style={{ fontFamily: 'Luckiest Guy', fontSize: 22, marginBottom: 14 }}>Settings</h2>
        <div style={{ marginBottom: 18 }}>
          {QUICK_REF.map(section => (
            <section key={section.id} style={{ marginBottom: 12 }}>
              <h3 style={{ fontFamily: 'Luckiest Guy', fontSize: 14, marginBottom: 4 }}>{section.title}</h3>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.45 }}>{section.body}</div>
            </section>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={onOpenHowToPlay}>Full how to play</Button>
          {onNewGame && <Button variant="secondary" onClick={onNewGame}>New game</Button>}
          <Button variant="secondary" onClick={onQuit}>Quit to menu</Button>
        </div>
      </div>
    </div>
  )
}
