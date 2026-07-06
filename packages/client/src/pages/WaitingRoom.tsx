import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { serverUrl } from '../net/config'
import { getToken } from '../net/identity'
import { createNudgeChannel } from '../net/nudge'
import { loadSession, clearSession } from '../net/session'
import { fetchRoom, startRoom, type RoomSeat } from '../net/lobby'

const SERVER_URL = serverUrl()
const POLL_MS = 2000

/** Human-readable label for the host's AI-takeover choice (read-only display). */
function aiTakeoverLabel(ms: number | null): string {
  if (ms == null) return '1 min (default)'
  if (ms === 0) return 'Wait for me (never)'
  if (ms % 60000 === 0) return `${ms / 60000} min`
  return `${Math.round(ms / 1000)} sec`
}

/**
 * The room / seat overview before the game starts. Polls GET /sync (waiting) so
 * the roster, the shared code, and the host role stay live, and subscribes to
 * the game socket so a `host_changed` frame flips the Start button to the new
 * host instantly. Start is HOST-ONLY (spec §8): only the seat holding the host
 * role sees the button; everyone else sees "Waiting for host to start…". If any
 * seats are still open, the host confirms (they'll be AI-filled) before dealing.
 */
export default function WaitingRoom() {
  const { code: codeParam } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const session = loadSession()
  const gameId = session?.gameId ?? null
  const mySeat = session?.mySeat ?? 0

  const [seats, setSeats] = useState<RoomSeat[]>([])
  const [roomCode, setRoomCode] = useState(session?.code ?? codeParam ?? '')
  const [hostSeat, setHostSeat] = useState(0)
  const [openSeats, setOpenSeats] = useState(0)
  const [aiTakeoverMs, setAiTakeoverMs] = useState<number | null>(null)
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
        setHostSeat(r.hostSeat)
        setOpenSeats(r.openSeats)
        setAiTakeoverMs(r.aiTakeoverMs)
        if (r.code) setRoomCode(r.code)
      } catch {
        /* transient — the next tick retries */
      }
    }
    poll()
    const id = setInterval(poll, POLL_MS)

    // The socket is a snappier signal than the 2s poll: a host_changed frame
    // re-checks who sees Start. The poll remains the fallback.
    const nudge = createNudgeChannel(SERVER_URL, gameId, {
      getToken,
      getLocalIndex: () => 0,
      sync: () => { /* the component's own poll is the fallback */ },
      onHostChanged: (h) => { if (active) setHostSeat(h) },
    })

    return () => { active = false; clearInterval(id); nudge.close() }
  }, [gameId, navigate])

  const humanCount = seats.filter((s) => s.ownerType === 'human').length
  const isHost = mySeat === hostSeat
  const canStart = isHost && humanCount >= 2 && !starting

  async function handleStart() {
    if (!gameId || !isHost || humanCount < 2) return
    if (openSeats > 0) {
      const ok = window.confirm(`Start with ${openSeats} open seat${openSeats === 1 ? '' : 's'}? They'll be filled by AI.`)
      if (!ok) return
    }
    setStarting(true); setError('')
    try {
      await startRoom(SERVER_URL, gameId)
      navigate('/game/online')
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      // Host role moved out from under us — the poll will refresh who's host.
      setError(msg === 'not_host' ? 'You are no longer the host' : 'Could not start the game — try again')
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
              : `${s.displayName ?? (s.ownerType === 'ai' ? 'AI' : 'Player')}${s.seatIndex === mySeat ? ' (you)' : ''}${s.seatIndex === hostSeat ? ' — host' : ''}`}
          </div>
        ))}
        {humanCount < 2 && (
          <p style={{ color: '#6b7280', fontSize: 12, fontStyle: 'italic' }}>Waiting for more players…</p>
        )}
      </div>

      <p style={{ color: '#6b7280', fontSize: 12 }}>AI takeover: {aiTakeoverLabel(aiTakeoverMs)}</p>

      {error && <p style={{ color: '#ef4444', fontSize: 13 }}>{error}</p>}

      {isHost ? (
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
      ) : (
        <p style={{ color: '#9ca3af', fontSize: 14, fontStyle: 'italic' }}>Waiting for host to start…</p>
      )}

      <button onClick={handleLeave} style={{ background: 'transparent', border: '1px solid #3a3a5a', color: '#9ca3af', borderRadius: 7, padding: '8px 24px', fontSize: 12, cursor: 'pointer' }}>
        Leave
      </button>
    </div>
  )
}
