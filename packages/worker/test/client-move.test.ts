import { SELF } from 'cloudflare:test'
import { it, expect, describe } from 'vitest'
import type { Card } from '@viota/engine'
import { toClientMove } from '../src/do/client-move'
import type { MoveRow } from '../src/do/storage'
import { authHeaders } from './helpers'

// --- Unit: the projection redacts a pass, keeps play/wild_recycle public ------
function row(over: Partial<MoveRow>): MoveRow {
  return {
    move_index: 1,
    turn_number: 1,
    seat_index: 0,
    type: 'play',
    payload: '{}',
    score_delta: 0,
    score_after: 0,
    by_ai: false,
    ai_difficulty: null,
    controlling_account_id: null,
    client_move_id: null,
    reverted: false,
    created_at: 0,
    ...over,
  }
}

describe('toClientMove projection', () => {
  it('redacts a pass: emits tradedCount only, never the traded cards', () => {
    const trades = [{ kind: 'wild' }, { kind: 'regular', color: 'yellow', shape: 'plus', number: 4 }]
    const m = toClientMove(row({ type: 'pass', payload: JSON.stringify({ type: 'pass', trades, tradeOrder: [...trades].reverse() }) }))
    expect(m.type).toBe('pass')
    const p = m.payload as Record<string, unknown>
    expect(p.tradedCount).toBe(2)
    expect('trades' in p).toBe(false)
    expect('tradeOrder' in p).toBe(false)
    // no trace of the traded cards anywhere in the projected move
    expect(JSON.stringify(m)).not.toContain('yellow')
    expect(JSON.stringify(m)).not.toContain('tradeOrder')
  })

  it('keeps a play public (placements are on the board)', () => {
    const placements = [{ card: { kind: 'regular', color: 'red', shape: 'triangle', number: 1 }, position: { x: 1, y: 0 } }]
    const m = toClientMove(row({ type: 'play', payload: JSON.stringify({ type: 'play', placements }) }))
    const p = m.payload as Record<string, unknown>
    expect(Array.isArray(p.placements)).toBe(true)
  })

  it('keeps a wild_recycle public (wildPosition + replacement are on the board)', () => {
    const payload = { type: 'wild_recycle', wildPosition: { x: 0, y: 0 }, replacement: { kind: 'regular', color: 'red', shape: 'triangle', number: 3 } }
    const m = toClientMove(row({ type: 'wild_recycle', payload: JSON.stringify(payload) }))
    const p = m.payload as Record<string, unknown>
    expect(p.wildPosition).toEqual({ x: 0, y: 0 })
    expect(p.replacement).toEqual(payload.replacement)
  })
})

// --- Integration: a pass never leaks trade contents through /sync -------------
async function createGame(): Promise<string> {
  const seatOwners = [
    { ownerType: 'human' as const, accountId: 'acct-0', displayName: 'P0' },
    { ownerType: 'human' as const, accountId: 'acct-1', displayName: 'P1' },
  ]
  const res = await SELF.fetch('https://example.com/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerCount: 2, seatOwners }),
  })
  return ((await res.json()) as { gameId: string }).gameId
}

async function sync(gameId: string, seat: number): Promise<{ text: string; body: any }> {
  const res = await SELF.fetch(`https://example.com/games/${gameId}/sync?since=0`, {
    headers: await authHeaders(`acct-${seat}`),
  })
  const text = await res.text()
  return { text, body: JSON.parse(text) }
}

async function postMove(gameId: string, body: unknown): Promise<Response> {
  const seat = (body as { seatIndex: number }).seatIndex
  return SELF.fetch(`https://example.com/games/${gameId}/move`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders(`acct-${seat}`)) },
    body: JSON.stringify(body),
  })
}

describe('/sync never leaks a pass move’s traded cards, for any seat', () => {
  it('hides trades/tradeOrder but keeps play placements visible', async () => {
    const gameId = await createGame()

    // Move 1: seat 0 plays its first card adjacent to the starter (always legal).
    const hand0 = (await sync(gameId, 0)).body.snapshot.myHand as Card[]
    const p1 = await postMove(gameId, {
      seatIndex: 0,
      move: { type: 'play', placements: [{ card: hand0[0], position: { x: 1, y: 0 } }] },
      clientMoveId: crypto.randomUUID(),
      accountId: 'acct-0',
    })
    expect(p1.status).toBe(200)

    // Move 2: seat 1 passes, trading two real cards from its hand.
    const hand1 = (await sync(gameId, 1)).body.snapshot.myHand as Card[]
    const trades = [hand1[0], hand1[1]]
    const p2 = await postMove(gameId, {
      seatIndex: 1,
      move: { type: 'pass', trades, tradeOrder: [hand1[1], hand1[0]] },
      clientMoveId: crypto.randomUUID(),
      accountId: 'acct-1',
    })
    expect(p2.status).toBe(200)

    for (const seat of [0, 1]) {
      const { text, body } = await sync(gameId, seat)
      const passMove = body.moves.find((m: any) => m.type === 'pass')
      const playMove = body.moves.find((m: any) => m.type === 'play')

      // pass: redacted to a count; the play: placements public.
      expect(passMove.payload.tradedCount).toBe(2)
      expect('trades' in passMove.payload).toBe(false)
      expect('tradeOrder' in passMove.payload).toBe(false)
      expect(Array.isArray(playMove.payload.placements)).toBe(true)

      // The trade-carrying keys never appear in the raw wire bytes.
      expect(text).not.toContain('tradeOrder')
      expect(text).not.toContain('"trades"')
    }
  })
})
