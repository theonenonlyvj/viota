import { useNavigate, useParams } from 'react-router-dom'
import { loadSession } from '../net/session'

/**
 * The room / seat overview before entering the game. Games are created with
 * fixed seats (me + AI), so this is a share-the-code + start step. Host-only
 * start is dropped (spec §8): any player can start once ≥2 seats are present.
 */
export default function WaitingRoom() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const session = loadSession()
  const players = session?.players ?? []
  const roomCode = session?.code ?? code ?? ''
  const canStart = players.length >= 2

  const pill: React.CSSProperties = {
    background: '#1e1e3a', borderRadius: 8, padding: '8px 16px', color: '#e2e8f0', fontSize: 14,
  }

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 20 }}>Room</h2>
      <div style={{ fontSize: 44, fontWeight: 'bold', color: '#3b82f6', letterSpacing: 10 }}>{roomCode}</div>
      <p style={{ color: '#9ca3af', fontSize: 13 }}>Share this code with friends</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 220 }}>
        <p style={{ color: '#9ca3af', fontSize: 12 }}>Players ({players.length})</p>
        {players.map((name, i) => (
          <div key={i} style={pill}>{name}{i === (session?.mySeat ?? 0) ? ' (you)' : ''}</div>
        ))}
        {players.length < 2 && (
          <p style={{ color: '#6b7280', fontSize: 12, fontStyle: 'italic' }}>Waiting for more players...</p>
        )}
      </div>

      <button
        disabled={!canStart}
        style={{
          background: canStart ? '#16a34a' : '#2a2a4a',
          border: 'none', color: '#fff', borderRadius: 8,
          padding: '12px 40px', fontSize: 16, fontWeight: 'bold',
          cursor: canStart ? 'pointer' : 'default',
        }}
        onClick={() => navigate('/game/online')}
      >
        Start Game
      </button>

      <button onClick={() => navigate('/')} style={{ background: 'transparent', border: '1px solid #3a3a5a', color: '#9ca3af', borderRadius: 7, padding: '8px 24px', fontSize: 12, cursor: 'pointer' }}>
        Leave
      </button>
    </div>
  )
}
