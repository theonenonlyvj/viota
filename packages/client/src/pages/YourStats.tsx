import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { serverUrl } from '../net/config'
import { fetchMyStats, type MeStats } from '../net/leaderboard'
import { getUsername } from '../net/identity'
import Button from '../components/Button'
import AccountModal from '../components/AccountModal'

const SERVER_URL = serverUrl()

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

/** UTC calendar date (not locale-dependent) — matches the epoch-ms fields `/me/stats` returns. */
function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

const heading: React.CSSProperties = { fontFamily: 'Luckiest Guy', letterSpacing: '.01em' }

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{label}</span>
      <span style={{ color: 'var(--text-body)', fontWeight: 600, fontSize: 14 }}>{value}</span>
    </div>
  )
}

function Panel({ testId, label, children }: { testId: string; label: string; children: React.ReactNode }) {
  return (
    <div className="panel" data-testid={testId}>
      <p className="panel__label">{label}</p>
      {children}
    </div>
  )
}

/**
 * Renders `GET /me/stats`. Deliberately account-agnostic: the endpoint
 * resolves whatever accountId the stored Bearer token belongs to, which is
 * true for an unclaimed device just as much as a claimed username (P1's
 * quickAuth mints a real, stats-bearing account the first time a device
 * plays online — "claiming" only attaches a username/password to it later).
 * So an unclaimed device's own ("ghost") stats render the exact same way as
 * a claimed account's — no special-casing needed here. The only distinct
 * state is "nothing resolvable yet" (no stored token at all, e.g. a device
 * that has only ever played local/practice games) or a transient failure —
 * both surface as `null` from `fetchMyStats` and get one friendly empty state.
 */
export default function YourStats() {
  const navigate = useNavigate()
  // undefined = loading; null = no resolvable stats yet (no token / fetch failed).
  const [stats, setStats] = useState<MeStats | null | undefined>(undefined)
  const [accountOpen, setAccountOpen] = useState(false)
  // Bumped by AccountModal's onIdentityChange so a claim/login re-reads
  // getUsername() (a plain localStorage read, not reactive state) — this both
  // hides the claim CTA and re-pulls stats for the now-claimed identity.
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let active = true
    fetchMyStats(SERVER_URL)
      .then((s) => { if (active) setStats(s) })
      .catch(() => { if (active) setStats(null) })
    return () => { active = false }
  }, [refreshKey])

  return (
    <div style={{ minHeight: '100dvh', padding: '84px 24px 48px', maxWidth: 640, margin: '0 auto', position: 'relative', zIndex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ ...heading, fontSize: 34, color: '#fff' }}>Your Stats</h1>
        <button type="button" onClick={() => navigate('/')} className="ghost-btn">Back to menu</button>
      </div>

      {stats === undefined && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>}

      {stats === null && (
        <div className="panel">
          <p style={{ color: 'var(--text-body)', fontSize: 14, lineHeight: 1.5 }}>
            No stats yet. Play an online game — with friends or vs AI — and it starts tracking automatically,
            even before you claim a username.
          </p>
          <div style={{ marginTop: 18, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={() => navigate('/lobby')}>Play with friends</Button>
            {!getUsername() && (
              <Button variant="secondary" onClick={() => setAccountOpen(true)}>
                Claim your name — save your stats across devices
              </Button>
            )}
          </div>
        </div>
      )}

      {stats && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!getUsername() && (
            <div style={{ display: 'flex' }}>
              <Button variant="primary" onClick={() => setAccountOpen(true)}>
                Claim your name — save your stats across devices
              </Button>
            </div>
          )}
          <Panel testId="stats-overview" label="Overview">
            <Row label="Total games" value={String(stats.games)} />
            <Row label="Player since" value={stats.playerSince !== null ? formatDate(stats.playerSince) : '—'} />
            <Row label="Last played" value={stats.lastPlayed !== null ? formatDate(stats.lastPlayed) : '—'} />
            <Row label="Total time played" value={formatDuration(stats.totalTimeMs)} />
          </Panel>

          <Panel testId="stats-vs-friends" label="vs Friends">
            <Row label="Games" value={String(stats.vsFriends.games)} />
            <Row label="Wins" value={String(stats.vsFriends.wins)} />
            <Row label="Win rate" value={formatPercent(stats.vsFriends.winRate)} />
            <Row label="Best streak" value={String(stats.vsFriends.streak)} />
          </Panel>

          <Panel testId="stats-vs-ai" label="vs AI">
            <Row label="Games" value={String(stats.vsAI.games)} />
            <Row label="Wins" value={String(stats.vsAI.wins)} />
            <Row label="Win rate" value={formatPercent(stats.vsAI.winRate)} />
          </Panel>

          <Panel testId="stats-high-scores" label="High scores">
            <Row label="Best play" value={String(stats.bestPlay)} />
            <Row label="Best game" value={String(stats.bestGame)} />
          </Panel>

          <Panel testId="stats-by-player-count" label="Games by player count">
            <Row label="2 players" value={String(stats.byPlayerCount['2'])} />
            <Row label="3 players" value={String(stats.byPlayerCount['3'])} />
            <Row label="4 players" value={String(stats.byPlayerCount['4'])} />
          </Panel>
        </div>
      )}

      <AccountModal
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        onIdentityChange={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  )
}
