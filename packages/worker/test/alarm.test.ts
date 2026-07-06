import { env, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test'
import { it, expect, describe } from 'vitest'
import type { SqlLike } from '../src/do/storage'
import { setTimer, rearmAlarm, hasTimer } from '../src/do/timers'
import { markDisconnected } from '../src/do/presence'
import { seedLiveGame } from './helpers'

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

// Arm timers in the FUTURE so the platform does not auto-fire them early (which
// would race the explicit runDurableObjectAlarm). runDurableObjectAlarm fires
// the alarm regardless of the scheduled time, and the handler processes the
// earliest timer on any fire (threshold = max(now, min(fire_at))).
const FUTURE = () => Date.now() + 60_000

describe('alarm() handler — timer-wheel dispatch + CPU-kill floor', () => {
  it('an ai_step alarm drives exactly one AI move for the current AI seat', async () => {
    const stub = stubFor('alarm-ai-step')

    // seat 0 AI-covered, seat 1 a present human. Firing ai_step drives seat 0
    // once and advances to seat 1 (human) -> no runaway.
    await runInDurableObject(stub, async (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      seedLiveGame(sql, { playerCount: 2, aiSeats: [0], presentSeats: [1], now: Date.now() })
      setTimer(sql, 'ai_step', 0, FUTURE())
      await rearmAlarm(state, sql)
    })

    expect(await runDurableObjectAlarm(stub)).toBe(true)

    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const rows = [...sql.exec('SELECT seat_index, by_ai FROM moves ORDER BY move_index')]
      expect(rows.length).toBe(1)
      expect(Number(rows[0]!.seat_index)).toBe(0)
      expect(Number(rows[0]!.by_ai)).toBe(1)
      const meta = [...sql.exec('SELECT current_seat FROM meta WHERE id=1')][0] as any
      expect(Number(meta.current_seat)).toBe(1) // advanced past the AI seat
    })
  })

  it('a RETRY (isRetry) takes the O(1) pass floor and advances the turn (CPU-kill proof)', async () => {
    const stub = stubFor('alarm-floor')

    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      // seat 0 AI-covered + on turn, seat 1 present human.
      seedLiveGame(sql, { playerCount: 2, aiSeats: [0], presentSeats: [1], now: Date.now() })
    })

    // runDurableObjectAlarm cannot set isRetry; invoke alarm() directly with a
    // synthetic retry AlarmInvocationInfo to exercise the CPU-kill floor branch.
    await runInDurableObject(stub, (i: any) => i.alarm({ isRetry: true, retryCount: 1 }))

    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const rows = [
        ...sql.exec('SELECT type, by_ai, ai_difficulty, client_move_id FROM moves ORDER BY move_index'),
      ]
      expect(rows.length).toBe(1)
      const floor = rows[0]! as any
      expect(floor.type).toBe('pass') // the O(1) always-legal floor
      expect(Number(floor.by_ai)).toBe(1)
      expect(floor.ai_difficulty).toBe('floor')
      expect(floor.client_move_id).toBe('floor:0:1') // deterministic -> re-fire benign
      const meta = [...sql.exec('SELECT current_seat FROM meta WHERE id=1')][0] as any
      expect(Number(meta.current_seat)).toBe(1) // turn advanced past the killed seat
    })
  })

  it('a floor retry with no AI-covered current seat is a safe no-op', async () => {
    const stub = stubFor('alarm-floor-noop')
    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [0, 1], now: Date.now() })
    })
    await runInDurableObject(stub, (i: any) => i.alarm({ isRetry: true, retryCount: 3 }))
    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      expect(Number(([...sql.exec('SELECT COUNT(*) AS c FROM moves')][0] as any).c)).toBe(0)
    })
  })

  it('a due grace timer auto-covers an ABSENT off-turn seat', async () => {
    const stub = stubFor('alarm-grace-cover')
    await runInDurableObject(stub, async (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      // current seat 0 present; seat 1 absent (never heartbeated).
      seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [0], now: Date.now() })
      setTimer(sql, 'grace', 1, FUTURE())
      await rearmAlarm(state, sql)
    })

    expect(await runDurableObjectAlarm(stub)).toBe(true)

    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const seat1 = [...sql.exec('SELECT controlled_by_ai FROM seats WHERE seat_index=1')][0] as any
      expect(Number(seat1.controlled_by_ai)).toBe(1) // covered
      expect(hasTimer(sql, 'grace', 1)).toBe(false) // deadline consumed
      expect(hasTimer(sql, 'ai_step', 1)).toBe(true) // drive loop kicked
    })
  })

  it('a due grace timer SPARES a seat that is present again (returning human)', async () => {
    const stub = stubFor('alarm-grace-spare')
    const now = Date.now()
    await runInDurableObject(stub, async (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      // seat 1 is PRESENT (fresh last_seen_at) yet has a leftover grace timer.
      seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [0, 1], now })
      setTimer(sql, 'grace', 1, FUTURE())
      await rearmAlarm(state, sql)
    })

    expect(await runDurableObjectAlarm(stub)).toBe(true)

    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const seat1 = [...sql.exec('SELECT controlled_by_ai FROM seats WHERE seat_index=1')][0] as any
      expect(Number(seat1.controlled_by_ai)).toBe(0) // NOT covered — human is back
      expect(hasTimer(sql, 'grace', 1)).toBe(false) // stale deadline dropped
    })
  })

  it('a fast-track turn timer covers a disconnected ON-turn seat', async () => {
    const stub = stubFor('alarm-turn-cover')
    await runInDurableObject(stub, async (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [1], now: Date.now() })
      markDisconnected(repo, sql, 0, Date.now()) // seat 0 on turn -> arms `turn`
      setTimer(sql, 'turn', 0, FUTURE())
      await rearmAlarm(state, sql)
    })

    expect(await runDurableObjectAlarm(stub)).toBe(true)

    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const seat0 = [...sql.exec('SELECT controlled_by_ai FROM seats WHERE seat_index=0')][0] as any
      expect(Number(seat0.controlled_by_ai)).toBe(1)
    })
  })
})
