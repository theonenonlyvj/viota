import type { MovePayload } from './protocol'
import { OUTBOX_STORE, getAllFromStore, withStore } from './idb'

/**
 * The IndexedDB move outbox (spec §4). Every online move is enqueued locally
 * BEFORE it is POSTed, so a network failure never loses it: it stays `queued`
 * and is replayed idempotently on the next reconcile (the server dedupes by
 * `clientMoveId`). A move that completes (any HTTP response, success or a
 * permanent 4xx) is marked `done` so it is never re-sent.
 */
export type OutboxEntry = {
  clientMoveId: string
  gameId: string
  seatIndex: number
  move: MovePayload
  status: 'queued' | 'done'
  createdAt: number
}

/** Enqueue a move as `queued` (idempotent: a repeat clientMoveId overwrites). */
export async function enqueue(entry: Omit<OutboxEntry, 'status' | 'createdAt'>): Promise<void> {
  const row: OutboxEntry = { ...entry, status: 'queued', createdAt: Date.now() }
  await withStore(OUTBOX_STORE, 'readwrite', (s) => s.put(row))
}

/** Mark a move done (it will no longer be drained). */
export async function markDone(clientMoveId: string): Promise<void> {
  await withStore(OUTBOX_STORE, 'readwrite', (s) => {
    const getReq = s.get(clientMoveId)
    getReq.onsuccess = () => {
      const row = getReq.result as OutboxEntry | undefined
      if (row) s.put({ ...row, status: 'done' })
    }
  })
}

/** All still-queued moves for a game, oldest first (replay order). */
export async function listQueued(gameId: string): Promise<OutboxEntry[]> {
  const rows = await getAllFromStore<OutboxEntry>(OUTBOX_STORE)
  return rows
    .filter((r) => r.gameId === gameId && r.status === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** Test/maintenance helper: purge done rows for a game. */
export async function purgeDone(gameId: string): Promise<void> {
  const rows = await getAllFromStore<OutboxEntry>(OUTBOX_STORE)
  const done = rows.filter((r) => r.gameId === gameId && r.status === 'done')
  await withStore(OUTBOX_STORE, 'readwrite', (s) => {
    for (const r of done) s.delete(r.clientMoveId)
  })
}
