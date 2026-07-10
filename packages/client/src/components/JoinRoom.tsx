import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { serverUrl } from '../net/config'
import { joinOnlineGame } from '../net/lobby'
import { getDisplayName } from '../net/identity'
import { saveSession } from '../net/session'
import Button from './Button'

const SERVER_URL = serverUrl()

/** Shareable-link join card shown at /lobby/:code when the visitor isn't yet in
 *  the room. On success saves the session + calls onJoined so the Room gate
 *  swaps in the WaitingRoom. Reuses joinOnlineGame — no new network. */
export default function JoinRoom({ code, onJoined }: { code: string; onJoined: () => void }) {
  const [name, setName] = useState(() => {
    const initial = getDisplayName()
    return initial === 'Player' ? '' : initial
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function handleJoin() {
    if (busy) return
    if (!name.trim()) { setError('Name is required'); return }
    setError(''); setBusy(true)
    try {
      const joined = await joinOnlineGame(SERVER_URL, { code, displayName: name.trim() })
      saveSession({ gameId: joined.gameId, code: joined.code, mySeat: joined.mySeat, players: joined.players })
      // Fix #3's idempotent resume: I already own a seat in a STARTED game —
      // go straight into it (mirrors Room.tsx's /my-games auto-resolve path)
      // instead of signaling onJoined, which would swap in the waiting room.
      if (joined.resumed) navigate('/game/online')
      else onJoined()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join room')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, padding: '84px 20px 48px' }}>
      <h1 style={{ fontFamily: 'Luckiest Guy', fontSize: 'clamp(36px, 7vw, 56px)', color: '#fff', textShadow: '0 0 42px rgba(34,211,238,.4)' }}>
        vi<span style={{ color: 'var(--brand-cyan)' }}>o</span>ta
      </h1>
      <div className="panel" style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
        <p className="panel__label" style={{ textAlign: 'center' }}>You're invited</p>
        <div style={{ fontFamily: 'Luckiest Guy', fontSize: 40, color: 'var(--brand-cyan)', letterSpacing: 8, textShadow: '0 0 28px rgba(34,211,238,.5)' }}>{code}</div>
        <input className="field" aria-label="Your name" style={{ margin: '20px 0 0' }} placeholder="Your name" value={name}
          onChange={(e) => setName(e.target.value)} maxLength={24}
          onKeyDown={(e) => { if (e.key === 'Enter') handleJoin() }} />
        {error && <p style={{ color: 'var(--text-error)', fontSize: 13, margin: '10px 0 0' }}>{error}</p>}
        <div style={{ marginTop: 16 }}>
          <Button variant="primary" disabled={busy} onClick={handleJoin}>Join room</Button>
        </div>
      </div>
      <button className="ghost-btn" onClick={() => navigate('/')}>Back to Home</button>
    </div>
  )
}
