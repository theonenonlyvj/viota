import { env, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test'
import { it, expect, describe } from 'vitest'
import type { SqlLike } from '../src/do/storage'
import { setTimer, rearmAlarm } from '../src/do/timers'
import { driveIfAI } from '../src/do/drive'
import { ABANDON_MS, HEAL_MS, GLOBAL_SEAT } from '../src/do/constants'
import { seedLiveGame } from './helpers'

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

describe('boot grace-quarantine (long-eviction credit)', () => {
  it('does NOT auto-cover a still-present seat on wake after a long eviction', async () => {
    const stub = stubFor('evict-present')
    const T = Date.now()
    await runInDurableObject(stub, async (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [1], now: T })
      // A grace timer for the present seat 1, and a last_processed_at from long
      // ago so the wake sees a huge eviction gap.
      setTimer(sql, 'grace', 1, T) // due at T
      repo.setLastProcessedAt(T - 10 * 60_000) // 10 min ago -> gap >> PRESENCE_MS
      await rearmAlarm(state, sql)
    })

    await runDurableObjectAlarm(stub)

    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const seat1 = [...sql.exec('SELECT controlled_by_ai FROM seats WHERE seat_index=1')][0] as any
      expect(Number(seat1.controlled_by_ai)).toBe(0) // present seat spared
    })
  })

  it('credits an ABSENT seat one presence window (its due grace is pushed out, not fired)', async () => {
    const stub = stubFor('evict-absent')
    const T = Date.now()
    await runInDurableObject(stub, async (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      // seat 0 is a present watcher; seat 1 is absent with a grace that WAS due.
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [0], now: T })
      setTimer(sql, 'grace', 1, T) // due at T
      repo.setLastProcessedAt(T - 10 * 60_000) // huge gap
      await rearmAlarm(state, sql)
    })

    await runDurableObjectAlarm(stub)

    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const seat1 = [...sql.exec('SELECT controlled_by_ai FROM seats WHERE seat_index=1')][0] as any
      expect(Number(seat1.controlled_by_ai)).toBe(0) // NOT covered this wake (quarantined)
      // the deadline was credited into the future (a fresh quarantine window)
      const grace = [...sql.exec("SELECT fire_at FROM timers WHERE kind='grace' AND seat=1")][0] as any
      expect(Number(grace.fire_at)).toBeGreaterThan(Date.now() + 60_000)
    })
  })
})

describe('freeze / resume', () => {
  it('freezes with no humans present, then resumes driving on a fresh heartbeat', async () => {
    await runInDurableObject(stubFor('freeze-resume'), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const now = Date.now()
      // AI seat 0, NOBODY present -> frozen.
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [0], presentSeats: [], now })
      const deps = { ctx: state, nudge: () => {} }
      driveIfAI(deps, repo, sql, now)
      expect(repo.getMovesSince(0).length).toBe(0) // frozen

      // A human checks in (heartbeat) -> resume + drive.
      repo.setPresence(1, now)
      driveIfAI(deps, repo, sql, now)
      expect(repo.getMovesSince(0).length).toBe(1) // resumed
      expect(repo.getMovesSince(0)[0]!.by_ai).toBe(true)
    })
  })
})

describe('abandon (zero humans for a long window)', () => {
  it('marks the game abandoned when the heal tick sees nobody present past the window', async () => {
    const stub = stubFor('abandon')
    const T = Date.now()
    await runInDurableObject(stub, async (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [0], presentSeats: [], now: T })
      // seat 1 was present long ago (> abandon window); nobody present now.
      repo.setPresence(1, T - (ABANDON_MS + 60_000))
      setTimer(sql, 'heal', GLOBAL_SEAT, T + HEAL_MS) // future -> fired by the harness
      await rearmAlarm(state, sql)
    })

    await runDurableObjectAlarm(stub)

    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const meta = [...sql.exec('SELECT status FROM meta WHERE id=1')][0] as any
      expect(meta.status).toBe('abandoned')
    })
  })

  it('does NOT abandon while a human is still present (re-arms the heal tick)', async () => {
    const stub = stubFor('no-abandon')
    const T = Date.now()
    await runInDurableObject(stub, async (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      seedLiveGame(sql, { playerCount: 2, aiSeats: [0], presentSeats: [1], now: T })
      setTimer(sql, 'heal', GLOBAL_SEAT, T + HEAL_MS)
      await rearmAlarm(state, sql)
    })

    await runDurableObjectAlarm(stub)

    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const meta = [...sql.exec('SELECT status FROM meta WHERE id=1')][0] as any
      expect(meta.status).toBe('active') // still active
    })
  })
})
