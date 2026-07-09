import { useEffect, useRef } from 'react'

type Props = { title?: string; onClose: () => void; children: React.ReactNode; maxWidth?: number }

export default function Overlay({ title, onClose, children, maxWidth = 560 }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [onClose])

  return (
    <div
      data-testid="overlay-backdrop"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}
    >
      <div
        data-testid="overlay-panel"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
        style={{ background: '#1e1e3a', border: '1px solid #3a3a5a', borderRadius: 12, padding: 24, width: '100%', maxWidth, maxHeight: '85dvh', overflowY: 'auto', color: '#e2e8f0', outline: 'none' }}
      >
        {title && <h2 style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 12 }}>{title}</h2>}
        {children}
        <button onClick={onClose} aria-label="close" style={{ marginTop: 16, background: '#1e1e3a', border: '1px solid #3a3a5a', color: '#9ca3af', borderRadius: 7, padding: '8px 16px', cursor: 'pointer' }}>Close</button>
      </div>
    </div>
  )
}
