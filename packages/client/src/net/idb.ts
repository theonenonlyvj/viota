/**
 * A single IndexedDB database (`viota`) with two stores:
 *  - `outbox`      — queued moves awaiting an idempotent POST /move (keyed by clientMoveId)
 *  - `ghost_games` — completed local solo games, keyed under the device ghostId
 *
 * Centralizing `openDB` keeps the schema/version in one place so the two
 * features never race on conflicting upgrades.
 */

const DB_NAME = 'viota'
const DB_VERSION = 1

export const OUTBOX_STORE = 'outbox'
export const GHOST_STORE = 'ghost_games'

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = globalThis.indexedDB
    if (!idb) {
      reject(new Error('IndexedDB unavailable')) // e.g. plain jsdom — callers treat as non-fatal
      return
    }
    const req = idb.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        const s = db.createObjectStore(OUTBOX_STORE, { keyPath: 'clientMoveId' })
        s.createIndex('byGame', 'gameId', { unique: false })
      }
      if (!db.objectStoreNames.contains(GHOST_STORE)) {
        const s = db.createObjectStore(GHOST_STORE, { keyPath: 'id' })
        s.createIndex('byGhost', 'ghostId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Promise-wrap an IDBRequest. */
export function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Read every row in `store`. */
export async function getAllFromStore<T>(store: string): Promise<T[]> {
  const db = await openDB()
  return new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

/** Run `fn` in a transaction over `store` and resolve when the txn completes. */
export async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => T,
): Promise<T> {
  const db = await openDB()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const os = tx.objectStore(store)
    let result: T
    try {
      result = fn(os)
    } catch (e) {
      reject(e)
      return
    }
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}
