import { signToken } from '../jwt'

/**
 * Quick-account identity over the D1 `accounts` store (must-fix #12).
 *
 * The device credential is a 256-bit bearer secret MINTED CLIENT-SIDE via
 * `crypto.getRandomValues` (Phase 6). The server NEVER generates it and NEVER
 * stores it raw — only its SHA-256 hash. That hash is the sole lookup +
 * uniqueness key, so two users with the same display name never collide and a
 * DIFFERENT credential can never attach to an existing account.
 */

/** Non-empty, length-capped device-credential shape guard. The real client
 *  mints 32 bytes; we only bound the shape (the hash is the security surface). */
const CRED_MIN_LEN = 16
const CRED_MAX_LEN = 512
export function isValidDeviceCredential(cred: unknown): cred is string {
  return typeof cred === 'string' && cred.length >= CRED_MIN_LEN && cred.length <= CRED_MAX_LEN
}

/**
 * SHA-256 (hex) of the UTF-8 credential. SHA-256 (not a slow KDF) is correct
 * here: the credential is a HIGH-ENTROPY 256-bit secret, not a low-entropy
 * password, so there is nothing to brute-force. Store ONLY this hash.
 */
export async function hashCredential(cred: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cred))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Server-side display-name sanitization (never trust the client):
 * NFC-normalize, strip control + format chars (incl. zero-width), remove HTML/
 * attribute metachars, collapse whitespace, cap at 24 CODE POINTS (no surrogate
 * split). Returns '' when nothing survives (the caller rejects that).
 */
export function sanitizeDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  let s = raw.normalize('NFC')
  s = s.replace(/[\p{Cc}\p{Cf}]/gu, '') // control + format (zero-width joiners, BOM, ...)
  s = s.replace(/[<>&"'`]/g, '') // HTML/attribute metachars
  s = s.replace(/\s+/g, ' ').trim()
  return [...s].slice(0, 24).join('')
}

export type QuickAccountResult = { accountId: string; isNew: boolean }

/**
 * UPSERT-or-lookup keyed by `credentialHash`:
 *  - an account with that hash exists  -> authenticate-existing (return its id);
 *  - else INSERT a new account (`id = crypto.randomUUID()`) -> mint-new.
 *
 * The INSERT uses `ON CONFLICT(credential_hash) DO NOTHING` + a re-read so two
 * concurrent first-time mints of the same brand-new credential converge on one
 * winner's id (the loser reads it back), never a duplicate or a 500.
 */
export async function quickAccount(
  db: D1Database,
  params: { credentialHash: string; displayName: string; now: number },
): Promise<QuickAccountResult> {
  const existing = await db
    .prepare('SELECT id FROM accounts WHERE credential_hash = ?')
    .bind(params.credentialHash)
    .first<{ id: string }>()
  if (existing) return { accountId: existing.id, isNew: false }

  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO accounts (id, credential_hash, username, display_name, created_at)
       VALUES (?, ?, NULL, ?, ?)
       ON CONFLICT(credential_hash) DO NOTHING`,
    )
    .bind(id, params.credentialHash, params.displayName, params.now)
    .run()

  const row = await db
    .prepare('SELECT id FROM accounts WHERE credential_hash = ?')
    .bind(params.credentialHash)
    .first<{ id: string }>()
  const accountId = row?.id ?? id
  return { accountId, isNew: accountId === id }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * `POST /auth/quick { deviceCredential, displayName }` — mint-or-authenticate.
 * Presenting a credential that already maps to an account re-authenticates that
 * SAME account; a different credential can only ever mint/authenticate a
 * different one. Returns `{ token, accountId }` — the JWT Phase 4 endpoints need.
 */
export async function handleAuthQuick(
  request: Request,
  env: { DB: D1Database; JWT_SECRET?: string },
): Promise<Response> {
  if (!env.JWT_SECRET) return json({ error: 'service_unavailable' }, 503)

  let body: { deviceCredential?: unknown; displayName?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  if (!isValidDeviceCredential(body.deviceCredential)) {
    return json({ error: 'invalid_credential' }, 400)
  }
  const displayName = sanitizeDisplayName(body.displayName)
  if (displayName.length === 0) return json({ error: 'invalid_display_name' }, 400)

  const credentialHash = await hashCredential(body.deviceCredential)
  const { accountId } = await quickAccount(env.DB, { credentialHash, displayName, now: Date.now() })
  const token = await signToken(accountId, env.JWT_SECRET)
  return json({ token, accountId })
}
