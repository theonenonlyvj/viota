import { getDeviceCredential, getGhostId } from './identity'
import { authedFetch } from './http'
import { GHOST_STORE, getAllFromStore, withStore } from './idb'

/**
 * Ghost solo games (spec §6).
 *
 * A completed LOCAL single-player game is recorded to IndexedDB keyed under the
 * device `ghostId` (= SHA-256(deviceCredential)). After login (`quickAuth`),
 * `claimGhostGames` calls `POST /claim { ghostId, deviceCredential }` so the
 * server reassigns any server-side ghost rows to the account (idempotent,
 * ON CONFLICT DO NOTHING; account B can never claim account A's ghost id).
 *
 * NOTE — the client-reported UPLOAD of these locally-stored games to the server
 * is a DEFERRED fast-follow (there is no `source:'client_reported'` upload
 * endpoint yet). For Phase 6 we only STORE them locally and claim server-side
 * ghost rows. The stored records are ready to upload once that endpoint ships.
 */
export type GhostGameRecord = {
  id: string
  ghostId: string
  playerCount: number
  mySeat: number
  scores: number[]
  winnerSeat: number | null
  finishedAt: number
}

export type GhostGameInput = {
  playerCount: number
  mySeat: number
  scores: number[]
  winnerSeat: number | null
}

/** Persist a completed local game under this device's ghostId. */
export async function recordGhostGame(game: GhostGameInput): Promise<GhostGameRecord> {
  const ghostId = await getGhostId()
  const rec: GhostGameRecord = {
    id: crypto.randomUUID(),
    ghostId,
    finishedAt: Date.now(),
    ...game,
  }
  await withStore(GHOST_STORE, 'readwrite', (s) => s.put(rec))
  return rec
}

/** List stored ghost games (optionally filtered to a ghostId). */
export async function listGhostGames(ghostId?: string): Promise<GhostGameRecord[]> {
  const all = await getAllFromStore<GhostGameRecord>(GHOST_STORE)
  return ghostId ? all.filter((g) => g.ghostId === ghostId) : all
}

/**
 * Claim this device's server-side ghost rows into the logged-in account.
 * Requires a Bearer token (call after `quickAuth`). Returns the number of rows
 * the server reassigned. Never throws — a claim failure is non-fatal.
 */
export async function claimGhostGames(serverUrl: string): Promise<{ claimed: number }> {
  const ghostId = await getGhostId()
  const deviceCredential = getDeviceCredential()
  try {
    const res = await authedFetch(serverUrl, '/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ghostId, deviceCredential }),
    })
    if (!res.ok) return { claimed: 0 }
    const body = (await res.json()) as { claimed?: number }
    return { claimed: body.claimed ?? 0 }
  } catch {
    return { claimed: 0 }
  }
}
