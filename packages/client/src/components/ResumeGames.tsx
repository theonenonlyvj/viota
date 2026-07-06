import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { serverUrl } from '../net/config'
import { getDisplayName } from '../net/identity'
import { myGames, type ResumableGame } from '../net/lobby'
import { saveSession } from '../net/session'

const SERVER_URL = serverUrl()

/** Coarse "time ago" label for the last-active timestamp. */
function ago(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/**
 * "Resume your games" — the caller's saved waiting/active games (GET /my-games).
 * Games are DURABLE server-side, so tapping one picks it back up exactly where
 * it paused: a waiting game returns to its room; an active game reopens the
 * board (OnlineGame syncs + reconciles on mount). Renders nothing when there is
 * nothing to resume (e.g. a device that has never authed).
 */
export default function ResumeGames() {
  const navigate = useNavigate()
  const [games, setGames] = useState<ResumableGame[]>([])

  useEffect(() => {
    let active = true
    myGames(SERVER_URL).then((g) => { if (active) setGames(g) }).catch(() => {})
    return () => { active = false }
  }, [])

  function resume(g: ResumableGame) {
    // We don't have the full roster here; seed sensible placeholder names (my
    // seat = my stored name). The room/board fills the real roster on load.
    const players = Array.from({ length: g.playerCount }, (_, i) =>
      i === g.seatIndex ? getDisplayName() : `Player ${i + 1}`,
    )
    saveSession({ gameId: g.gameId, code: g.code ?? '', mySeat: g.seatIndex, players })
    if (g.status === 'waiting') navigate(`/lobby/${g.code ?? ''}`)
    else navigate('/game/online') // active — OnlineGame syncs + reconciles on mount
  }

  if (games.length === 0) return null

  return (
    <div style={{ width: 300 }}>
      <p style={{ color: '#9ca3af', fontSize: 12, marginBottom: 8, textAlign: 'center' }}>
        Your saved games — pick up where you left off
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {games.map((g) => (
          <button
            key={g.gameId}
            onClick={() => resume(g)}
            style={{
              background: '#1e1e3a', border: '1px solid #3a3a5a', color: '#e2e8f0',
              borderRadius: 7, padding: '8px 12px', fontSize: 13, cursor: 'pointer',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
            }}
          >
            <span style={{ fontWeight: 'bold', letterSpacing: 2 }}>{g.code ?? '—'}</span>
            <span style={{ color: '#9ca3af', fontSize: 11 }}>
              {g.status === 'waiting' ? 'in lobby' : 'in play'} · seat {g.seatIndex + 1} · {ago(g.lastActivityAt)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
