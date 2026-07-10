import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { serverUrl } from '../net/config'
import { getDisplayName } from '../net/identity'
import { myGames } from '../net/lobby'
import { loadSession, saveSession } from '../net/session'
import WaitingRoom from './WaitingRoom'
import JoinRoom from '../components/JoinRoom'

const SERVER_URL = serverUrl()

/**
 * Gate for /lobby/:code. If the caller already holds a LIVE session for THIS
 * room, show the waiting room; otherwise show the join card (the shareable-
 * link path for a stranger). onJoined bumps local state so the next render
 * re-reads the session and mounts the waiting room.
 *
 * Fix: closing the tab clears sessionStorage, so reopening the invite link
 * used to always land on the join card — even for someone who already owns a
 * seat (waiting OR an already-STARTED game). Durable identity (the localStorage
 * device token) survives that, so resolve it against GET /my-games for a seat
 * in THIS room's code and route straight back in: to the waiting room if still
 * waiting, straight to the live board if the game already started. A genuine
 * stranger (or a device with no games at all) still sees the join card.
 */
export default function Room() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const [, forceRecheck] = useState(0)
  const session = loadSession()
  const inThisRoom =
    !!session?.gameId && (session.code ?? '').toUpperCase() === (code ?? '').toUpperCase()

  useEffect(() => {
    if (inThisRoom || !code) return
    let active = true
    myGames(SERVER_URL).then((games) => {
      if (!active) return
      const mine = games.find((g) => (g.code ?? '').toUpperCase() === code.toUpperCase())
      if (!mine) return
      const players = Array.from({ length: mine.playerCount }, (_, i) =>
        i === mine.seatIndex ? getDisplayName() : `Player ${i + 1}`)
      saveSession({ gameId: mine.gameId, code: mine.code ?? code, mySeat: mine.seatIndex, players })
      if (mine.status === 'waiting') forceRecheck((n) => n + 1) // re-render -> inThisRoom -> WaitingRoom
      else navigate('/game/online')
    }).catch(() => { /* best-effort — falls through to the join card */ })
    return () => { active = false }
  }, [inThisRoom, code, navigate])

  if (inThisRoom) return <WaitingRoom />
  return <JoinRoom code={(code ?? '').toUpperCase()} onJoined={() => forceRecheck((n) => n + 1)} />
}
