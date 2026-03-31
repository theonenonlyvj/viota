import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'

export default function Home() {
  const [opponents, setOpponents] = useState(1)
  const [difficulty, setDifficulty] = useState<'easy' | 'expert'>('easy')
  const navigate = useNavigate()
  const startGame = useGameStore(s => s.startGame)

  function handleStart() {
    startGame(opponents + 1, difficulty)
    navigate('/game/local')
  }

  const btnGroup: React.CSSProperties = { display: 'flex', gap: 8 }
  const btnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? '#3b82f6' : '#1e1e3a',
    border: active ? '1px solid #3b82f6' : '1px solid #3a3a5a',
    color: '#fff', borderRadius: 7, padding: '8px 20px',
    fontSize: 14, cursor: 'pointer', fontWeight: active ? 'bold' : 'normal',
  })

  return (
    <div style={{
      height: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 32,
    }}>
      <h1 style={{ fontSize: 48, fontWeight: 'bold', color: '#e2e8f0', letterSpacing: 4 }}>Viota</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center' }}>
        <div>
          <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 10, textAlign: 'center' }}>AI Opponents</p>
          <div style={btnGroup}>
            {[1, 2, 3].map(n => (
              <button key={n} style={btnStyle(opponents === n)} onClick={() => setOpponents(n)}>{n}</button>
            ))}
          </div>
        </div>

        <div>
          <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 10, textAlign: 'center' }}>Difficulty</p>
          <div style={btnGroup}>
            {(['easy', 'expert'] as const).map(d => (
              <button key={d} style={btnStyle(difficulty === d)} onClick={() => setDifficulty(d)}>
                {d === 'easy' ? 'RickBot (nOt OpTiMiZiNg FoR PoInTs)' : 'Expert'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={handleStart}
        style={{
          background: '#3b82f6', border: 'none', color: '#fff',
          borderRadius: 8, padding: '12px 40px', fontSize: 16,
          fontWeight: 'bold', cursor: 'pointer',
        }}
      >
        Start Game
      </button>
    </div>
  )
}
