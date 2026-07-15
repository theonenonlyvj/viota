import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Card as CardType } from '@viota/engine'
import Card from '../components/Card'
import Button from '../components/Button'
import PlayVsAiModal from '../components/PlayVsAiModal'
import HowToPlayModal from '../components/HowToPlayModal'
import AccountModal from '../components/AccountModal'
import ResumeStrip from '../components/ResumeStrip'
import { getDisplayName, getUsername } from '../net/identity'

type Scatter = { card: CardType; left?: number; right?: number; top?: number; bottom?: number; rot: number; scale: number; opacity?: number; delay: number }

// Real cards (unmodified) placed on wrappers; size = scale() folded into --t.
const CARDS: Scatter[] = [
  { card: { kind: 'wild' }, right: 130, top: 120, rot: -8, scale: 1.7, delay: 0 },
  { card: { kind: 'regular', color: 'blue', shape: 'circle', number: 4 }, right: 270, top: 230, rot: 10, scale: 1.5, delay: 0.6 },
  { card: { kind: 'regular', color: 'red', shape: 'plus', number: 2 }, right: 60, top: 300, rot: 6, scale: 1.4, delay: 1.1 },
  { card: { kind: 'regular', color: 'yellow', shape: 'square', number: 1 }, right: 210, top: 60, rot: -14, scale: 1.28, delay: 0.3 },
  { card: { kind: 'regular', color: 'green', shape: 'triangle', number: 3 }, right: 340, top: 360, rot: -4, scale: 1.35, delay: 0.9 },
  { card: { kind: 'regular', color: 'red', shape: 'square', number: 3 }, right: 20, top: 150, rot: 14, scale: 1.14, delay: 1.4 },
  { card: { kind: 'regular', color: 'green', shape: 'circle', number: 2 }, left: 30, top: 40, rot: -10, scale: 1.25, opacity: 0.16, delay: 0.5 },
  { card: { kind: 'regular', color: 'blue', shape: 'plus', number: 4 }, left: 120, bottom: 40, rot: 8, scale: 1.4, opacity: 0.14, delay: 1.0 },
]

// mobile: a compact fanned row below the copy (the absolute art is hidden < 760px)
const MOBILE_CARDS: { card: CardType; rot: number }[] = [
  { card: { kind: 'regular', color: 'red', shape: 'triangle', number: 1 }, rot: -12 },
  { card: { kind: 'regular', color: 'blue', shape: 'square', number: 2 }, rot: -4 },
  { card: { kind: 'regular', color: 'yellow', shape: 'circle', number: 3 }, rot: 6 },
  { card: { kind: 'wild' }, rot: 14 },
]

const navLink: React.CSSProperties = {
  background: 'none', border: 'none', color: '#eaf6fb',
  fontFamily: 'Fredoka', fontWeight: 600, fontSize: 14, cursor: 'pointer',
}

export default function Home() {
  const navigate = useNavigate()
  const [aiOpen, setAiOpen] = useState(false)
  const [howToOpen, setHowToOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  // Bumped by AccountModal's onIdentityChange to force a re-read of
  // getUsername()/getDisplayName() below — they're plain localStorage reads,
  // not reactive state, so a claim/login elsewhere needs an explicit nudge.
  const [, setIdentityVersion] = useState(0)
  const username = getUsername()
  const identityLabel = username ?? getDisplayName()

  return (
    <div className="hero">
      {/* top bar */}
      <div style={{ position: 'absolute', top: 26, left: '8vw', right: '8vw', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 6 }}>
        <span aria-hidden style={{ fontFamily: 'Luckiest Guy', color: '#fff', fontSize: 22, letterSpacing: '.02em', textShadow: '0 0 16px rgba(34,211,238,.5)' }}>
          vi<span style={{ color: 'var(--brand-cyan)' }}>o</span>ta
        </span>
        <div style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
          <button type="button" onClick={() => navigate('/practice')} style={navLink}>practice</button>
          <button type="button" onClick={() => navigate('/leaderboard')} style={navLink}>leaderboard</button>
          <button type="button" onClick={() => navigate('/stats')} style={navLink}>your stats</button>
          <button type="button" onClick={() => setHowToOpen(true)} style={navLink}>how to play</button>
          <button
            type="button"
            onClick={() => setAccountOpen(true)}
            aria-label={`Account — ${identityLabel}`}
            style={{ ...navLink, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, lineHeight: 1.15 }}
          >
            <span>{identityLabel}</span>
            {!username && (
              <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--brand-cyan)' }}>claim to save across devices</span>
            )}
          </button>
        </div>
      </div>

      {/* scattered real-card art (pointer-events none so it never blocks buttons) */}
      <div className="pc-layer" aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none' }}>
        {CARDS.map((c, i) => (
          <div key={i} className="pc"
            style={{
              position: 'absolute', left: c.left, right: c.right, top: c.top, bottom: c.bottom,
              opacity: c.opacity ?? 1,
              // rotation + scale folded into --t so the float keyframe preserves them
              ['--t' as any]: `rotate(${c.rot}deg) scale(${c.scale})`,
              transform: `rotate(${c.rot}deg) scale(${c.scale})`,
              animation: `floaty ${4 + c.delay}s ease-in-out ${c.delay}s infinite`,
            }}>
            <Card card={c.card} />
          </div>
        ))}
      </div>

      {/* left column */}
      <div style={{ position: 'relative', zIndex: 5, maxWidth: 580 }}>
        <h1 style={{ fontFamily: 'Luckiest Guy', fontSize: 'clamp(64px, 11vw, 114px)', lineHeight: 0.9, color: '#fff', letterSpacing: '.01em', textShadow: '0 0 42px rgba(34,211,238,.4)' }}>
          vi<span style={{ color: 'var(--brand-cyan)' }}>o</span>ta
        </h1>
        <p style={{ fontSize: 20, color: 'var(--text-body)', marginTop: 18, maxWidth: 470, lineHeight: 1.45, fontWeight: 500 }}>
          Match on color, shape, and number<span style={{ color: 'var(--text-wink)', fontStyle: 'italic' }}>… and optimize for points.</span>
        </p>
        <div style={{ display: 'flex', gap: 18, marginTop: 34, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={() => setAiOpen(true)}>Play vs AI</Button>
          <Button variant="secondary" onClick={() => navigate('/lobby')}>Play with friends</Button>
        </div>
        <p style={{ marginTop: 22, fontSize: 13.5, letterSpacing: '.06em', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
          2–4 players · free · no download
        </p>
        <div style={{ marginTop: 20 }}><ResumeStrip /></div>
        <div className="hero-cards-mobile" aria-hidden>
          {MOBILE_CARDS.map((c, i) => (
            <div key={i} style={{ transform: `rotate(${c.rot}deg)`, marginLeft: i ? -14 : 0 }}>
              <Card card={c.card} />
            </div>
          ))}
        </div>
      </div>

      <PlayVsAiModal open={aiOpen} onClose={() => setAiOpen(false)} />
      <HowToPlayModal open={howToOpen} onClose={() => setHowToOpen(false)} />
      <AccountModal
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        onIdentityChange={() => setIdentityVersion((v) => v + 1)}
      />
    </div>
  )
}
