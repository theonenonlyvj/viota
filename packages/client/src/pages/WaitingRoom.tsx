import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { serverUrl } from '../net/config'
import { loadSession, clearSession } from '../net/session'
import { fetchRoom, startRoom, type RoomSeat } from '../net/lobby'

const SERVER_URL = serverUrl()
const POLL_MS = 2000

/**
 * The room / seat overview before the game starts. Polls GET /sync (waiting) so
 * the roster + the shared code stay live, and — since the host-only-start gate is
 * dropped (spec §8) — ANY player can Start once >=2 humans are seated. When the
 * game is dealt (by any player), the poll sees the flip and everyone navigates in.
 */
export default function WaitingRoom() {
  const { code: codeParam } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const session = loadSession()
  const gameId = session?.gameId ?? null
  const mySeat = session?.mySeat ?? 0

  const [seats, setSeats] = useState<RoomSeat[]>([])
  const [roomCode, setRoomCode] = useState(session?.code ?? codeParam ?? '')
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!gameId) { navigate('/', { replace: true }); return }
    let active = true
    async function poll() {
      try {
        const r = await fetchRoom(SERVER_URL, gameId!)
        if (!active) return
        if (r.status === 'started') { navigate('/game/online'); return }
        setSeats(r.seats)
        if (r.code) setRoomCode(r.code)
      } catch {
        /* transient — the next tick retries */
      }
    }
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => { active = false; clearInterval(id) }
  }, [gameId, navigate])

  const humanCount = seats.filter((s) => s.ownerType === 'human').length
  const canStart = humanCount >= 2 && !starting

  async function handleStart() {
    if (!gameId || humanCount < 2) return
    setStarting(true); setError('')
    try {
      await startRoom(SERVER_URL, gameId)
      navigate('/game/online')
    } catch {
      setError('Could not start the game — try again')
      setStarting(false)
    }
  }

  function handleLeave() {
    clearSession()
    navigate('/')
  }

  const pill: React.CSSProperties = {
    background: '#1e1e3a', borderRadius: 8, padding: '8px 16px', color: '#e2e8f0', fontSize: 14,
  }

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 20 }}>Room</h2>
      <div style={{ fontSize: 44, fontWeight: 'bold', color: '#3b82f6', letterSpacing: 10 }}>{roomCode}</div>
      <p style={{ color: '#9ca3af', fontSize: 13 }}>Share this code with friends</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 220 }}>
        <p style={{ color: '#9ca3af', fontSize: 12 }}>Players ({humanCount})</p>
        {seats.map((s) => (
          <div key={s.seatIndex} style={{ ...pill, opacity: s.ownerType === 'open' ? 0.5 : 1 }}>
            {s.ownerType === 'open'
              ? 'Open seat…'
              : `${s.displayName ?? (s.ownerType === 'ai' ? 'AI' : 'Player')}${s.seatIndex === mySeat ? ' (you)' : ''}`}
          </div>
        ))}
        {humanCount < 2 && (
          <p style={{ color: '#6b7280', fontSize: 12, fontStyle: 'italic' }}>Waiting for more players…</p>
        )}
      </div>

      {error && <p style={{ color: '#ef4444', fontSize: 13 }}>{error}</p>}

      <button
        disabled={!canStart}
        style={{
          background: canStart ? '#16a34a' : '#2a2a4a',
          border: 'none', color: '#fff', borderRadius: 8,
          padding: '12px 40px', fontSize: 16, fontWeight: 'bold',
          cursor: canStart ? 'pointer' : 'default',
        }}
        onClick={handleStart}
      >
        Start Game
      </button>

      <button onClick={handleLeave} style={{ background: 'transparent', border: '1px solid #3a3a5a', color: '#9ca3af', borderRadius: 7, padding: '8px 24px', fontSize: 12, cursor: 'pointer' }}>
        Leave
      </button>
    </div>
  )
}
