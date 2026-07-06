import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import Board, { type BoardHandle } from '../components/Board'
import Hand from '../components/Hand'
import TopBar from '../components/TopBar'
import PassTradeModal from '../components/PassTradeModal'
import { serverUrl } from '../net/config'
import { createOnlineClient } from '../net/online'
import { createNudgeChannel } from '../net/nudge'
import { runReconcile, attachForegroundReconcile } from '../net/reconcile'
import { getToken, getDisplayName } from '../net/identity'
import { createOnlineRoom, leaveGame } from '../net/lobby'
import { loadSession, saveSession, clearSession, type OnlineSession } from '../net/session'

const SERVER_URL = serverUrl()
const HEARTBEAT_MS = 20_000

export default function OnlineGame() {
  const navigate = useNavigate()
  const boardRef = useRef<BoardHandle>(null)
  const [showPassModal, setShowPassModal] = useState(false)
  const [session, setSession] = useState<OnlineSession | null>(() => loadSession())

  const phase = useGameStore(s => s.phase)
  const scores = useGameStore(s => s.scores)
  const hands = useGameStore(s => s.hands)
  const staged = useGameStore(s => s.staged)
  const selectedCard = useGameStore(s => s.selectedCard)
  const playerCount = useGameStore(s => s.playerCount)
  const difficulty = useGameStore(s => s.difficulty)
  const mySeat = useGameStore(s => s.mySeat)
  const turnIndex = useGameStore(s => s.turnIndex)
  const drawPileCount = useGameStore(s => s.drawPileCount)
  const finished = useGameStore(s => s.finished)
  const pending = useGameStore(s => s.pending)
  const aiCoverSeat = useGameStore(s => s.aiCoverSeat)
  const reclaimable = useGameStore(s => s.reclaimable)
  const vetoOffer = useGameStore(s => s.vetoOffer)
  const selectCard = useGameStore(s => s.selectCard)
  const onlinePlay = useGameStore(s => s.onlinePlay)
  const onlinePass = useGameStore(s => s.onlinePass)
  const recycleValidCards = useGameStore(s => s.recycleValidCards)
  const onlineConfirmRecycle = useGameStore(s => s.onlineConfirmRecycle)
  const reclaimSeat = useGameStore(s => s.reclaimSeat)
  const doVeto = useGameStore(s => s.doVeto)
  const dismissAiCover = useGameStore(s => s.dismissAiCover)

  const players = session?.players ?? []

  // No session -> back home.
  useEffect(() => {
    if (!session) navigate('/', { replace: true })
  }, [session, navigate])

  // The whole online net lifecycle, keyed on the game id (re-runs on Rematch).
  useEffect(() => {
    if (!session) return
    const { gameId, mySeat: seat } = session
    const client = createOnlineClient(SERVER_URL, gameId, seat)
    const store = useGameStore
    store.getState().startOnline(gameId, seat)
    store.getState().setOnlineClient(client)

    const localIndex = () => store.getState().moveIndex
    const applySync = (r: Parameters<ReturnType<typeof store.getState>['applySync']>[0]) =>
      store.getState().applySync(r)
    const reconcile = (withReclaim: boolean) =>
      runReconcile({ client, getLocalIndex: localIndex, applySync }, { withReclaim }).catch(() => {})

    // Register presence (so AI seats get driven) then pull authoritative truth.
    client.heartbeat().catch(() => {})
    reconcile(false)

    const nudge = createNudgeChannel(SERVER_URL, gameId, {
      getToken,
      getLocalIndex: localIndex,
      sync: () => store.getState().resync(),
      onAiCover: (s) => store.getState().handleAiCover(s),
      onVeto: () => { /* the frame handler already re-syncs */ },
      onOpen: () => reconcile(false),
    })

    const hb = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') client.heartbeat().catch(() => {})
    }, HEARTBEAT_MS)

    const detach = attachForegroundReconcile((trigger) => {
      client.heartbeat().catch(() => {})
      nudge.reopen() // returning to the tab forces an immediate socket reconnect
      reconcile(trigger === 'visible') // silent reclaim on visibility→visible
    })

    return () => {
      clearInterval(hb)
      detach()
      nudge.close()
      store.getState().setOnlineClient(null)
    }
  }, [session])

  function handlePlayAgain() {
    // Open a fresh MULTIPLAYER waiting room (same seat count) so friends can
    // regroup by code; the host Starts and any empty seats AI-fill. (The old
    // "Rematch" dropped every human into an isolated solo-vs-AI game.)
    createOnlineRoom(SERVER_URL, { displayName: getDisplayName(), playerCount })
      .then((created) => {
        const next: OnlineSession = { gameId: created.gameId, code: created.code, mySeat: created.mySeat, players: created.players }
        saveSession(next)
        navigate(`/lobby/${created.code}`)
      })
      .catch(() => {})
  }

  function handleLeave() {
    // Intentional leave: tell the server to AI-cover my seat IMMEDIATELY (skips
    // the grace window a silent drop waits for), then drop the socket + go home.
    if (session) leaveGame(SERVER_URL, session.gameId)
    clearSession()
    setSession(null)
    navigate('/')
  }

  const isMyTurn = turnIndex === mySeat && !finished
  const humanHand = hands[mySeat] ?? []
  const canConfirm = staged.length > 0 && phase === 'placing' && isMyTurn && !pending

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <TopBar
        scores={scores}
        drawPileCount={drawPileCount}
        playerCount={playerCount}
        humanIndex={mySeat}
        difficulty={difficulty}
        onZoomIn={() => boardRef.current?.zoomIn()}
        onZoomOut={() => boardRef.current?.zoomOut()}
        onAutoFit={() => boardRef.current?.autofit()}
        onRotateCW={() => boardRef.current?.rotateCW()}
        onRotateCCW={() => boardRef.current?.rotateCCW()}
        playerNames={players}
      />

      {reclaimable && (
        <div style={banner('#7c3aed')}>
          <span>AI is covering your seat while you were away.</span>
          <button style={bannerBtn} onClick={reclaimSeat}>Reclaim</button>
        </div>
      )}

      {vetoOffer && !reclaimable && (
        <div style={banner('#b45309')}>
          <span>The AI played your turn.</span>
          <button style={bannerBtn} onClick={doVeto}>Undo &amp; play</button>
        </div>
      )}

      {aiCoverSeat != null && aiCoverSeat !== mySeat && (
        <div style={banner('#1e3a5f')}>
          <span>AI is holding {players[aiCoverSeat] ?? `Player ${aiCoverSeat + 1}`}'s seat — they can rejoin anytime.</span>
          <button style={bannerBtn} onClick={dismissAiCover}>Dismiss</button>
        </div>
      )}

      <Board ref={boardRef} />

      <div style={{
        background: '#12122a', padding: '12px 16px', borderTop: '1px solid #2a2a4a',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        opacity: pending ? 0.55 : 1,
      }}>
        <Hand
          hand={humanHand}
          selectedCard={selectedCard}
          staged={staged}
          onSelectCard={selectCard}
          recycleValidCards={recycleValidCards}
          onConfirmRecycle={onlineConfirmRecycle}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'stretch', minWidth: 130 }}>
          {pending && <span style={{ color: '#93c5fd', fontSize: 12, textAlign: 'center' }}>Sending…</span>}
          <button
            disabled={!canConfirm}
            onClick={onlinePlay}
            style={{
              background: canConfirm ? '#16a34a' : '#2a2a4a', border: 'none', color: '#fff',
              borderRadius: 7, padding: '9px 0', fontSize: 13, fontWeight: 'bold',
              cursor: canConfirm ? 'pointer' : 'default',
            }}
          >
            Confirm Play
          </button>
          <button
            disabled={!isMyTurn || pending}
            onClick={() => setShowPassModal(true)}
            style={{
              background: '#1e1e3a', border: '1px solid #3a3a5a', color: '#9ca3af',
              borderRadius: 7, padding: '7px 0', fontSize: 12,
              cursor: !isMyTurn || pending ? 'default' : 'pointer',
            }}
          >
            Pass / Trade
          </button>
        </div>
      </div>

      {showPassModal && (
        <PassTradeModal
          hand={humanHand}
          onConfirm={(trades, tradeOrder) => { onlinePass(trades, tradeOrder); setShowPassModal(false) }}
          onClose={() => setShowPassModal(false)}
        />
      )}

      {finished && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
        }}>
          <div style={{ background: '#1e1e3a', borderRadius: 12, padding: 32, border: '1px solid #3a3a5a', textAlign: 'center', minWidth: 300 }}>
            <h2 style={{ color: '#e2e8f0', marginBottom: 8 }}>Game Over</h2>
            <p style={{ color: '#93c5fd', fontWeight: 'bold', marginBottom: 16 }}>{winnerLabel(scores, players, mySeat)}</p>
            {scores.map((s, i) => (
              <p key={i} style={{ color: '#9ca3af', marginBottom: 8 }}>
                {players[i] ?? `Player ${i + 1}`}: <span style={{ color: '#fff', fontWeight: 'bold' }}>{s}</span>
              </p>
            ))}
            <button
              onClick={handlePlayAgain}
              style={{ marginTop: 16, background: '#3b82f6', border: 'none', color: '#fff', borderRadius: 7, padding: '10px 24px', fontSize: 14, fontWeight: 'bold', cursor: 'pointer' }}
            >
              Play again
            </button>
            <button
              onClick={handleLeave}
              style={{ marginTop: 8, background: 'transparent', border: '1px solid #3a3a5a', color: '#9ca3af', borderRadius: 7, padding: '8px 24px', fontSize: 12, cursor: 'pointer', display: 'block', width: '100%' }}
            >
              Leave
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function banner(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#fff', padding: '8px 16px', display: 'flex',
    alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 13, flexShrink: 0,
  }
}
const bannerBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.35)', color: '#fff',
  borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap',
}

function winnerLabel(scores: number[], players: string[], mySeat: number): string {
  if (scores.length === 0) return ''
  const max = Math.max(...scores)
  const winner = scores.indexOf(max)
  if (winner === mySeat) return 'You win!'
  return `${players[winner] ?? `Player ${winner + 1}`} wins`
}
