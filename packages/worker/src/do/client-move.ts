import type { MoveRow } from './storage'

/**
 * Public, redacted projection of a persisted move row for `/sync` clients.
 *
 * REDACTION (hidden-information rule): a `pass` move's `trades`/`tradeOrder` are
 * the private cards a player swapped back into the pile — opponents must NEVER
 * see which cards someone traded away. So a pass is projected to a COUNT only
 * (`tradedCount`), never the card contents, for EVERY seat (the log is shared).
 *
 * `play` placements and `wild_recycle` (wildPosition + replacement) are public —
 * they are visible on the board — so their payloads pass through unredacted.
 */
export type ClientMove = {
  moveIndex: number
  turnNumber: number
  seatIndex: number
  type: MoveRow['type']
  payload: unknown
  scoreDelta: number
  scoreAfter: number
  byAi: boolean
}

export function toClientMove(m: MoveRow): ClientMove {
  const raw = JSON.parse(m.payload) as Record<string, unknown>

  let payload: unknown
  if (m.type === 'pass') {
    const trades = Array.isArray(raw.trades) ? raw.trades : []
    payload = { type: 'pass', tradedCount: trades.length } // count only — cards hidden
  } else {
    payload = raw // play placements + wild_recycle are public (on the board)
  }

  return {
    moveIndex: m.move_index,
    turnNumber: m.turn_number,
    seatIndex: m.seat_index,
    type: m.type,
    payload,
    scoreDelta: m.score_delta,
    scoreAfter: m.score_after,
    byAi: m.by_ai,
  }
}
