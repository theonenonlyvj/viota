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
