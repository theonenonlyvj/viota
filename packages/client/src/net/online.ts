import type {
  ClientView,
  MovePayload,
  PostMoveResult,
  ReclaimResponse,
  SyncResponse,
  VetoResponse,
} from './protocol'
import { authedFetch } from './http'
import { enqueue, listQueued, markDone } from './outbox'

/**
 * The HTTP-first online client (spec §2). Correctness NEVER rides the socket:
 * every mutation + recovery is idempotent HTTP.
 *  - `sync` is the recovery primitive (GET, replace-wholesale on the client).
 *  - `postMove` goes through the IndexedDB outbox: enqueue → POST → mark done;
 *    a network failure leaves it `queued` for `drainOutbox` to replay.
 *  - `heartbeat`/`reclaim`/`veto` are plain authed POSTs.
 *
 * A seat is fixed for the life of a game; the client closes over `seatIndex`
 * (the Worker's /move endpoint requires it in the body AND re-checks that the
 * token's account owns it).
 */
export type OnlineClient = {
  gameId: string
  seatIndex: number
  sync(since: number): Promise<SyncResponse>
  postMove(move: MovePayload, clientMoveId: string): Promise<PostMoveResult>
  drainOutbox(): Promise<void>
  heartbeat(): Promise<void>
  reclaim(): Promise<ReclaimResponse | null>
  veto(): Promise<VetoResponse>
}

/** A transient HTTP status the move should be REPLAYED on (like a network drop):
 *  any 5xx, plus 408 Request Timeout and 429 Too Many Requests. Everything else
 *  in the 4xx range is permanent and resolves the move. */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429
}

export function createOnlineClient(serverUrl: string, gameId: string, seatIndex: number): OnlineClient {
  const base = `/games/${encodeURIComponent(gameId)}`

  function moveBody(move: MovePayload, clientMoveId: string): RequestInit {
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seatIndex, move, clientMoveId }),
    }
  }

  /** POST /move and normalize the DO's response into a PostMoveResult. On a
   *  network error — OR a transient 5xx/408/429 — THROW so the caller leaves the
   *  move queued for idempotent replay (the server dedupes by clientMoveId). */
  async function send(move: MovePayload, clientMoveId: string): Promise<PostMoveResult> {
    const res = await authedFetch(serverUrl, `${base}/move`, moveBody(move, clientMoveId))
    if (res.ok) {
      const body = (await res.json()) as {
        ok?: true
        duplicate?: true
        moveIndex?: number
        view: ClientView
      }
      if (body.duplicate) return { status: 'duplicate', view: body.view }
      return { status: 'ok', moveIndex: body.moveIndex as number, view: body.view }
    }
    // Transient failures (5xx cold-start/overload, 408 timeout, 429 rate-limit)
    // are RETRYABLE — treat them exactly like a network drop so the move stays in
    // the outbox and replays later with the SAME clientMoveId.
    if (isRetryableStatus(res.status)) throw new Error(`retryable_${res.status}`)
    // A permanent 4xx (illegal move / conflict / not-your-turn) will never succeed
    // on replay, so it is NOT left queued (the caller re-syncs).
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return { status: 'error', http: res.status, error: body.error ?? `http_${res.status}` }
  }

  return {
    gameId,
    seatIndex,

    async sync(since: number): Promise<SyncResponse> {
      const res = await authedFetch(serverUrl, `${base}/sync?since=${since}`, { method: 'GET' })
      if (!res.ok) throw new Error(`sync failed: ${res.status}`)
      return (await res.json()) as SyncResponse
    },

    async postMove(move: MovePayload, clientMoveId: string): Promise<PostMoveResult> {
      await enqueue({ clientMoveId, gameId, seatIndex, move })
      let result: PostMoveResult
      try {
        result = await send(move, clientMoveId)
      } catch {
        return { status: 'queued' } // network failure — stays in the outbox
      }
      // Completed HTTP response (2xx or permanent 4xx) → the move is resolved.
      await markDone(clientMoveId)
      return result
    },

    async drainOutbox(): Promise<void> {
      const queued = await listQueued(gameId)
      for (const e of queued) {
        try {
          await send(e.move, e.clientMoveId) // server dedupes by clientMoveId
        } catch {
          return // still offline — leave this + the rest queued, stop draining
        }
        await markDone(e.clientMoveId)
      }
    },

    async heartbeat(): Promise<void> {
      await authedFetch(serverUrl, `${base}/heartbeat`, { method: 'POST' })
    },

    async reclaim(): Promise<ReclaimResponse | null> {
      const res = await authedFetch(serverUrl, `${base}/reclaim`, { method: 'POST' })
      if (!res.ok) return null
      return (await res.json()) as ReclaimResponse
    },

    async veto(): Promise<VetoResponse> {
      const res = await authedFetch(serverUrl, `${base}/veto`, { method: 'POST' })
      if (res.status === 409) return { vetoable: false }
      if (!res.ok) throw new Error(`veto failed: ${res.status}`)
      return (await res.json()) as VetoResponse
    },
  }
}
