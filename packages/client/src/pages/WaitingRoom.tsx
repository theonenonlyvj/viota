import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { createConnection, type Connection } from '../net/connection'
import { useGameStore } from '../store/gameStore'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? (
  import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin
)

const TIMEOUT_OPTIONS = [
  { label: '30s', value: 30 },
  { label: '1min', value: 60 },
  { label: '2min', value: 120 },
  { label: '5min', value: 300 },
]

export default function WaitingRoom() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const connRef = useRef<Connection | null>(null)
  const [players, setPlayers] = useState<string[]>([])
  const [disconnectTimeout, setDisconnectTimeout] = useState(120)
  const myName = sessionStorage.getItem('viota_name') ?? ''
  const myIndex = parseInt(sessionStorage.getItem('viota_playerIndex') ?? '0', 10)
  const token = sessionStorage.getItem('viota_token') ?? ''
  const isHost = myIndex === 0
  const initOnline = useGameStore(s => s.initOnline)
  const applyServerState = useGameStore(s => s.applyServerState)
  const setConnection = useGameStore(s => s.setConnection)
  const setConnectionStatus = useGameStore(s => s.setConnectionStatus)

  useEffect(() => {
    if (!code || !token) return
    setPlayers([myName])
    const conn = createConnection(SERVER_URL, code, token)
    connRef.current = conn
    conn.onStatusChange(setConnectionStatus)
    conn.onMessage((msg: any) => {
      if (msg.type === 'playerJoined') {
        setPlayers(prev => [...prev, msg.playerName])
      }
      if (msg.type === 'gameStarted') {
        initOnline(myIndex, players.length > 0 ? players : [myName])
        setConnection(conn)
        applyServerState(msg.view)
        navigate('/game/online')
      }
    })
    return () => conn.close()
  }, [code, token])

  function handleStart() {
    connRef.current?.send({ type: 'startGame' })
  }

  const pill: React.CSSProperties = {
    background: '#1e1e3a', borderRadius: 8, padding: '8px 16px', color: '#e2e8f0', fontSize: 14,
  }
  const btnActive: React.CSSProperties = {
    background: '#3b82f6', border: '1px solid #3b82f6', color: '#fff',
    borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 'bold',
  }
  const btnInactive: React.CSSProperties = {
    background: '#1e1e3a', border: '1px solid #3a3a5a', color: '#9ca3af',
    borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer',
  }

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 20 }}>Room</h2>
      <div style={{ fontSize: 48, fontWeight: 'bold', color: '#3b82f6', letterSpacing: 12 }}>{code}</div>
      <p style={{ color: '#9ca3af', fontSize: 13 }}>Share this code with friends</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 200 }}>
        <p style={{ color: '#9ca3af', fontSize: 12 }}>Players ({players.length}/4)</p>
        {players.map((name, i) => (
          <div key={i} style={pill}>{name} {i === 0 && '(host)'}</div>
        ))}
        {players.length < 2 && (
          <p style={{ color: '#6b7280', fontSize: 12, fontStyle: 'italic' }}>Waiting for more players...</p>
        )}
      </div>

      {isHost && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          <p style={{ color: '#9ca3af', fontSize: 12 }}>Disconnect timeout</p>
          <div style={{ display: 'flex', gap: 6 }}>
            {TIMEOUT_OPTIONS.map(opt => (
              <button key={opt.value} style={disconnectTimeout === opt.value ? btnActive : btnInactive} onClick={() => setDisconnectTimeout(opt.value)}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {isHost ? (
        <button
          disabled={players.length < 2}
          style={{
            background: players.length >= 2 ? '#16a34a' : '#2a2a4a',
            border: 'none', color: '#fff', borderRadius: 8,
            padding: '12px 40px', fontSize: 16, fontWeight: 'bold',
            cursor: players.length >= 2 ? 'pointer' : 'default',
          }}
          onClick={handleStart}
        >
          Start Game
        </button>
      ) : (
        <p style={{ color: '#9ca3af', fontSize: 14 }}>Waiting for host to start...</p>
      )}
    </div>
  )
}
