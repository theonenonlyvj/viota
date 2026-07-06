import { env, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test'
import { it, expect, describe } from 'vitest'
import type { SqlLike } from '../src/do/storage'
import { markDisconnected, armDisconnectCoverIfAbsent } from '../src/do/presence'
import { hasTimer, minFireAt, rearmAlarm, setTimer } from '../src/do/timers'
import { AWAY_TURN_MS } from '../src/do/constants'
import { seedLiveGame } from './helpers'

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

const NOW = 5_000_000

describe('configurable AI-takeover (meta.ai_takeover_ms)', () => {
  it('arms the on-turn cover timer at now + ai_takeover_ms (the host-chosen patience)', async () => {
    await runInDurableObject(stubFor('takeover-armed'), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [1], now: NOW })
      repo.putMeta({ ...repo.getMeta()!, ai_takeover_ms: 120_000 }) // host picked 2 min
      // current_seat is 0; disconnect the on-turn seat 0.
      markDisconnected(repo, sql, 0, NOW)
      expect(hasTimer(sql, 'turn', 0)).toBe(true)
      expect(minFireAt(sql)).toBe(NOW + 120_000) // patience honored, not the 27s default
    })
  })

  it('falls back to the fixed AWAY_TURN_MS when ai_takeover_ms is unset (null)', async () => {
    await runInDurableObject(stubFor('takeover-default'), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [1], now: NOW })
      expect(repo.getMeta()!.ai_takeover_ms).toBeNull() // seedLiveGame leaves it null
      markDisconnected(repo, sql, 0, NOW)
      expect(minFireAt(sql)).toBe(NOW + AWAY_TURN_MS)
    })
  })

  it('ai_takeover_ms=0 ("wait for me"): a disconnected on-turn seat arms NO cover timer', async () => {
    await runInDurableObject(stubFor('takeover-wait'), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [1], now: NOW })
      repo.putMeta({ ...repo.getMeta()!, ai_takeover_ms: 0 })
      markDisconnected(repo, sql, 0, NOW) // on turn
      expect(hasTimer(sql, 'turn', 0)).toBe(false)
      expect(hasTimer(sql, 'grace', 0)).toBe(false)
      // the seat is still marked disconnected, but the wheel has no cover timer.
      expect(repo.getSeats()[0]!.disconnected_at).toBe(NOW)
    })
  })

  it('ai_takeover_ms=0 ("wait for me"): a disconnected OFF-turn seat arms NO cover timer either', async () => {
    await runInDurableObject(stubFor('takeover-wait-off'), (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [0], now: NOW })
      repo.putMeta({ ...repo.getMeta()!, ai_takeover_ms: 0 })
      markDisconnected(repo, sql, 1, NOW) // off turn (current is 0)
      expect(hasTimer(sql, 'grace', 1)).toBe(false)
      expect(hasTimer(sql, 'turn', 1)).toBe(false)
    })
  })

  describe('auto-arm on a SILENT disconnect (no markDisconnected / no /leave)', () => {
    it('arms a cover deadline for an absent on-turn human at last_seen + ai_takeover_ms', async () => {
      await runInDurableObject(stubFor('auto-arm-absent'), (_i: any, state: any) => {
        const sql = state.storage.sql as SqlLike
        // seat 1 present; seat 0 on turn but never heartbeated (silently gone).
        const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [1], now: NOW })
        repo.putMeta({ ...repo.getMeta()!, ai_takeover_ms: 60_000 })
        expect(hasTimer(sql, 'turn', 0)).toBe(false) // nobody armed it
        armDisconnectCoverIfAbsent(repo, sql, NOW)
        expect(hasTimer(sql, 'turn', 0)).toBe(true)
        expect(minFireAt(sql)).toBe(NOW + 60_000) // host patience honored
      })
    })

    it('never arms for a PRESENT (connected) on-turn seat', async () => {
      await runInDurableObject(stubFor('auto-arm-present'), (_i: any, state: any) => {
        const sql = state.storage.sql as SqlLike
        const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [0], now: NOW })
        repo.putMeta({ ...repo.getMeta()!, ai_takeover_ms: 60_000 })
        armDisconnectCoverIfAbsent(repo, sql, NOW)
        expect(hasTimer(sql, 'turn', 0)).toBe(false) // connected → never auto-covered
      })
    })

    it('arms NOTHING for a "wait for me" game (ai_takeover_ms = 0)', async () => {
      await runInDurableObject(stubFor('auto-arm-wait'), (_i: any, state: any) => {
        const sql = state.storage.sql as SqlLike
        const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [1], now: NOW })
        repo.putMeta({ ...repo.getMeta()!, ai_takeover_ms: 0 })
        armDisconnectCoverIfAbsent(repo, sql, NOW)
        expect(hasTimer(sql, 'turn', 0)).toBe(false)
      })
    })

    it('is idempotent: repeated calls do not push the deadline out', async () => {
      await runInDurableObject(stubFor('auto-arm-idem'), (_i: any, state: any) => {
        const sql = state.storage.sql as SqlLike
        const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [1], now: NOW })
        repo.putMeta({ ...repo.getMeta()!, ai_takeover_ms: 30_000 })
        armDisconnectCoverIfAbsent(repo, sql, NOW)
        const first = minFireAt(sql)
        armDisconnectCoverIfAbsent(repo, sql, NOW + 10_000) // a later tick
        expect(minFireAt(sql)).toBe(first) // unchanged — not re-armed
      })
    })

    it('END-TO-END: the heal self-tick arms cover for a silently dropped on-turn human (no markDisconnected)', async () => {
      const stub = stubFor('silent-drop-heal-e2e')
      const T = Date.now()
      await runInDurableObject(stub, async (_i: any, state: any) => {
        const sql = state.storage.sql as SqlLike
        const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [1], now: T })
        repo.putMeta({ ...repo.getMeta()!, ai_takeover_ms: 30_000 })
        // seat 0 on turn, absent; NOBODY calls markDisconnected or /leave.
        expect(hasTimer(sql, 'turn', 0)).toBe(false)
        setTimer(sql, 'heal', -1, T) // heal due now
        await rearmAlarm(state, sql)
      })
      await runDurableObjectAlarm(stub)
      await runInDurableObject(stub, (_i: any, state: any) => {
        const sql = state.storage.sql as SqlLike
        // the heal tick detected the absent on-turn human and armed its cover.
        expect(hasTimer(sql, 'turn', 0)).toBe(true)
      })
    })
  })

  it('END-TO-END: a DISCONNECTED on-turn seat IS covered after ai_takeover_ms elapses (alarm fires)', async () => {
    const stub = stubFor('takeover-cover-e2e')
    const T = Date.now()
    await runInDurableObject(stub, async (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      // seat 1 is a present watcher (so the loop drives after cover); seat 0 is on
      // turn and absent (never heartbeated).
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [1], now: T })
      repo.putMeta({ ...repo.getMeta()!, ai_takeover_ms: 30_000 })
      markDisconnected(repo, sql, 0, T) // arms a turn cover at T + 30s for the absent on-turn seat
      await rearmAlarm(state, sql)
    })

    await runDurableObjectAlarm(stub)

    await runInDurableObject(stub, (_i: any, state: any) => {
      const seat0 = [...state.storage.sql.exec('SELECT controlled_by_ai FROM seats WHERE seat_index=0')][0] as any
      expect(Number(seat0.controlled_by_ai)).toBe(1) // absent seat covered by AI
    })
  })

  it('END-TO-END: ai_takeover_ms=0 → a disconnected on-turn seat is NEVER auto-covered (the game waits)', async () => {
    const stub = stubFor('takeover-wait-e2e')
    const T = Date.now()
    await runInDurableObject(stub, async (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const { repo } = seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [1], now: T })
      repo.putMeta({ ...repo.getMeta()!, ai_takeover_ms: 0 })
      markDisconnected(repo, sql, 0, T) // no cover timer armed
      // Even a *manually* left-over turn timer must not cover a wait-for-me seat…
      // (there is none here); arm the heal tick so the alarm has something to fire.
      setTimer(sql, 'heal', -1, T)
      await rearmAlarm(state, sql)
    })

    await runDurableObjectAlarm(stub)

    await runInDurableObject(stub, (_i: any, state: any) => {
      const seat0 = [...state.storage.sql.exec('SELECT controlled_by_ai FROM seats WHERE seat_index=0')][0] as any
      expect(Number(seat0.controlled_by_ai)).toBe(0) // still the human's — the game just waits
    })
  })

  it('a CONNECTED seat idle far past the old SOFT_TURN_MS is NOT covered (soft auto-cover retired)', async () => {
    const stub = stubFor('soft-retired-e2e')
    const T = Date.now()
    await runInDurableObject(stub, async (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      // seat 0 is present (connected) and on turn; simulate a leftover legacy soft
      // timer that WAS due — the alarm must clear it and NEVER cover the seat.
      seedLiveGame(sql, { playerCount: 2, aiSeats: [], presentSeats: [0], now: T })
      setTimer(sql, 'soft', 0, T) // due
      await rearmAlarm(state, sql)
    })

    await runDurableObjectAlarm(stub)

    await runInDurableObject(stub, (_i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const seat0 = [...sql.exec('SELECT controlled_by_ai FROM seats WHERE seat_index=0')][0] as any
      expect(Number(seat0.controlled_by_ai)).toBe(0) // connected seat never auto-covered
      expect(hasTimer(sql, 'soft', 0)).toBe(false) // the legacy timer was cleared, not fired
    })
  })
})
