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
}

const pill: React.CSSProperties = {
  background: '#1e1e3a', borderRadius: 6, padding: '5px 12px', fontSize: 12, color: '#aaa',
}
const btn: React.CSSProperties = {
  background: '#1e1e3a', border: '1px solid #3a3a5a', color: '#aaa',
  borderRadius: 4, padding: '3px 10px', fontSize: 13, cursor: 'pointer',
}

export default function TopBar({ scores, drawPileCount, playerCount, humanIndex, difficulty, onZoomIn, onZoomOut, onAutoFit, onRotateCW, onRotateCCW }: Props) {
  return (
    <div style={{ background: '#12122a', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #2a2a4a', flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {scores.map((s, i) => (
          <div key={i} style={pill}>
            <span style={{ color: '#fff', fontWeight: 'bold' }}>{i === humanIndex ? 'You' : `AI`}</span>
            {' '}
            <span style={{ color: i === humanIndex ? '#4ade80' : '#aaa', fontWeight: 'bold' }}>{s}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: '#6b7280' }}>
        Draw pile: <span style={{ color: '#fff', fontWeight: 'bold' }}>{drawPileCount}</span>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={btn} onClick={onZoomOut} aria-label="zoom out">−</button>
        <button style={btn} onClick={onZoomIn} aria-label="zoom in">+</button>
        <button style={btn} onClick={onAutoFit} aria-label="auto fit">⊞</button>
        <button style={btn} onClick={onRotateCCW} aria-label="rotate counter-clockwise">↺</button>
        <button style={btn} onClick={onRotateCW} aria-label="rotate clockwise">↻</button>
      </div>
    </div>
  )
}
