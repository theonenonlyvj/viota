import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

const claimAccount = vi.fn()
const loginAccount = vi.fn()
vi.mock('../net/account', () => ({
  claimAccount: (...a: unknown[]) => claimAccount(...a),
  loginAccount: (...a: unknown[]) => loginAccount(...a),
}))

const quickAuth = vi.fn()
const setUsername = vi.fn()
let mockToken: string | null = 'existing-token'
vi.mock('../net/identity', () => ({
  getToken: () => mockToken,
  quickAuth: (...a: unknown[]) => quickAuth(...a),
  getDisplayName: () => 'Guest123',
  setUsername: (...a: unknown[]) => setUsername(...a),
}))

vi.mock('../net/config', () => ({ serverUrl: () => 'http://sv' }))

import AccountModal from './AccountModal'

const onClose = vi.fn()
const onIdentityChange = vi.fn()

beforeEach(() => {
  claimAccount.mockReset()
  loginAccount.mockReset()
  quickAuth.mockReset().mockResolvedValue({ token: 't', accountId: 'a' })
  setUsername.mockReset()
  onClose.mockClear()
  onIdentityChange.mockClear()
  mockToken = 'existing-token'
})

function renderModal() {
  render(<AccountModal open onClose={onClose} onIdentityChange={onIdentityChange} />)
}

/** The primary submit CTA — a <Button> (no aria-pressed), distinct from the
 *  mode-toggle pills (PillButton, aria-pressed) that share the "Create account"
 *  label. */
function submitCta(name: RegExp): HTMLElement {
  const match = screen.getAllByRole('button', { name }).find((b) => !b.hasAttribute('aria-pressed'))
  if (!match) throw new Error(`no submit CTA matching ${name}`)
  return match
}

test('returns null when closed', () => {
  const { container } = render(<AccountModal open={false} onClose={onClose} onIdentityChange={onIdentityChange} />)
  expect(container.firstChild).toBeNull()
})

test('opens in the "claim" flow by default with both fields empty and submit disabled', () => {
  renderModal()
  expect(submitCta(/create account/i)).toBeDisabled()
})

test('a too-short/invalid username blocks submit', async () => {
  renderModal()
  await userEvent.type(screen.getByLabelText(/username/i), 'ab') // < 3 chars
  await userEvent.type(screen.getByLabelText(/password/i), 'longenough')
  expect(submitCta(/create account/i)).toBeDisabled()
  await userEvent.click(submitCta(/create account/i))
  expect(claimAccount).not.toHaveBeenCalled()
})

test('a too-short password blocks submit', async () => {
  renderModal()
  await userEvent.type(screen.getByLabelText(/username/i), 'vijay')
  await userEvent.type(screen.getByLabelText(/password/i), 'short')
  expect(submitCta(/create account/i)).toBeDisabled()
})

test('a valid claim calls claimAccount, persists + reflects the new username, and shows success', async () => {
  claimAccount.mockResolvedValue({ ok: true })
  renderModal()
  await userEvent.type(screen.getByLabelText(/username/i), 'vijay')
  await userEvent.type(screen.getByLabelText(/password/i), 'hunter22')
  expect(submitCta(/create account/i)).toBeEnabled()
  await userEvent.click(submitCta(/create account/i))

  expect(claimAccount).toHaveBeenCalledWith('http://sv', 'vijay', 'hunter22')
  expect(quickAuth).not.toHaveBeenCalled() // a token already existed
  expect(setUsername).toHaveBeenCalledWith('vijay')
  expect(onIdentityChange).toHaveBeenCalled()
  expect(await screen.findByText(/vijay/i)).toBeInTheDocument()
})

test('a claim collision (username taken) shows an inline error and does not reflect a new identity', async () => {
  claimAccount.mockResolvedValue({ ok: false, error: 'username_taken' })
  renderModal()
  await userEvent.type(screen.getByLabelText(/username/i), 'vijay')
  await userEvent.type(screen.getByLabelText(/password/i), 'hunter22')
  await userEvent.click(submitCta(/create account/i))

  expect(await screen.findByText(/already taken/i)).toBeInTheDocument()
  expect(onIdentityChange).not.toHaveBeenCalled()
  expect(setUsername).not.toHaveBeenCalled()
})

test('claiming from a fresh device (no stored token) mints one via quickAuth first', async () => {
  mockToken = null
  claimAccount.mockResolvedValue({ ok: true })
  renderModal()
  await userEvent.type(screen.getByLabelText(/username/i), 'vijay')
  await userEvent.type(screen.getByLabelText(/password/i), 'hunter22')
  await userEvent.click(submitCta(/create account/i))

  expect(quickAuth).toHaveBeenCalledWith('http://sv', 'Guest123')
  expect(claimAccount).toHaveBeenCalledWith('http://sv', 'vijay', 'hunter22')
})

test('switching to Log in and submitting valid credentials calls loginAccount', async () => {
  loginAccount.mockResolvedValue({ ok: true, mustChangePassword: false })
  renderModal()
  await userEvent.click(screen.getByRole('button', { name: /^log in$/i }))
  await userEvent.type(screen.getByLabelText(/username/i), 'vijay')
  await userEvent.type(screen.getByLabelText(/password/i), 'hunter22')
  await userEvent.click(screen.getByRole('button', { name: /log in to account/i }))

  expect(loginAccount).toHaveBeenCalledWith('http://sv', 'vijay', 'hunter22')
  expect(setUsername).toHaveBeenCalledWith('vijay')
  expect(onIdentityChange).toHaveBeenCalled()
})

test('a login error shows an inline message', async () => {
  loginAccount.mockResolvedValue({ ok: false, error: 'invalid_credentials' })
  renderModal()
  await userEvent.click(screen.getByRole('button', { name: /^log in$/i }))
  await userEvent.type(screen.getByLabelText(/username/i), 'vijay')
  await userEvent.type(screen.getByLabelText(/password/i), 'wrongpass')
  await userEvent.click(screen.getByRole('button', { name: /log in to account/i }))

  expect(await screen.findByText(/incorrect username or password/i)).toBeInTheDocument()
  expect(onIdentityChange).not.toHaveBeenCalled()
})

test('clicking the close button calls onClose', async () => {
  renderModal()
  await userEvent.click(screen.getByRole('button', { name: /close/i }))
  expect(onClose).toHaveBeenCalledTimes(1)
})
