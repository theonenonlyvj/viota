import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { serverUrl } from '../net/config'
import { createOnlineRoom, joinOnlineGame } from '../net/lobby'
import { claimGhostGames } from '../net/ghost'
import { saveSession } from '../net/session'
import Button from '../components/Button'
import ResumeStrip from '../components/ResumeStrip'

const SERVER_URL = serverUrl()

/** AI-takeover patience for a dropped player. `0` = "wait for me" (never cover). */
const AI_TAKEOVER_OPTIONS: { label: string; value: number }[] = [
  { label: '30 sec', value: 30000 },
  { label: '1 min', value: 60000 },
  { label: '2 min', value: 120000 },
  { label: '5 min', value: 300000 },
  { label: 'Wait for me', value: 0 },
]

const pill = (active: boolean): React.CSSProperties => ({
  background: active ? 'rgba(34,211,238,.18)' : 'rgba(255,255,255,.06)',
  border: active ? '1.5px solid var(--brand-cyan)' : '1.5px solid rgba(255,255,255,.2)',
  color: '#fff', clipPath: 'var(--chamfer)', padding: '8px 16px', cursor: 'pointer',
  fontFamily: 'Fredoka', fontWeight: 500, fontSize: 14,
})

export default function Lobby() {
  const [name, setName] = useState('')
  const [players, setPlayers] = useState(2)          // total seats (2–4)
  const [roomCode, setRoomCode] = useState('')
  const [aiTakeoverMs, setAiTakeoverMs] = useState(60000)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function handleCreateRoom() {
    if (!name.trim()) { setError('Name is required'); return }
    setError(''); setBusy(true)
    try {
      const created = await createOnlineRoom(SERVER_URL, { displayName: name.trim(), playerCount: players, aiTakeoverMs })
      claimGhostGames(SERVER_URL).catch(() => {})
      saveSession({ gameId: created.gameId, code: created.code, mySeat: created.mySeat, players: created.players })
      navigate(`/lobby/${created.code}`)
    } catch {
      setError(`Cannot reach server at ${SERVER_URL}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleJoin() {
    if (!name.trim()) { setError('Name is required'); return }
    if (!roomCode.trim()) { setError('Room code is required'); return }
    setError(''); setBusy(true)
    try {
      const joined = await joinOnlineGame(SERVER_URL, { code: roomCode.trim().toUpperCase(), displayName: name.trim() })
      saveSession({ gameId: joined.gameId, code: joined.code, mySeat: joined.mySeat, players: joined.players })
      navigate(`/lobby/${joined.code}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join room')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: '84px 20px 48px' }}>
      <h1 style={{ fontFamily: 'Luckiest Guy', fontSize: 'clamp(44px, 8vw, 68px)', color: '#fff', letterSpacing: '.01em', textShadow: '0 0 42px rgba(34,211,238,.4)' }}>
        vi<span style={{ color: 'var(--brand-cyan)' }}>o</span>ta
      </h1>

      <input className="field" style={{ maxWidth: 360 }} placeholder="Your name" value={name} onChange={e => setName(e.target.value)} maxLength={24} />
      {error && <p style={{ color: '#ff6b6b', fontSize: 13, maxWidth: 340, textAlign: 'center' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', justifyContent: 'center', width: '100%', maxWidth: 780 }}>
        {/* CREATE */}
        <div className="panel" style={{ flex: '1 1 300px', maxWidth: 380 }}>
          <p className="panel__label">Create a room</p>
          <p className="panel__sublabel" style={{ marginTop: 0 }}>Players</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {[2, 3, 4].map(n => (
              <button key={n} className="modal-pill" aria-pressed={players === n} style={pill(players === n)} onClick={() => setPlayers(n)}>{n}</button>
            ))}
          </div>
          <p className="panel__sublabel">If someone drops, AI covers after</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {AI_TAKEOVER_OPTIONS.map(o => (
              <button key={o.value} className="modal-pill" aria-pressed={aiTakeoverMs === o.value} style={pill(aiTakeoverMs === o.value)} onClick={() => setAiTakeoverMs(o.value)}>{o.label}</button>
            ))}
          </div>
          <div style={{ marginTop: 22 }}>
            <Button variant="primary" disabled={busy} onClick={handleCreateRoom}>Create Room</Button>
          </div>
        </div>

        {/* JOIN */}
        <div className="panel" style={{ flex: '1 1 240px', maxWidth: 380, display: 'flex', flexDirection: 'column' }}>
          <p className="panel__label">Join a room</p>
          <input className="field" style={{ textTransform: 'uppercase', textAlign: 'center', letterSpacing: 6, fontSize: 16, marginBottom: 16 }} placeholder="Room code" value={roomCode} onChange={e => setRoomCode(e.target.value)} maxLength={8} />
          <Button variant="secondary" disabled={busy} onClick={handleJoin}>Join Room</Button>
        </div>
      </div>

      <ResumeStrip />

      <button className="ghost-btn" onClick={() => navigate('/')}>Back to Home</button>
    </div>
  )
}
