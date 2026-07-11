import type { Card as CardType } from '@viota/engine'

const SHAPE_COLOR: Record<string, string> = {
  red: '#ef4444',
  blue: '#3b82f6',
  yellow: '#eab308',
  green: '#22c55e',
}

function ShapeSvg({ card }: { card: Extract<CardType, { kind: 'regular' }> }) {
  const fill = SHAPE_COLOR[card.color]!
  if (card.shape === 'circle')
    return <svg width="34" height="34" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill={fill} stroke="#111" strokeWidth="1.5"/></svg>
  if (card.shape === 'triangle')
    return <svg width="34" height="34" viewBox="0 0 32 32"><polygon points="16,4 28,28 4,28" fill={fill} stroke="#111" strokeWidth="1.5"/></svg>
  if (card.shape === 'plus')
    return <svg width="34" height="34" viewBox="0 0 32 32"><line x1="16" y1="4" x2="16" y2="28" stroke={fill} strokeWidth="12" strokeLinecap="round"/><line x1="4" y1="16" x2="28" y2="16" stroke={fill} strokeWidth="12" strokeLinecap="round"/></svg>
  // square
  return <svg width="34" height="34" viewBox="0 0 32 32"><rect x="6" y="6" width="20" height="20" rx="3" fill={fill} stroke="#111" strokeWidth="1.5"/></svg>
}

type Props = {
  card: CardType
  selected?: boolean
  glow?: 'purple'
  onClick?: () => void
  /**
   * Current board rotation (deg) this card is being rendered under. The card
   * counter-rotates by `-rotation` so its shape+number stay upright/readable
   * regardless of the board's orientation — position still rides the rotated
   * board layout (handled by the parent), only the card's own content spins
   * back. Always a 90deg multiple, so the card stays axis-aligned.
   */
  rotation?: number
}

export default function Card({ card, selected = false, glow, onClick, rotation = 0 }: Props) {
  let shadow = '0 2px 8px rgba(0,0,0,0.4)'
  if (glow === 'purple') {
    shadow = '0 0 0 2.5px #c084fc, 0 0 14px rgba(192,132,252,0.4)'
  } else if (selected) {
    shadow = '0 0 0 2.5px #facc15, 0 0 14px rgba(250,204,21,0.35)'
  }

  const style: React.CSSProperties = {
    width: 56,
    height: 56,
    background: '#fff',
    borderRadius: 7,
    boxShadow: shadow,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    cursor: onClick ? 'pointer' : 'default',
    flexShrink: 0,
    transform: rotation ? `rotate(${-rotation}deg)` : undefined,
  }

  if (card.kind === 'wild') {
    return (
      <div style={style} onClick={onClick}>
        <span style={{
          width: 30, height: 30, borderRadius: 4,
          background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: '#fff', fontSize: 15, fontWeight: 'bold' }}>★</span>
        </span>
      </div>
    )
  }

  return (
    <div style={style} onClick={onClick}>
      <ShapeSvg card={card} />
      <span style={{
        position: 'absolute', bottom: 1, right: 3,
        fontSize: 18, fontWeight: 'bold', color: '#333',
      }}>
        {card.number}
      </span>
    </div>
  )
}
