import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { serverUrl } from '../net/config'
import { createOnlineGame, joinOnlineGame } from '../net/lobby'
import { claimGhostGames } from '../net/ghost'
import { saveSession } from '../net/session'

const SERVER_URL = serverUrl()

export default function Lobby() {
  const [name, setName] = useState('')
  const [opponents, setOpponents] = useState(1)
  const [roomCode, setRoomCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function handleCreate() {
    if (!name.trim()) { setError('Name is required'); return }
    setError(''); setBusy(true)
    try {
      const created = await createOnlineGame(SERVER_URL, { displayName: name.trim(), opponents })
      // Claim any device ghost games into the fresh account (fire-and-forget).
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

  const inputStyle: React.CSSProperties = {
    background: '#1e1e3a', border: '1px solid #3a3a5a', color: '#e2e8f0',
    borderRadius: 7, padding: '8px 14px', fontSize: 14, width: '100%',
  }
  const btnStyle: React.CSSProperties = {
    background: '#3b82f6', border: 'none', color: '#fff',
    borderRadius: 7, padding: '10px 24px', fontSize: 14, fontWeight: 'bold', cursor: 'pointer',
  }
  const optBtn = (active: boolean): React.CSSProperties => ({
    background: active ? '#3b82f6' : '#1e1e3a',
    border: active ? '1px solid #3b82f6' : '1px solid #3a3a5a',
    color: '#fff', borderRadius: 7, padding: '8px 18px', fontSize: 14, cursor: 'pointer',
    fontWeight: active ? 'bold' : 'normal',
  })

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
      <h1 style={{ fontSize: 48, fontWeight: 'bold', color: '#e2e8f0', letterSpacing: 4 }}>Viota</h1>
      <input style={inputStyle} placeholder="Your name" value={name} onChange={e => setName(e.target.value)} maxLength={24} />
      {error && <p style={{ color: '#ef4444', fontSize: 13, maxWidth: 320, textAlign: 'center' }}>{error}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 300 }}>
        <div>
          <p style={{ color: '#9ca3af', fontSize: 12, marginBottom: 8, textAlign: 'center' }}>AI Opponents</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {[1, 2, 3].map(n => (
              <button key={n} style={optBtn(opponents === n)} onClick={() => setOpponents(n)}>{n}</button>
            ))}
          </div>
        </div>
        <button style={{ ...btnStyle, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={handleCreate}>
          Create Online Game
        </button>

        <div style={{ borderTop: '1px solid #2a2a4a', paddingTop: 16 }}>
          <input
            style={{ ...inputStyle, marginBottom: 10, textTransform: 'uppercase', textAlign: 'center', letterSpacing: 6, fontSize: 16 }}
            placeholder="Room code" value={roomCode} onChange={e => setRoomCode(e.target.value)} maxLength={8}
          />
          <button style={{ ...btnStyle, width: '100%', opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={handleJoin}>Join Room</button>
        </div>
      </div>

      <button onClick={() => navigate('/')} style={{ background: 'transparent', border: '1px solid #3a3a5a', color: '#9ca3af', borderRadius: 7, padding: '8px 24px', fontSize: 12, cursor: 'pointer' }}>
        Back to Home
      </button>
    </div>
  )
}
