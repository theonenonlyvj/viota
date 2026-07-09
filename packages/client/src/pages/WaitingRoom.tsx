import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { serverUrl } from '../net/config'
import { getToken } from '../net/identity'
import { createNudgeChannel } from '../net/nudge'
import { loadSession, clearSession } from '../net/session'
import { fetchRoom, startRoom, leaveGame, type RoomSeat } from '../net/lobby'
import Button from '../components/Button'

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

    // The socket is a snappier signal than the 2s poll: a `started` frame
    // navigates joiners into the game the instant the host deals, and a
    // host_changed frame re-checks who sees Start. The poll remains the fallback.
    const nudge = createNudgeChannel(SERVER_URL, gameId, {
      getToken,
      getLocalIndex: () => 0,
      sync: () => { /* the component's own poll is the fallback */ },
      onHostChanged: (h) => { if (active) setHostSeat(h) },
      onStarted: () => { if (active) navigate('/game/online') },
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
    // Tell the server we're leaving (best-effort) BEFORE dropping local state, so
    // a departing host is promoted to a remaining player and the room isn't left
    // un-startable. Navigation proceeds regardless of the request's outcome.
    if (gameId) leaveGame(SERVER_URL, gameId)
    clearSession()
    navigate('/')
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, padding: '84px 20px 48px' }}>
      <h1 style={{ fontFamily: 'Luckiest Guy', fontSize: 'clamp(36px, 7vw, 56px)', color: '#fff', textShadow: '0 0 42px rgba(34,211,238,.4)' }}>
        vi<span style={{ color: 'var(--brand-cyan)' }}>o</span>ta
      </h1>

      <div className="panel" style={{ width: '100%', maxWidth: 380 }}>
        <p className="panel__label" style={{ textAlign: 'center' }}>Room</p>
        <div style={{ fontFamily: 'Luckiest Guy', fontSize: 40, color: 'var(--brand-cyan)', letterSpacing: 8, textAlign: 'center', textShadow: '0 0 28px rgba(34,211,238,.5)' }}>{roomCode}</div>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6, textAlign: 'center' }}>share this code with friends</p>

        <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '18px 0 8px' }}>Players ({humanCount})</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {seats.map((s) => (
            <div key={s.seatIndex} className={`seat-row${s.ownerType === 'open' ? ' seat-row--open' : ''}`}>
              {s.ownerType === 'open' ? (
                <span>Open seat…</span>
              ) : (
                <>
                  <span>{s.displayName ?? (s.ownerType === 'ai' ? 'AI' : 'Player')}{s.seatIndex === mySeat ? ' (you)' : ''}</span>
                  {s.seatIndex === hostSeat && <span className="seat-row__tag">host</span>}
                </>
              )}
            </div>
          ))}
          {humanCount < 2 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>Waiting for more players…</p>
          )}
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 16 }}>AI takeover: {aiTakeoverLabel(aiTakeoverMs)}</p>
      </div>

      {error && <p style={{ color: 'var(--text-error)', fontSize: 13 }}>{error}</p>}

      {isHost ? (
        <Button variant="primary" disabled={!canStart} onClick={handleStart}>Start Game</Button>
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: 14, fontStyle: 'italic' }}>Waiting for host to start…</p>
      )}

      <button className="ghost-btn" onClick={handleLeave}>Leave</button>
    </div>
  )
}
