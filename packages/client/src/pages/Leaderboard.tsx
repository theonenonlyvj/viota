import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { serverUrl } from '../net/config'
import { getAccountId } from '../net/identity'
import { fetchLeaderboard, type BoardKey, type LeaderboardRow } from '../net/leaderboard'
import PillButton from '../components/PillButton'

const SERVER_URL = serverUrl()

type Section = { testId: string; title: string; boards: { key: BoardKey; label: string }[] }

/** Section/tab layout — spec order: vs Friends -> vs AI -> High scores. */
const SECTIONS: Section[] = [
  {
    testId: 'board-section-vs-friends',
    title: 'vs Friends',
    boards: [
      { key: 'winrate-friends', label: 'Win rate' },
      { key: 'wins-friends', label: 'Wins' },
      { key: 'streak-friends', label: 'Streak' },
    ],
  },
  {
    testId: 'board-section-vs-ai',
    title: 'vs AI',
    boards: [
      { key: 'winrate-ai', label: 'Win rate' },
      { key: 'wins-ai', label: 'Wins' },
    ],
  },
  {
    testId: 'board-section-high-scores',
    title: 'High scores (online games)',
    boards: [
      { key: 'bestplay', label: 'Best play' },
      { key: 'bestgame', label: 'Best game' },
    ],
  },
]

const PERCENT_BOARDS = new Set<BoardKey>(['winrate-friends', 'winrate-ai'])

/** Per-board empty-state copy — the win-rate boards call out the min-games floor. */
const EMPTY_COPY: Record<BoardKey, string> = {
  'winrate-friends': 'Nobody has played 5+ games vs friends yet — play some rounds with friends to appear here.',
  'wins-friends': 'No wins vs friends recorded yet — be the first.',
  'streak-friends': 'No win streaks vs friends yet — win two in a row to get on the board.',
  'winrate-ai': 'Nobody has played 5+ games vs AI yet — play some rounds vs AI to appear here.',
  'wins-ai': 'No wins vs AI recorded yet — be the first.',
  bestplay: 'No online plays recorded yet — the first big play takes the crown.',
  bestgame: 'No online games recorded yet — the first finished game takes the crown.',
}

function formatValue(board: BoardKey, value: number): string {
  return PERCENT_BOARDS.has(board) ? `${Math.round(value * 100)}%` : String(value)
}

export default function Leaderboard() {
  const navigate = useNavigate()
  const [board, setBoard] = useState<BoardKey>('winrate-friends')
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null)
  const [error, setError] = useState('')
  const myAccountId = getAccountId()

  useEffect(() => {
    let active = true
    setRows(null)
    setError('')
    fetchLeaderboard(SERVER_URL, board)
      .then((res) => { if (active) setRows(res.rows) })
      .catch(() => { if (active) setError('Could not load the leaderboard — try again.') })
    return () => { active = false }
  }, [board])

  return (
    <div style={{ minHeight: '100dvh', padding: '84px 24px 48px', maxWidth: 720, margin: '0 auto', position: 'relative', zIndex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'Luckiest Guy', fontSize: 34, color: '#fff', letterSpacing: '.01em' }}>Leaderboards</h1>
        <button type="button" onClick={() => navigate('/')} className="ghost-btn">Back to menu</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
        {SECTIONS.map((section) => (
          <div key={section.testId} data-testid={section.testId}>
            <p className="panel__sublabel" style={{ marginTop: 0 }}>{section.title}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {section.boards.map((b) => (
                <PillButton key={b.key} active={board === b.key} onClick={() => setBoard(b.key)}>{b.label}</PillButton>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        {error && <p style={{ color: 'var(--text-error)', fontSize: 13 }}>{error}</p>}
        {!error && rows === null && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>}
        {!error && rows !== null && rows.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{EMPTY_COPY[board]}</p>
        )}
        {!error && rows !== null && rows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((row, i) => {
              const isMe = myAccountId !== null && row.accountId === myAccountId
              return (
                <div
                  key={row.accountId}
                  className="seat-row"
                  data-testid="leaderboard-row"
                  aria-current={isMe ? 'true' : undefined}
                  style={{
                    justifyContent: 'space-between',
                    ...(isMe ? { border: '1.5px solid var(--brand-cyan)', background: 'rgba(34,211,238,.12)' } : {}),
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 700, width: 22, display: 'inline-block' }}>{i + 1}</span>
                    <span style={{ fontWeight: 600 }}>
                      {row.username ?? row.displayName}
                      {isMe ? ' (you)' : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{row.games} games</span>
                    <span style={{ color: 'var(--brand-cyan)', fontWeight: 700 }}>{formatValue(board, row.value)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
