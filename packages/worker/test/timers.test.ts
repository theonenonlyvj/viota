import { env, runInDurableObject } from 'cloudflare:test'
import { it, expect, describe } from 'vitest'
import { runMigrations, type SqlLike } from '../src/do/storage'
import {
  setTimer,
  clearTimer,
  hasTimer,
  dueTimers,
  minFireAt,
  rearmAlarm,
  creditEvictionGap,
} from '../src/do/timers'

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

describe('durable timer-wheel', () => {
  it('arms the platform alarm to the earliest fire_at across two timers', async () => {
    await runInDurableObject(stubFor('timers-min'), async (_i, state: any) => {
      const sql = state.storage.sql as SqlLike
      runMigrations(sql)

      // FUTURE times: the runtime clamps a past alarm to "now", so use future
      // deadlines to read them back exactly. The platform alarm must equal the
      // EARLIER (t1 < t2).
      const base = Date.now() + 1_000_000
      const t2 = base + 5_000_000
      const t1 = base + 3_000_000
      setTimer(sql, 'grace', 0, t2)
      await rearmAlarm(state, sql)
      expect(await state.storage.getAlarm()).toBe(t2)

      setTimer(sql, 'turn', 1, t1)
      await rearmAlarm(state, sql)
      expect(minFireAt(sql)).toBe(t1)
      expect(await state.storage.getAlarm()).toBe(t1)
    })
  })

  it('re-arms to the later timer when the earlier one is cleared', async () => {
    await runInDurableObject(stubFor('timers-clear'), async (_i, state: any) => {
      const sql = state.storage.sql as SqlLike
      runMigrations(sql)

      const base = Date.now() + 1_000_000
      const t1 = base + 3_000_000
      const t2 = base + 5_000_000
      setTimer(sql, 'turn', 1, t1)
      setTimer(sql, 'grace', 0, t2)
      await rearmAlarm(state, sql)
      expect(await state.storage.getAlarm()).toBe(t1)

      // Clearing the earlier timer re-arms the platform alarm to the later.
      clearTimer(sql, 'turn', 1)
      await rearmAlarm(state, sql)
      expect(await state.storage.getAlarm()).toBe(t2)
    })
  })

  it('clears the platform alarm when the wheel empties', async () => {
    await runInDurableObject(stubFor('timers-empty'), async (_i, state: any) => {
      const sql = state.storage.sql as SqlLike
      runMigrations(sql)
      const t = Date.now() + 1_000_000
      setTimer(sql, 'ai_step', 0, t)
      await rearmAlarm(state, sql)
      expect(await state.storage.getAlarm()).toBe(t)

      clearTimer(sql, 'ai_step', 0)
      expect(minFireAt(sql)).toBe(null)
      await rearmAlarm(state, sql)
      expect(await state.storage.getAlarm()).toBe(null)
    })
  })

  it('upsert replaces fire_at for the same kind+seat (no duplicate rows)', async () => {
    await runInDurableObject(stubFor('timers-upsert'), async (_i, state: any) => {
      const sql = state.storage.sql as SqlLike
      runMigrations(sql)
      setTimer(sql, 'grace', 2, 1_000)
      setTimer(sql, 'grace', 2, 9_000) // same key -> replaces
      const rows = [...sql.exec('SELECT COUNT(*) AS c FROM timers')][0] as any
      expect(Number(rows.c)).toBe(1)
      expect(minFireAt(sql)).toBe(9_000)
      expect(hasTimer(sql, 'grace', 2)).toBe(true)
      expect(hasTimer(sql, 'grace', 3)).toBe(false)
    })
  })

  it('dueTimers returns only fire_at <= now, earliest first', async () => {
    await runInDurableObject(stubFor('timers-due'), async (_i, state: any) => {
      const sql = state.storage.sql as SqlLike
      runMigrations(sql)
      setTimer(sql, 'grace', 0, 100)
      setTimer(sql, 'turn', 1, 300)
      setTimer(sql, 'soft', 2, 500)

      const due = dueTimers(sql, 300)
      expect(due.map((t) => t.kind)).toEqual(['grace', 'turn']) // 500 is not yet due
      expect(due[0]!.fire_at).toBe(100)
    })
  })

  it('creditEvictionGap extends absence deadlines but not drive ticks', async () => {
    await runInDurableObject(stubFor('timers-credit'), async (_i, state: any) => {
      const sql = state.storage.sql as SqlLike
      runMigrations(sql)
      setTimer(sql, 'grace', 0, 1_000)
      setTimer(sql, 'turn', 1, 2_000)
      setTimer(sql, 'soft', 2, 3_000)
      setTimer(sql, 'ai_step', 3, 4_000) // a drive tick — must NOT be credited

      creditEvictionGap(sql, 10_000)

      const rows = Object.fromEntries(
        [...sql.exec('SELECT kind, fire_at FROM timers')].map((r: any) => [r.kind, Number(r.fire_at)]),
      )
      expect(rows.grace).toBe(11_000)
      expect(rows.turn).toBe(12_000)
      expect(rows.soft).toBe(13_000)
      expect(rows.ai_step).toBe(4_000) // unchanged
    })
  })
})
