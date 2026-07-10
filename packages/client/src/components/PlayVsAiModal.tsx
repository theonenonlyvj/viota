import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { useModalDismiss } from '../hooks/useModalDismiss'
import Button from './Button'
import PillButton from './PillButton'

type Difficulty = 'easy' | 'expert'

export default function PlayVsAiModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [opponents, setOpponents] = useState(1)
  const [difficulty, setDifficulty] = useState<Difficulty>('easy')
  const navigate = useNavigate()
  const startGame = useGameStore((s) => s.startGame)
  const cardRef = useRef<HTMLDivElement>(null)
  useModalDismiss(open, onClose, cardRef)
  if (!open) return null

  function start() {
    startGame(opponents + 1, difficulty)
    navigate('/game/local')
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Play vs AI">
      <div className="modal-card" onClick={(e) => e.stopPropagation()} ref={cardRef} tabIndex={-1} style={{ position: 'relative' }}>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            position: 'absolute', top: 10, right: 10, width: 28, height: 28,
            background: 'transparent', border: 'none', color: 'var(--text-muted)',
            fontSize: 18, lineHeight: 1, cursor: 'pointer',
          }}
        >
          ×
        </button>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>AI opponents</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          {[1, 2, 3].map((n) => (
            <PillButton key={n} active={opponents === n} onClick={() => setOpponents(n)}>{n}</PillButton>
          ))}
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>Difficulty</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 22 }}>
          <PillButton active={difficulty === 'easy'} onClick={() => setDifficulty('easy')}>RickBot · not optimizing for points</PillButton>
          <PillButton active={difficulty === 'expert'} onClick={() => setDifficulty('expert')}>Expert</PillButton>
        </div>
        <Button variant="primary" onClick={start}>Start game</Button>
      </div>
    </div>
  )
}
