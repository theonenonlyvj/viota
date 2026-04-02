import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? (
  import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin
)

export default function Lobby() {
  const [name, setName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  async function handleCreate() {
    if (!name.trim()) { setError('Name is required'); return }
    setError('')
    try {
      const createRes = await fetch(`${SERVER_URL}/rooms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      if (!createRes.ok) { setError('Failed to create room'); return }
      const { code } = await createRes.json()
      const joinRes = await fetch(`${SERVER_URL}/rooms/${code}/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!joinRes.ok) { setError('Failed to join room'); return }
      const { token, playerIndex } = await joinRes.json()
      sessionStorage.setItem('viota_token', token)
      sessionStorage.setItem('viota_room', code)
      sessionStorage.setItem('viota_name', name.trim())
      sessionStorage.setItem('viota_playerIndex', String(playerIndex))
      navigate(`/lobby/${code}`)
    } catch (e) {
      setError(`Cannot reach server at ${SERVER_URL}`)
    }
  }

  async function handleJoin() {
    if (!name.trim()) { setError('Name is required'); return }
    if (!roomCode.trim()) { setError('Room code is required'); return }
    setError('')
    try {
      const code = roomCode.trim().toUpperCase()
      const joinRes = await fetch(`${SERVER_URL}/rooms/${code}/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!joinRes.ok) {
        const body = await joinRes.json().catch(() => ({}))
        setError(body.error ?? 'Failed to join room')
        return
      }
      const { token, playerIndex } = await joinRes.json()
      sessionStorage.setItem('viota_token', token)
      sessionStorage.setItem('viota_room', code)
      sessionStorage.setItem('viota_name', name.trim())
      sessionStorage.setItem('viota_playerIndex', String(playerIndex))
      navigate(`/lobby/${code}`)
    } catch (e) {
      setError(`Cannot reach server at ${SERVER_URL}`)
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

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
      <h1 style={{ fontSize: 48, fontWeight: 'bold', color: '#e2e8f0', letterSpacing: 4 }}>Viota</h1>
      <input style={inputStyle} placeholder="Your name" value={name} onChange={e => setName(e.target.value)} maxLength={20} />
      {error && <p style={{ color: '#ef4444', fontSize: 13 }}>{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 280 }}>
        <button style={btnStyle} onClick={handleCreate}>Create Room</button>
        <div style={{ borderTop: '1px solid #2a2a4a', paddingTop: 16 }}>
          <input
            style={{ ...inputStyle, marginBottom: 10, textTransform: 'uppercase', textAlign: 'center', letterSpacing: 8, fontSize: 18 }}
            placeholder="Room code" value={roomCode} onChange={e => setRoomCode(e.target.value)} maxLength={4}
          />
          <button style={{ ...btnStyle, width: '100%' }} onClick={handleJoin}>Join Room</button>
        </div>
      </div>
      <button onClick={() => navigate('/')} style={{ background: 'transparent', border: '1px solid #3a3a5a', color: '#9ca3af', borderRadius: 7, padding: '8px 24px', fontSize: 12, cursor: 'pointer' }}>
        Back to Home
      </button>
    </div>
  )
}
