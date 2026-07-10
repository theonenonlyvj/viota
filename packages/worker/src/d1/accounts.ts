import { signToken } from '../jwt'
import { findAccountByDevice, upsertDevice } from './devices'

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

/** Games allowed to stamp `origin_game` on a NEWLY-minted account via
 *  `/auth/quick`. Purely additive/cosmetic (analytics only — never consulted
 *  by auth or leaderboards): an unrecognized or absent value falls back to
 *  the long-standing default, 'iota'. */
const ORIGIN_GAMES = ['iota', 'jaipur'] as const
export type OriginGame = (typeof ORIGIN_GAMES)[number]
export function isValidOriginGame(v: unknown): v is OriginGame {
  return typeof v === 'string' && (ORIGIN_GAMES as readonly string[]).includes(v)
}

export type QuickAccountResult = { accountId: string; isNew: boolean }

/**
 * UPSERT-or-lookup keyed by `credentialHash`, now layered over
 * `device_credentials` (VGames identity):
 *  1. a `device_credentials` row for this hash exists -> authenticate-existing
 *     (touch `last_seen_at`, return its account id);
 *  2. else a legacy `accounts.credential_hash` hit (an account minted before
 *     `device_credentials` existed) -> authenticate-existing AND backfill a
 *     device row for it, so it's on the new lookup path from here on;
 *  3. else INSERT a new account (`id = crypto.randomUUID()`) -> mint-new, then
 *     insert its device row.
 *
 * The INSERT uses `ON CONFLICT(credential_hash) DO NOTHING` + a re-read so two
 * concurrent first-time mints of the same brand-new credential converge on one
 * winner's id (the loser reads it back), never a duplicate or a 500.
 */
export async function quickAccount(
  db: D1Database,
  params: {
    credentialHash: string
    displayName: string
    now: number
    /** Coarse IP-derived geo (request.cf); stored ONLY on the mint INSERT, never
     *  on re-auth of an existing account. Null when unavailable. */
    country?: string | null
    region?: string | null
    timezone?: string | null
    /** Which game's client is minting this account; stored ONLY on the mint
     *  INSERT (never overwrites an existing account's origin_game). Defaults
     *  to 'iota' when absent — see isValidOriginGame. */
    originGame?: OriginGame
  },
): Promise<QuickAccountResult> {
  const byDevice = await findAccountByDevice(db, params.credentialHash)
  if (byDevice) {
    await upsertDevice(db, params.credentialHash, byDevice, params.now)
    return { accountId: byDevice, isNew: false }
  }

  const existing = await db
    .prepare('SELECT id FROM accounts WHERE credential_hash = ?')
    .bind(params.credentialHash)
    .first<{ id: string }>()
  if (existing) {
    // Legacy account with no device_credentials row yet — backfill it.
    await upsertDevice(db, params.credentialHash, existing.id, params.now)
    return { accountId: existing.id, isNew: false }
  }

  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO accounts (id, credential_hash, username, display_name, created_at, country, region, timezone, status, origin_game, last_seen_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'ghost', ?, ?)
       ON CONFLICT(credential_hash) DO NOTHING`,
    )
    .bind(
      id,
      params.credentialHash,
      params.displayName,
      params.now,
      params.country ?? null,
      params.region ?? null,
      params.timezone ?? null,
      params.originGame ?? 'iota',
      params.now,
    )
    .run()

  const row = await db
    .prepare('SELECT id FROM accounts WHERE credential_hash = ?')
    .bind(params.credentialHash)
    .first<{ id: string }>()
  const accountId = row?.id ?? id
  const isNew = accountId === id
  // Whichever account id won the race (this insert or a concurrent one), it
  // needs a device row for this credential hash.
  await upsertDevice(db, params.credentialHash, accountId, params.now)
  return { accountId, isNew }
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

  let body: { deviceCredential?: unknown; displayName?: unknown; game?: unknown }
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
  // Optional, additive: which game's client is calling. Absent/unrecognized
  // falls back to the long-standing default ('iota') — existing viota
  // clients send no `game` and are unaffected.
  const originGame: OriginGame = isValidOriginGame(body.game) ? body.game : 'iota'

  const credentialHash = await hashCredential(body.deviceCredential)
  // Coarse IP-derived geo from Cloudflare's request.cf — no GPS, no permission
  // prompt. All fields may be undefined (Miniflare/tests, or a stripped edge);
  // read defensively and store null when absent, never throw.
  const cf = (request as { cf?: { country?: unknown; region?: unknown; timezone?: unknown } }).cf
  const geo = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
  const { accountId } = await quickAccount(env.DB, {
    credentialHash,
    displayName,
    now: Date.now(),
    country: geo(cf?.country),
    region: geo(cf?.region),
    timezone: geo(cf?.timezone),
    originGame,
  })
  const token = await signToken(accountId, env.JWT_SECRET)
  return json({ token, accountId })
}
