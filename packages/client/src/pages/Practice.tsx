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
import Button from '../components/Button'

const panel: React.CSSProperties = {
  background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', clipPath: 'var(--chamfer)',
}

const ghostBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.16)', color: 'var(--text-body)',
  clipPath: 'var(--chamfer)', padding: '9px 16px', fontFamily: 'Fredoka', fontWeight: 500, fontSize: 13, cursor: 'pointer',
}

const heading: React.CSSProperties = { fontFamily: 'Luckiest Guy', letterSpacing: '.01em' }

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
      <div style={{ minHeight: '100dvh', padding: 24, color: 'var(--text-body)', maxWidth: 640, margin: '0 auto', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h1 style={{ ...heading, fontSize: 34, color: '#fff' }}>Practice</h1>
          <button type="button" onClick={() => navigate('/')} style={ghostBtn}>Back to menu</button>
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
                <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {p.title}
                  {solvedIds.has(p.id) && <span style={{ color: 'var(--brand-cyan)' }} aria-label="solved">✓</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{p.concept}</div>
              </div>
              <Button variant="primary" onClick={() => openPuzzle(p.id)} aria-label={`Open ${p.title}`}>Open</Button>
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
    <div style={{ minHeight: '100dvh', padding: 24, color: 'var(--text-body)', maxWidth: 720, margin: '0 auto', position: 'relative', zIndex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ ...heading, fontSize: 24, color: '#fff' }}>{puzzle.title}</h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{puzzle.concept}</div>
        </div>
        <button type="button" onClick={backToList} style={ghostBtn}>Back to menu</button>
      </div>

      <p style={{ ...panel, padding: '12px 16px', marginBottom: 16, color: 'var(--text-body)', fontSize: 14 }}>
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
        <div style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {preview ? <>Preview: <span style={{ color: 'var(--brand-cyan)', fontWeight: 700 }}>{preview.total}</span></> : 'Preview: —'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="primary" onClick={handleCheck} disabled={staged.length === 0}>Check</Button>
        {isForcedPass && <Button variant="primary" onClick={handlePass}>Pass</Button>}
        <button type="button" onClick={handleReset} style={ghostBtn}>Reset</button>
        {isTopScore && <button type="button" onClick={() => setRevealed(true)} style={ghostBtn}>Reveal best</button>}
        <button type="button" onClick={handleNext} style={ghostBtn}>Next</button>
      </div>

      {result && (
        <div
          style={{
            ...panel, marginTop: 16, padding: '14px 18px',
            border: result.solved ? '1px solid var(--brand-cyan)' : '1px solid rgba(255,255,255,.16)',
          }}
        >
          {result.solved ? (
            <>
              <p style={{ color: 'var(--brand-cyan)', fontWeight: 700, marginBottom: 6 }}>Solved!</p>
              <p style={{ fontSize: 13, color: 'var(--text-body)' }}>{puzzle.explanation}</p>
            </>
          ) : (
            <>
              <p style={{ color: '#ff8fa3', fontWeight: 700, marginBottom: 6 }}>Not quite — try again.</p>
              {isTopScore && (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Your score: <span style={{ color: 'var(--text-body)' }}>{result.userScore ?? '—'}</span>
                  {' '}/ Best possible: <span style={{ color: 'var(--text-body)' }}>{result.bestScore}</span>
                </p>
              )}
            </>
          )}
        </div>
      )}

      {revealed && isTopScore && best.length > 0 && (
        <div style={{ ...panel, marginTop: 16, padding: '14px 18px' }}>
          <p style={{ fontWeight: 700, marginBottom: 6, color: 'var(--text-body)' }}>
            Best play — scores {best[0]!.total}
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {best[0]!.placements
              .map(p => `${cardIdentity(p.card)} @ (${p.position.x}, ${p.position.y})`)
              .join(', ')}
          </p>
        </div>
      )}
    </div>
  )
}
