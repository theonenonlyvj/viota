import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { loadSession } from '../net/session'
import WaitingRoom from './WaitingRoom'
import JoinRoom from '../components/JoinRoom'

/** Gate for /lobby/:code. If the caller already holds a session for THIS room,
 *  show the waiting room; otherwise show the join card (the shareable-link path).
 *  onJoined bumps local state so the next render re-reads the session and mounts
 *  the waiting room. */
export default function Room() {
  const { code } = useParams<{ code: string }>()
  const [, forceRecheck] = useState(0)
  const session = loadSession()
  const inThisRoom =
    !!session?.gameId && (session.code ?? '').toUpperCase() === (code ?? '').toUpperCase()

  if (inThisRoom) return <WaitingRoom />
  return <JoinRoom code={(code ?? '').toUpperCase()} onJoined={() => forceRecheck((n) => n + 1)} />
}
