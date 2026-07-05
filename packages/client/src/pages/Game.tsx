import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import Board, { type BoardHandle } from '../components/Board'
import Hand from '../components/Hand'
import TopBar from '../components/TopBar'
import PassTradeModal from '../components/PassTradeModal'
import type { Move } from '@viota/engine'

export default function Game() {
  const navigate = useNavigate()
  const boardRef = useRef<BoardHandle>(null)
  const [showPassModal, setShowPassModal] = useState(false)

  const grid = useGameStore(s => s.grid)

  // Redirect to home if no game is active (e.g. page refresh)
  useEffect(() => {
    if (grid.size === 0) navigate('/', { replace: true })
  }, [grid.size, navigate])

  const setWorker = useGameStore(s => s.setWorker)
  const handleWorkerMessage = useGameStore(s => s.handleWorkerMessage)
  const phase = useGameStore(s => s.phase)
  const scores = useGameStore(s => s.scores)
  const drawPile = useGameStore(s => s.drawPile)
  const hands = useGameStore(s => s.hands)
  const staged = useGameStore(s => s.staged)
  const selectedCard = useGameStore(s => s.selectedCard)
  const playerCount = useGameStore(s => s.playerCount)
  const difficulty = useGameStore(s => s.difficulty)
  const humanIndex = useGameStore(s => s.humanIndex)
  const selectCard = useGameStore(s => s.selectCard)
  const confirmPlay = useGameStore(s => s.confirmPlay)
  const pass = useGameStore(s => s.pass)
  const startGame = useGameStore(s => s.startGame)
  const recycleValidCards = useGameStore(s => s.recycleValidCards)
  const confirmRecycle = useGameStore(s => s.confirmRecycle)

  useEffect(() => {
    const worker = new Worker(new URL('../workers/ai.worker.ts', import.meta.url), { type: 'module' })
    setWorker(worker)
    worker.onmessage = (e: MessageEvent<{ move: Move }>) => {
      handleWorkerMessage(e.data.move)
    }
    return () => {
      worker.terminate()
      setWorker(null)
    }
  }, [setWorker, handleWorkerMessage])

  const humanHand = hands[humanIndex] ?? []
  const canConfirm = staged.length > 0 && phase === 'placing'

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <TopBar
        scores={scores}
        drawPileCount={drawPile.length}
        playerCount={playerCount}
        humanIndex={humanIndex}
        difficulty={difficulty}
        onZoomIn={() => boardRef.current?.zoomIn()}
        onZoomOut={() => boardRef.current?.zoomOut()}
        onAutoFit={() => boardRef.current?.autofit()}
        onRotateCW={() => boardRef.current?.rotateCW()}
        onRotateCCW={() => boardRef.current?.rotateCCW()}
      />

      <Board ref={boardRef} />

      <div style={{
        background: '#12122a', padding: '12px 16px',
        borderTop: '1px solid #2a2a4a',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <Hand
          hand={humanHand}
          selectedCard={selectedCard}
          staged={staged}
          onSelectCard={selectCard}
          recycleValidCards={recycleValidCards}
          onConfirmRecycle={confirmRecycle}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'stretch', minWidth: 130 }}>
          <button
            disabled={!canConfirm}
            onClick={confirmPlay}
            style={{
              background: canConfirm ? '#16a34a' : '#2a2a4a',
              border: 'none', color: '#fff',
              borderRadius: 7, padding: '9px 0', fontSize: 13, fontWeight: 'bold',
              cursor: canConfirm ? 'pointer' : 'default',
            }}
          >
            Confirm Play
          </button>
          <button
            disabled={phase === 'ai-thinking'}
            onClick={() => setShowPassModal(true)}
            style={{
              background: '#1e1e3a', border: '1px solid #3a3a5a', color: '#9ca3af',
              borderRadius: 7, padding: '7px 0', fontSize: 12, cursor: 'pointer',
            }}
          >
            Pass / Trade
          </button>
        </div>
      </div>

      {showPassModal && (
        <PassTradeModal
          hand={humanHand}
          onConfirm={(trades, tradeOrder) => {
            pass(trades, tradeOrder)
            setShowPassModal(false)
          }}
          onClose={() => setShowPassModal(false)}
        />
      )}

      {phase === 'game-over' && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
        }}>
          <div style={{
            background: '#1e1e3a', borderRadius: 12, padding: 32,
            border: '1px solid #3a3a5a', textAlign: 'center', minWidth: 300,
          }}>
            <h2 style={{ color: '#e2e8f0', marginBottom: 16 }}>Game Over</h2>
            {scores.map((s, i) => (
              <p key={i} style={{ color: '#9ca3af', marginBottom: 8 }}>
                {i === humanIndex ? 'You' : `AI ${i}`}: <span style={{ color: '#fff', fontWeight: 'bold' }}>{s}</span>
              </p>
            ))}
            <button
              onClick={() => startGame(playerCount, difficulty)}
              style={{
                marginTop: 16, background: '#3b82f6', border: 'none', color: '#fff',
                borderRadius: 7, padding: '10px 24px', fontSize: 14, fontWeight: 'bold', cursor: 'pointer',
              }}
            >
              Play Again
            </button>
            <button
              onClick={() => navigate('/')}
              style={{
                marginTop: 8, background: 'transparent', border: '1px solid #3a3a5a', color: '#9ca3af',
                borderRadius: 7, padding: '8px 24px', fontSize: 12, cursor: 'pointer', display: 'block', width: '100%',
              }}
            >
              Home
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
