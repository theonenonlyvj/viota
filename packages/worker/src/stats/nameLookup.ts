/**
 * Identity code/data split (A8) — the batched cross-DB name lookup that
 * replaces `JOIN accounts` in the leaderboard boards. D1 cannot join across
 * two D1 databases, so once name data lives behind `IDENTITY_DB` the read
 * becomes two steps: (1) the game-side query (`DB`) returns bare
 * `account_id`s, then (2) THIS module batch-resolves `display_name`/
 * `username` from `IDENTITY_DB` — chunked to <=90 ids per statement (D1's
 * bound-parameter ceiling is 100; 90 leaves headroom for the odd extra bound
 * param a caller might add later).
 *
 * A missing accounts row (deleted, or — pre-Step-4 test/dev drift — simply
 * never written to this binding) degrades to the caller-supplied fallback
 * name (`game_players.display_name`, the name recorded AT PLAY TIME) rather
 * than dropping the row or throwing. A leaderboard row must never vanish
 * just because the identity-side name lookup came up empty.
 */

export type AccountName = { displayName: string; username: string | null }

const CHUNK_SIZE = 90

/** Batch-resolve `{displayName, username}` for `accountIds` from `IDENTITY_DB`,
 *  chunked to stay under D1's 100-bound-param-per-statement limit. Duplicate
 *  ids are deduped before querying (a caller may pass the same id many times
 *  across board rows). Ids with no matching `accounts` row are simply absent
 *  from the returned Map — callers fall back to their own known name. */
export async function lookupAccountNames(identityDb: D1Database, accountIds: readonly string[]): Promise<Map<string, AccountName>> {
  const uniqueIds = [...new Set(accountIds)]
  const result = new Map<string, AccountName>()
  if (uniqueIds.length === 0) return result

  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + CHUNK_SIZE)
    const placeholders = chunk.map(() => '?').join(',')
    const { results } = await identityDb
      .prepare(`SELECT id, display_name, username FROM accounts WHERE id IN (${placeholders})`)
      .bind(...chunk)
      .all<{ id: string; display_name: string; username: string | null }>()
    for (const row of results) {
      result.set(row.id, { displayName: row.display_name, username: row.username })
    }
  }
  return result
}

/** Resolve one account's display name, falling back to `fallback` (typically
 *  `game_players.display_name`, the name recorded at play time) when the
 *  identity-side row is missing — never a dropped/blank name. */
export function resolveDisplayName(names: Map<string, AccountName>, accountId: string, fallback: string | null): string {
  return names.get(accountId)?.displayName ?? fallback ?? ''
}

/** Resolve one account's username (null when the identity row is missing OR
 *  the account has none — a username has no game-side fallback). */
export function resolveUsername(names: Map<string, AccountName>, accountId: string): string | null {
  return names.get(accountId)?.username ?? null
}
