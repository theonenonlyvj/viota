import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { posKey } from '@viota/engine'
import type { Card, Grid, Placement, Position } from '@viota/engine'
import { PUZZLES } from '../practice/puzzles'
import { gradeUserMove, bestPlays, cardIdentity } from '../practice/solver'
import type { GradeResult, UserMove } from '../practice/types'
import { computeValidPositions, computePreviewScore } from '../gameLogic'
import StaticBoard from '../components/StaticBoard'
import Hand from '../components/Hand'

const panel: React.CSSProperties = {
  background: '#1e1e3a', border: '1px solid #2a2a4a', borderRadius: 8,
}

const primaryBtn: React.CSSProperties = {
  background: '#3b82f6', border: 'none', color: '#fff',
  borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 'bold', cursor: 'pointer',
}

const secondaryBtn: React.CSSProperties = {
  background: '#1e1e3a', border: '1px solid #3a3a5a', color: '#9ca3af',
  borderRadius: 7, padding: '9px 20px', fontSize: 13, cursor: 'pointer',
}

const disabledBtn: React.CSSProperties = {
  background: '#2a2a4a', border: 'none', color: '#6b7280',
  borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 'bold', cursor: 'default',
}

export default function Practice() {
  const navigate = useNavigate()

  // List state
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [solvedIds, setSolvedIds] = useState<Set<string>>(new Set())

  // Player state (local only — never touches useGameStore)
  const [selectedCard, setSelectedCard] = useState<Card | null>(null)
  const [staged, setStaged] = useState<Placement[]>([])
  const [result, setResult] = useState<GradeResult | null>(null)
  const [revealed, setRevealed] = useState(false)

  const puzzle = selectedId ? PUZZLES.find(p => p.id === selectedId) ?? null : null

  function resetPlayerState() {
    setSelectedCard(null)
    setStaged([])
    setResult(null)
    setRevealed(false)
  }

  function openPuzzle(id: string) {
    setSelectedId(id)
    resetPlayerState()
  }

  function backToList() {
    setSelectedId(null)
    resetPlayerState()
  }

  // --- List view ---------------------------------------------------------
  if (!puzzle) {
    return (
      <div style={{ minHeight: '100dvh', padding: 24, color: '#e2e8f0', maxWidth: 640, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 'bold' }}>Practice</h1>
          <button onClick={() => navigate('/')} style={secondaryBtn}>Back to menu</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {PUZZLES.map(p => (
            <div
              key={p.id}
              style={{
                ...panel,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '14px 18px',
              }}
            >
              <div>
                <div style={{ fontWeight: 'bold', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {p.title}
                  {solvedIds.has(p.id) && <span style={{ color: '#4ade80' }} aria-label="solved">✓</span>}
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{p.concept}</div>
              </div>
              <button
                onClick={() => openPuzzle(p.id)}
                aria-label={`Open ${p.title}`}
                style={primaryBtn}
              >
                Open
              </button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // --- Player view ---------------------------------------------------------
  const grid: Grid = new Map(puzzle.position.grid)
  const validPositions = selectedCard ? computeValidPositions(grid, staged, selectedCard) : []
  const preview = computePreviewScore(grid, staged)
  const isTopScore = puzzle.mode === 'top-score'
  const isForcedPass = puzzle.answerKind === 'forced-pass'
  const best = isTopScore ? bestPlays(grid, puzzle.position.hand) : []

  function onSelectCard(card: Card) {
    setSelectedCard(card)
  }

  function onPlace(position: Position) {
    if (!selectedCard) return
    setStaged(s => [...s, { card: selectedCard, position }])
    setSelectedCard(null)
  }

  function onUnstage(position: Position) {
    const key = posKey(position)
    setStaged(s => s.filter(p => posKey(p.position) !== key))
  }

  function recordIfSolved(r: GradeResult) {
    if (r.solved) setSolvedIds(prev => new Set(prev).add(puzzle!.id))
  }

  function handleCheck() {
    const move: UserMove = { action: 'play', placements: staged }
    const r = gradeUserMove(puzzle!, move)
    setResult(r)
    recordIfSolved(r)
  }

  function handlePass() {
    const move: UserMove = { action: 'pass' }
    const r = gradeUserMove(puzzle!, move)
    setResult(r)
    recordIfSolved(r)
  }

  function handleReset() {
    resetPlayerState()
  }

  function handleNext() {
    const idx = PUZZLES.findIndex(p => p.id === puzzle!.id)
    const next = PUZZLES[(idx + 1) % PUZZLES.length]!
    openPuzzle(next.id)
  }

  return (
    <div style={{ minHeight: '100dvh', padding: 24, color: '#e2e8f0', maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 'bold' }}>{puzzle.title}</h1>
          <div style={{ fontSize: 12, color: '#9ca3af' }}>{puzzle.concept}</div>
        </div>
        <button onClick={backToList} style={secondaryBtn}>Back to menu</button>
      </div>

      <p style={{ ...panel, padding: '12px 16px', marginBottom: 16, color: '#e2e8f0', fontSize: 14 }}>
        {puzzle.instruction}
      </p>

      <StaticBoard
        grid={grid}
        staged={staged}
        validPositions={validPositions}
        onPlace={onPlace}
        onUnstage={onUnstage}
      />

      <div
        style={{
          ...panel, marginTop: 16, padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        }}
      >
        <div data-testid="puzzle-hand">
          <Hand
            hand={puzzle.position.hand}
            selectedCard={selectedCard}
            staged={staged}
            onSelectCard={onSelectCard}
          />
        </div>
        <div style={{ fontSize: 13, color: '#9ca3af', whiteSpace: 'nowrap' }}>
          {preview ? <>Preview: <span style={{ color: '#4ade80', fontWeight: 'bold' }}>{preview.total}</span></> : 'Preview: —'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <button
          onClick={handleCheck}
          disabled={staged.length === 0}
          style={staged.length === 0 ? disabledBtn : primaryBtn}
        >
          Check
        </button>
        {isForcedPass && (
          <button onClick={handlePass} style={primaryBtn}>Pass</button>
        )}
        <button onClick={handleReset} style={secondaryBtn}>Reset</button>
        {isTopScore && (
          <button onClick={() => setRevealed(true)} style={secondaryBtn}>Reveal best</button>
        )}
        <button onClick={handleNext} style={secondaryBtn}>Next</button>
      </div>

      {result && (
        <div
          style={{
            ...panel, marginTop: 16, padding: '14px 18px',
            border: result.solved ? '1px solid #16a34a' : '1px solid #3a3a5a',
          }}
        >
          {result.solved ? (
            <>
              <p style={{ color: '#4ade80', fontWeight: 'bold', marginBottom: 6 }}>Solved!</p>
              <p style={{ fontSize: 13, color: '#e2e8f0' }}>{puzzle.explanation}</p>
            </>
          ) : (
            <>
              <p style={{ color: '#f87171', fontWeight: 'bold', marginBottom: 6 }}>Not quite — try again.</p>
              {isTopScore && (
                <p style={{ fontSize: 13, color: '#9ca3af' }}>
                  Your score: <span style={{ color: '#e2e8f0' }}>{result.userScore ?? '—'}</span>
                  {' '}/ Best possible: <span style={{ color: '#e2e8f0' }}>{result.bestScore}</span>
                </p>
              )}
            </>
          )}
        </div>
      )}

      {revealed && isTopScore && best.length > 0 && (
        <div style={{ ...panel, marginTop: 16, padding: '14px 18px' }}>
          <p style={{ fontWeight: 'bold', marginBottom: 6, color: '#e2e8f0' }}>
            Best play — scores {best[0]!.total}
          </p>
          <p style={{ fontSize: 13, color: '#9ca3af' }}>
            {best[0]!.placements
              .map(p => `${cardIdentity(p.card)} @ (${p.position.x}, ${p.position.y})`)
              .join(', ')}
          </p>
        </div>
      )}
    </div>
  )
}
