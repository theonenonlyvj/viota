/**
 * `device_credentials` — the VGames-identity per-device lookup, layered
 * alongside (not replacing) `accounts.credential_hash`. Letting a device
 * credential live in its own row (rather than only the 1:1 `accounts` column)
 * is what makes device revocation / multi-device binding possible later
 * without touching the account row itself.
 */

export async function findAccountByDevice(db: D1Database, credHash: string): Promise<string | null> {
  const r = await db
    .prepare(`SELECT account_id FROM device_credentials WHERE credential_hash=? AND revoked_at IS NULL`)
    .bind(credHash)
    .first<{ account_id: string }>()
  return r ? r.account_id : null
}

/** INSERT-or-touch: a fresh credential gets a new row; a known one has its
 *  `last_seen_at` refreshed. Never throws on a re-auth race (ON CONFLICT). */
export async function upsertDevice(db: D1Database, credHash: string, accountId: string, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO device_credentials (credential_hash, account_id, created_at, last_seen_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(credential_hash) DO UPDATE SET last_seen_at=excluded.last_seen_at`,
    )
    .bind(credHash, accountId, now, now)
    .run()
}
