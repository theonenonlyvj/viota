/**
 * Resolve an account id to its canonical (live, un-merged) head by walking
 * `accounts.merged_into` to a fixed point.
 *
 * A merge sets `status='merged'` + `merged_into=<target>` on the losing
 * account (see `account_merges` / `uidx_merge_active`, which enforces at most
 * one LIVE outgoing merge edge per account, so this is normally a short
 * chain). The walk is iterative (no recursion/stack growth) with a
 * visited-set + `maxDepth` guard so a malformed/cyclic merge graph can never
 * hang a request — it just returns the last account seen.
 */
export async function canonical(
  db: D1Database,
  id: string,
  maxDepth = 64,
): Promise<{ id: string; status: string } | null> {
  const seen = new Set<string>()
  let cur = id
  for (let i = 0; i < maxDepth; i++) {
    if (seen.has(cur)) break // cycle guard
    seen.add(cur)
    const row = await db
      .prepare(`SELECT id, status, merged_into FROM accounts WHERE id=?`)
      .bind(cur)
      .first<{ id: string; status: string; merged_into: string | null }>()
    if (!row) return null
    if (row.status !== 'merged' || !row.merged_into) return { id: row.id, status: row.status }
    cur = row.merged_into
  }
  const last = await db
    .prepare(`SELECT id, status FROM accounts WHERE id=?`)
    .bind(cur)
    .first<{ id: string; status: string }>()
  return last ? { id: last.id, status: last.status } : null
}

export interface CanonicalIdentitySummary {
  id: string
  status: 'ghost' | 'claimed'
  displayName: string
  aliases: string[]
}

const MAX_IDENTITY_ACCOUNTS = 64

/**
 * Build a durable identity receipt from bounded canonical and recursive alias
 * queries. The recursive walk is path-aware and reads one overflow sentinel,
 * so malformed or oversized merge graphs cannot produce a partial receipt.
 */
export async function canonicalIdentitySummary(
  db: D1Database,
  accountId: string,
): Promise<CanonicalIdentitySummary | null> {
  const canon = await canonical(db, accountId, MAX_IDENTITY_ACCOUNTS)
  if (!canon || (canon.status !== 'ghost' && canon.status !== 'claimed')) return null

  const head = await db
    .prepare(`SELECT id, status, display_name, merged_into FROM accounts WHERE id=?`)
    .bind(canon.id)
    .first<{ id: string; status: string; display_name: string; merged_into: string | null }>()
  if (!head || head.status !== canon.status || head.merged_into) return null

  const aliasRows = await db
    .prepare(
      `WITH RECURSIVE descendants(id, path, depth) AS (
         SELECT id, ',' || id || ',', 0
         FROM accounts
         WHERE id=?
         UNION ALL
         SELECT a.id, descendants.path || a.id || ',', descendants.depth + 1
         FROM accounts a
         JOIN descendants ON a.merged_into = descendants.id
         WHERE a.status='merged'
           AND descendants.depth < ?
           AND instr(descendants.path, ',' || a.id || ',') = 0
       )
       SELECT id
       FROM descendants
       LIMIT ?`,
    )
    .bind(canon.id, MAX_IDENTITY_ACCOUNTS, MAX_IDENTITY_ACCOUNTS + 1)
    .all<{ id: string }>()
  const identityRows = aliasRows.results ?? []
  if (identityRows.length > MAX_IDENTITY_ACCOUNTS) return null

  return {
    id: head.id,
    status: head.status as 'ghost' | 'claimed',
    displayName: head.display_name,
    aliases: [...new Set(identityRows.map((row) => row.id).filter((id) => id !== head.id))].sort(),
  }
}
