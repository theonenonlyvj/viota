import Overlay from './Overlay'
import { QUICK_REF } from '../rules/content'

const primaryBtn: React.CSSProperties = {
  background: '#3b82f6', border: 'none', color: '#fff',
  borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 'bold', cursor: 'pointer',
}

const secondaryBtn: React.CSSProperties = {
  background: '#1e1e3a', border: '1px solid #3a3a5a', color: '#9ca3af',
  borderRadius: 7, padding: '9px 20px', fontSize: 13, cursor: 'pointer',
}

const dangerBtn: React.CSSProperties = {
  background: '#1e1e3a', border: '1px solid #7c2d2d', color: '#f87171',
  borderRadius: 7, padding: '9px 20px', fontSize: 13, cursor: 'pointer',
}

type Props = {
  onClose: () => void
  onOpenHowToPlay: () => void
  onQuit: () => void
  onNewGame?: () => void
}

export default function SettingsMenu({ onClose, onOpenHowToPlay, onQuit, onNewGame }: Props) {
  return (
    <Overlay title="Settings" onClose={onClose} maxWidth={480}>
      <div style={{ marginBottom: 16 }}>
        {QUICK_REF.map(section => (
          <section key={section.id} style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 4, color: '#e2e8f0' }}>{section.title}</h3>
            <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.4 }}>{section.body}</div>
          </section>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={onOpenHowToPlay} style={primaryBtn}>Full How to Play</button>
        {onNewGame && (
          <button onClick={onNewGame} style={secondaryBtn}>New game</button>
        )}
        <button onClick={onQuit} style={dangerBtn}>Quit to menu</button>
      </div>
    </Overlay>
  )
}
