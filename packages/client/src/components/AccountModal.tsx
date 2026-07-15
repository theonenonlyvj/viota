import { useRef, useState } from 'react'
import { useModalDismiss } from '../hooks/useModalDismiss'
import { claimAccount, loginAccount } from '../net/account'
import { serverUrl } from '../net/config'
import { getDisplayName, getToken, quickAuth, setUsername } from '../net/identity'
import Button from './Button'
import PillButton from './PillButton'

const SERVER_URL = serverUrl()

/** Mirrors the server's shape gate exactly (packages/worker/src/identity/username.ts). */
const USERNAME_RE = /^[a-z0-9_]{3,20}$/
function isValidUsername(u: string): boolean {
  return USERNAME_RE.test(u)
}
function isValidPassword(p: string): boolean {
  return p.length >= 6 && p.length <= 128
}

function claimErrorText(error: string): string {
  if (error === 'username_taken') return 'That username is already taken.'
  if (error === 'not_ghost') return 'This device already has a claimed account.'
  if (error === 'invalid') return 'Enter a valid username and password.'
  return 'Something went wrong — try again.'
}
function loginErrorText(error: string): string {
  if (error === 'invalid_credentials') return 'Incorrect username or password.'
  return 'Something went wrong — try again.'
}

type Mode = 'claim' | 'login'

const hint: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 11, margin: '4px 0 8px' }

/**
 * Login adoption (Phase 1, Task 2) — "claim your name" (username+password onto
 * this device's current ghost) and "log in" (bind an existing username+password
 * to this device) over the already-live `net/account.ts` endpoints. Ghost stays
 * the frictionless default; this is opt-in only.
 *
 * A brand-new device that has never played online has no stored token yet (P1
 * only mints one at first online-game-create or local-game-report — see
 * `net/reportGame.ts`), so a claim attempted before that would 401. This
 * mirrors `reportLocalGame`'s existing "mint one first" guard rather than
 * requiring the caller to have played first.
 */
export default function AccountModal({
  open,
  onClose,
  onIdentityChange,
}: {
  open: boolean
  onClose: () => void
  onIdentityChange?: () => void
}) {
  const [mode, setMode] = useState<Mode>('claim')
  const [usernameInput, setUsernameInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  useModalDismiss(open, onClose, cardRef)

  if (!open) return null

  const usernameOk = isValidUsername(usernameInput)
  const passwordOk = isValidPassword(passwordInput)
  const canSubmit = usernameOk && passwordOk && !busy

  function switchMode(next: Mode) {
    setMode(next)
    setError('')
    setSuccess('')
  }

  async function submit() {
    if (!canSubmit) return
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      if (mode === 'claim') {
        // A fresh device has no token yet — mint one (the same silent
        // quickAuth every other flow uses) before claiming onto it.
        if (!getToken()) await quickAuth(SERVER_URL, getDisplayName())
        const result = await claimAccount(SERVER_URL, usernameInput, passwordInput)
        if (result.ok) {
          setUsername(usernameInput)
          setSuccess(`Claimed "${usernameInput}" — log in with it on any device.`)
          setPasswordInput('') // don't leave the plaintext password lingering in component state
          onIdentityChange?.()
        } else {
          setError(claimErrorText(result.error))
        }
      } else {
        const result = await loginAccount(SERVER_URL, usernameInput, passwordInput)
        if (result.ok) {
          setUsername(usernameInput)
          setSuccess(`Logged in as ${usernameInput}.`)
          setPasswordInput('') // don't leave the plaintext password lingering in component state
          onIdentityChange?.()
        } else {
          setError(loginErrorText(result.error))
        }
      }
    } catch {
      setError('Could not reach the server — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Account">
      <div className="modal-card" onClick={(e) => e.stopPropagation()} ref={cardRef} tabIndex={-1} style={{ position: 'relative' }}>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            position: 'absolute', top: 10, right: 10, width: 28, height: 28,
            background: 'transparent', border: 'none', color: 'var(--text-muted)',
            fontSize: 18, lineHeight: 1, cursor: 'pointer',
          }}
        >
          ×
        </button>

        <h2 style={{ fontFamily: 'Luckiest Guy', fontSize: 22, marginBottom: 14 }}>Your account</h2>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <PillButton active={mode === 'claim'} onClick={() => switchMode('claim')}>Claim your name</PillButton>
          <PillButton active={mode === 'login'} onClick={() => switchMode('login')}>Log in</PillButton>
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
          {mode === 'claim'
            ? 'Pick a username + password to keep your stats when you switch devices.'
            : 'Already claimed a name? Log in to bring that account to this device.'}
        </p>

        <input
          className="field"
          aria-label="Username"
          placeholder="username"
          value={usernameInput}
          onChange={(e) => setUsernameInput(e.target.value.toLowerCase())}
          maxLength={20}
          autoCapitalize="off"
          autoCorrect="off"
        />
        {usernameInput.length > 0 && !usernameOk && (
          <p style={hint}>3–20 characters: lowercase letters, numbers, underscore.</p>
        )}

        <input
          className="field"
          aria-label="Password"
          placeholder="password"
          type="password"
          value={passwordInput}
          onChange={(e) => setPasswordInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          style={{ marginTop: 10 }}
        />
        {passwordInput.length > 0 && !passwordOk && <p style={hint}>6–128 characters.</p>}

        {error && <p style={{ color: 'var(--text-error)', fontSize: 13, marginTop: 4 }}>{error}</p>}
        {success && <p style={{ color: '#4ade80', fontSize: 13, marginTop: 4 }}>{success}</p>}

        <div style={{ marginTop: 16 }}>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            {mode === 'claim' ? 'Claim username' : 'Log in to account'}
          </Button>
        </div>
      </div>
    </div>
  )
}
