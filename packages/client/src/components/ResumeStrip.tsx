import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { serverUrl } from '../net/config'
import { getDisplayName } from '../net/identity'
import { myGames, placeholderPlayers, type ResumableGame } from '../net/lobby'
import { saveSession } from '../net/session'
import { useLocalResumableGame } from '../hooks/useLocalResumableGame'

const SERVER_URL = serverUrl()

function ago(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function ResumeStrip() {
  const navigate = useNavigate()
  const [online, setOnline] = useState<ResumableGame[]>([])
  const local = useLocalResumableGame()

  useEffect(() => {
    let active = true
    myGames(SERVER_URL).then((g) => { if (active) setOnline(g) }).catch(() => {})
    return () => { active = false }
  }, [])

  function resumeOnline(g: ResumableGame) {
    const players = placeholderPlayers(g.playerCount, g.seatIndex, getDisplayName())
    saveSession({ gameId: g.gameId, code: g.code ?? '', mySeat: g.seatIndex, players })
    if (g.status === 'waiting') navigate(`/lobby/${g.code ?? ''}`)
    else navigate('/game/online')
  }

  if (online.length === 0 && !local) return null

  return (
    <div className="resume-strip">
      {local && (
        <button className="resume-row" onClick={() => navigate('/game/local')}>
          <span style={{ fontWeight: 600 }}>vs AI</span>
          <span className="resume-row__meta">in play · {ago(local.lastActivityAt)}</span>
        </button>
      )}
      {online.map((g) => (
        <button key={g.gameId} className="resume-row" onClick={() => resumeOnline(g)}>
          <span style={{ fontWeight: 600, letterSpacing: 2 }}>{g.code ?? '—'}</span>
          <span className="resume-row__meta">
            {g.status === 'waiting' ? 'in lobby' : 'in play'} · seat {g.seatIndex + 1} · {ago(g.lastActivityAt)}
          </span>
        </button>
      ))}
    </div>
  )
}
