import type { Difficulty } from '@viota/engine'

type Props = {
  scores: number[]
  drawPileCount: number
  playerCount: number
  humanIndex: number
  difficulty: Difficulty
  onZoomIn: () => void
  onZoomOut: () => void
  onAutoFit: () => void
  onRotateCW: () => void
  onRotateCCW: () => void
  playerNames?: string[]
  turnIndex?: number
  turnTimer?: number
  connectionStatus?: 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
  onOpenSettings?: () => void
}

const pill: React.CSSProperties = {
  background: '#1e1e3a', borderRadius: 6, padding: '5px 12px', fontSize: 12, color: '#aaa',
  border: '1px solid transparent',
}
const activePill: React.CSSProperties = {
  ...pill,
  background: '#1e3a2e', border: '1px solid #4ade80', boxShadow: '0 0 0 1px rgba(74,222,128,0.35)',
}
const btn: React.CSSProperties = {
  background: '#1e1e3a', border: '1px solid #3a3a5a', color: '#aaa',
  borderRadius: 4, padding: '3px 10px', fontSize: 13, cursor: 'pointer',
}

export default function TopBar({ scores, drawPileCount, playerCount, humanIndex, difficulty, onZoomIn, onZoomOut, onAutoFit, onRotateCW, onRotateCCW, playerNames, turnIndex, turnTimer, connectionStatus, onOpenSettings }: Props) {
  return (
    <div style={{ background: '#12122a', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #2a2a4a', flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {scores.map((s, i) => {
          const isCurrent = turnIndex !== undefined && i === turnIndex
          return (
            <div key={i} style={isCurrent ? activePill : pill} aria-current={isCurrent ? 'true' : undefined}>
              <span style={{ color: '#fff', fontWeight: 'bold' }}>{playerNames ? playerNames[i] ?? `P${i + 1}` : i === humanIndex ? 'You' : 'AI'}</span>
              {' '}
              <span style={{ color: i === humanIndex ? '#4ade80' : '#aaa', fontWeight: 'bold' }}>{s}</span>
              {isCurrent && <span style={{ color: '#4ade80', marginLeft: 6, fontSize: 11 }} aria-hidden="true">●</span>}
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: 12, color: '#6b7280' }}>
        Draw pile: <span style={{ color: '#fff', fontWeight: 'bold' }}>{drawPileCount}</span>
      </div>
      {turnTimer !== undefined && (
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          Turn: <span style={{ color: '#fff', fontWeight: 'bold' }}>
            {Math.floor(turnTimer / 60)}:{(turnTimer % 60).toString().padStart(2, '0')}
          </span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {onOpenSettings && (
          <button style={btn} onClick={onOpenSettings} aria-label="settings">⚙</button>
        )}
        {connectionStatus && (
          <div
            data-testid="connection-dot"
            style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connectionStatus === 'connected' ? '#4ade80'
                : connectionStatus === 'reconnecting' ? '#eab308' : '#ef4444',
            }}
          />
        )}
        <button style={btn} onClick={onZoomOut} aria-label="zoom out">−</button>
        <button style={btn} onClick={onZoomIn} aria-label="zoom in">+</button>
        <button style={btn} onClick={onAutoFit} aria-label="auto fit">⊞</button>
        <button style={btn} onClick={onRotateCCW} aria-label="rotate counter-clockwise">↺</button>
        <button style={btn} onClick={onRotateCW} aria-label="rotate clockwise">↻</button>
      </div>
    </div>
  )
}
