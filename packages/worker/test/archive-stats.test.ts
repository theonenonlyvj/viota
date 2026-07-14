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
        .prepare(
          'SELECT seat_index, result, opponent_kind, stats, final_score, total_moves, ai_move_count FROM game_players WHERE game_uuid = ? ORDER BY seat_index',
        )
        .bind(gameUuid)
        .all<{
          seat_index: number
          result: string | null
          opponent_kind: string | null
          stats: string | null
          final_score: number
          total_moves: number | null
          ai_move_count: number | null
        }>()
    ).results
    expect(rows.length).toBe(2)

    // winnerSeatOf resolves to exactly one seat here (never null) because this
    // fixture's scripted scores are NOT tied — a genuine tie is covered
    // separately below (must archive as a draw for every seat, not a winner).
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

      // P1 columns (must-fix #3): populated at game-end from the seat's own
      // moves, not left at their schema default of 0 — the v_leaderboard
      // AI-takeover guard (`total_moves = 0 OR ai_move_count*2 <= total_moves`)
      // is a no-op unless these are actually written.
      expect(row.total_moves).not.toBeNull()
      expect(row.ai_move_count).not.toBeNull()
      expect(row.ai_move_count).toBe(0) // no AI takeover in this fixture — 0 is correct, not a default-value artifact
    }
    expect(winners).toBe(1)

    // Seat 0's script is exactly 2 'play' moves (steps A and D) -> plays:2 and
    // total_moves:2 (no AI in this fixture, so every move is the seat's own).
    const seat0 = JSON.parse(rows.find((r) => r.seat_index === 0)!.stats!)
    expect(seat0.plays).toBe(2)
    expect(rows.find((r) => r.seat_index === 0)!.total_moves).toBe(2)
    // Seat 1's script is exactly 1 wild_recycle (step B) + 1 pass (step C) -> total_moves:2.
    const seat1 = JSON.parse(rows.find((r) => r.seat_index === 1)!.stats!)
    expect(seat1.wildsRecycled).toBe(1)
    expect(seat1.passes).toBe(1)
    expect(rows.find((r) => r.seat_index === 1)!.total_moves).toBe(2)
  })

  it('a TIE game archives EVERY human seat as a draw — never a lowest-seat win/loss (must-fix #1)', async () => {
    const stub = stubFor(`archive-stats-tie-${crypto.randomUUID()}`)
    const gameUuid = `stats-tie-${crypto.randomUUID()}`

    await runInDurableObject(stub, async (i: any, state: any) => {
      const sql = state.storage.sql as SqlLike
      const { repo, game } = seedScriptedGame(sql)
      repo.putMeta({ ...repo.getMeta()!, game_uuid: gameUuid }) // unique D1 PK

      // Drive the full deterministic script for real, exactly like the sibling
      // test above, so both seats accrue real moves through the authoritative
      // pipeline — then force the FINAL scores to a tie (the script's natural
      // scores are not tied, so this is the only way to exercise the tie path
      // end-to-end without a second bespoke script).
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

      state.storage.transactionSync(() => {
        repo.putMeta({ ...repo.getMeta()!, status: 'completed' })
        repo.putSnapshot({ ...repo.getSnapshot()!, scores: [15, 15] }) // TIE
      })

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
        .prepare('SELECT seat_index, result FROM game_players WHERE game_uuid = ? ORDER BY seat_index')
        .bind(gameUuid)
        .all<{ seat_index: number; result: string | null }>()
    ).results
    expect(rows.length).toBe(2)
    for (const row of rows) {
      expect(row.result).toBe('draw') // NEVER 'win'/'loss' on a tie
    }

    const g = await DB()
      .prepare('SELECT winner_seat FROM games WHERE game_uuid = ?')
      .bind(gameUuid)
      .first<{ winner_seat: number | null }>()
    expect(g!.winner_seat).toBeNull()
  })
})
