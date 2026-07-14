import { env, runInDurableObject } from 'cloudflare:test'
import { it, expect, describe, beforeAll } from 'vitest'
import { GameRepository, type SqlLike } from '../src/do/storage'
import { applyAndPersist } from '../src/do/apply'
import { applyD1Schema } from '../src/d1/schema'
import { seedScriptedGame } from './helpers'

/**
 * Task 5 — game-end archiveTick populates result/opponent_kind/stats for each
 * human seat's `game_players` row (Phase 2 of the stats/leaderboards plan).
 * Drives the deterministic scripted game (play, wild_recycle, pass, play) for
 * real through `applyAndPersist`, the same harness `archive.test.ts` uses.
 */

const DB = () => (env as unknown as { DB: D1Database }).DB

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

beforeAll(async () => {
  await applyD1Schema(DB())
})

describe('game-end archive: result/opponent_kind/stats', () => {
  it('writes non-null result/opponent_kind + a parseable stats blob for each human seat', async () => {
    const stub = stubFor(`archive-stats-${crypto.randomUUID()}`)
    const gameUuid = `stats-${crypto.randomUUID()}`

    await runInDurableObject(stub, async (i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const { repo, game } = seedScriptedGame(sql)
      repo.putMeta({ ...repo.getMeta()!, game_uuid: gameUuid }) // unique D1 PK

      // Drive the full deterministic script for real (play, wild_recycle, pass,
      // play) so both seats accrue real moves/scores through the authoritative
      // pipeline — exactly like apply.test.ts's full-script loop.
      for (const s of game.script) {
        const res = state.storage.transactionSync(() =>
          applyAndPersist(sql, repo, {
            seatIndex: s.seatIndex,
            move: s.move,
            clientMoveId: crypto.randomUUID(),
            accountId: s.accountId,
          }),
        )
        expect('ok' in res && res.ok).toBe(true)
      }
      await i.flushOutbox(Date.now())

      // Force the game terminal (a short test — no need to play to a natural
      // stalemate/deck-exhaustion end); mirrors archive.test.ts's 3rd test.
      state.storage.transactionSync(() => {
        repo.putMeta({ ...repo.getMeta()!, status: 'completed' })
      })

      // Seed the D1 games + game_players rows the end-finalize UPDATE targets
      // (what the real create-time write-through would already have written).
      await DB().prepare('INSERT INTO games (game_uuid, status, player_count) VALUES (?, ?, ?)').bind(gameUuid, 'active', 2).run()
      await DB().batch([
        DB()
          .prepare('INSERT INTO game_players (game_uuid, seat_index, account_id, owner_type) VALUES (?, ?, ?, ?)')
          .bind(gameUuid, 0, 'acct-0', 'human'),
        DB()
          .prepare('INSERT INTO game_players (game_uuid, seat_index, account_id, owner_type) VALUES (?, ?, ?, ?)')
          .bind(gameUuid, 1, 'acct-1', 'human'),
      ])

      await i.archiveTick(Date.now())
    })

    const rows = (
      await DB()
        .prepare('SELECT seat_index, result, opponent_kind, stats, final_score FROM game_players WHERE game_uuid = ? ORDER BY seat_index')
        .bind(gameUuid)
        .all<{ seat_index: number; result: string | null; opponent_kind: string | null; stats: string | null; final_score: number }>()
    ).results
    expect(rows.length).toBe(2)

    let winners = 0
    for (const row of rows) {
      expect(row.result).not.toBeNull()
      expect(['win', 'loss', 'draw']).toContain(row.result)
      if (row.result === 'win') winners++
      // Both seats are human-owned in this fixture, so each has a human opponent.
      expect(row.opponent_kind).toBe('human')

      expect(row.stats).not.toBeNull()
      const stats = JSON.parse(row.stats!)
      expect(typeof stats.points).toBe('number')
      expect(typeof stats.bestPlay).toBe('number')
      expect(stats.points).toBe(row.final_score) // points echoes the archived final_score
    }
    // winnerSeatOf always resolves to exactly one seat (never null) once status
    // is 'completed' — this holds regardless of the actual scripted scores.
    expect(winners).toBe(1)

    // Seat 0's script is exactly 2 'play' moves (steps A and D) -> plays:2.
    const seat0 = JSON.parse(rows.find((r) => r.seat_index === 0)!.stats!)
    expect(seat0.plays).toBe(2)
    // Seat 1's script is exactly 1 wild_recycle (step B) + 1 pass (step C).
    const seat1 = JSON.parse(rows.find((r) => r.seat_index === 1)!.stats!)
    expect(seat1.wildsRecycled).toBe(1)
    expect(seat1.passes).toBe(1)
  })
})
