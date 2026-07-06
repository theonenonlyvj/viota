import type { OnlineClient } from './online'
import type { SyncResponse } from './protocol'

/**
 * Reconcile = the instant, correct foreground recovery (spec §4).
 *
 * On each of the FOUR foreground events — `visibilitychange→visible`, `pageshow`
 * (iOS bfcache), `online` (wifi↔cellular), and WS `onopen` — we:
 *   (1) optionally POST /reclaim (silent seat reclaim, on visibility→visible);
 *   (2) drain the IndexedDB outbox (idempotent replay of queued local moves);
 *   (3) GET /sync?since=localIndex and REPLACE state wholesale — now reflecting
 *       the just-drained move (draining BEFORE the sync avoids briefly reverting
 *       an offline-confirmed move to the stale pre-move snapshot).
 * Because the reconnect target is a warm DO, this is sub-second.
 */
export type ReconcileTrigger = 'visible' | 'pageshow' | 'online' | 'wsopen'

export type ReconcileDeps = {
  client: OnlineClient
  getLocalIndex: () => number
  applySync: (res: SyncResponse) => void
}

export async function runReconcile(
  deps: ReconcileDeps,
  opts: { withReclaim?: boolean } = {},
): Promise<void> {
  // (1) silent reclaim first (visibility→visible) so /sync reflects the reclaim.
  if (opts.withReclaim) {
    const r = await deps.client.reclaim().catch(() => null)
    if (r) deps.applySync({ moveIndex: r.moveIndex, snapshot: r.snapshot, moves: [] })
  }
  // (2) replay any queued local moves FIRST (server dedupes by clientMoveId) so
  //     the trailing sync reflects them. Draining after the sync would apply the
  //     stale pre-move snapshot wholesale — briefly reverting an offline-confirmed
  //     move and re-enabling input until a later nudge/poll.
  await deps.client.drainOutbox()
  // (3) pull authoritative truth (now including the drained move), replace wholesale.
  const res = await deps.client.sync(deps.getLocalIndex())
  deps.applySync(res)
}

/**
 * Wire the three window-level foreground events. `visibilitychange` fires the
 * handler only when the page became visible. Returns a cleanup fn.
 */
export function attachForegroundReconcile(
  handler: (trigger: ReconcileTrigger) => void,
): () => void {
  const onVis = () => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') handler('visible')
  }
  const onShow = () => handler('pageshow')
  const onOnline = () => handler('online')
  window.addEventListener('visibilitychange', onVis)
  window.addEventListener('pageshow', onShow)
  window.addEventListener('online', onOnline)
  return () => {
    window.removeEventListener('visibilitychange', onVis)
    window.removeEventListener('pageshow', onShow)
    window.removeEventListener('online', onOnline)
  }
}
