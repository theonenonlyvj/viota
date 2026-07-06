import { SELF, env, runInDurableObject } from 'cloudflare:test'
import { it, expect, describe, beforeAll } from 'vitest'
import { applyD1Schema } from '../src/d1/schema'
import { flushGameCreate, flushGameEnd, resolveActiveGameByCode, type GameArchiveRow } from '../src/do/archive'

const DB = () => (env as unknown as { DB: D1Database }).DB

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

beforeAll(async () => {
  await applyD1Schema(DB())
})

describe('lobby registry (games.code + status/last_activity)', () => {
  it('resolveActiveGameByCode returns a live game and drops it once terminal', async () => {
    const code = `C${crypto.randomUUID().slice(0, 6)}`
    const gameUuid = `lobby-${crypto.randomUUID()}`
    const game: GameArchiveRow = {
      gameUuid, mode: 'online', status: 'active', playerCount: 2,
      source: 'online_authoritative', engineVersion: 'e', createdAt: 1000, lastActivityAt: 1000, code,
    }
    await flushGameCreate(DB(), game, [])

    expect(await resolveActiveGameByCode(DB(), code)).toBe(gameUuid) // resolvable while active

    await flushGameEnd(DB(), gameUuid, {
      status: 'completed', outcome: 'completed', winnerSeat: 0, endedAt: 2000, lastActivityAt: 2000, finalScores: [5, 1],
    })
    expect(await resolveActiveGameByCode(DB(), code)).toBeNull() // no longer joinable
  })

  it('POST /games writes the registry row (code + active status + last_activity)', async () => {
    const res = await SELF.fetch('https://example.com/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        playerCount: 2,
        seatOwners: [
          { ownerType: 'human', accountId: 'a0', displayName: 'P0' },
          { ownerType: 'human', accountId: 'a1', displayName: 'P1' },
        ],
      }),
    })
    const { gameId, code } = (await res.json()) as { gameId: string; code: string }
    expect(typeof code).toBe('string')
    expect(code.length).toBe(6)

    // Force the create-archive deterministically (idempotent) rather than racing
    // the fire-and-forget waitUntil, then assert the registry row + resolution.
    await runInDurableObject(stubFor(gameId), (i: any) => i.archiveGameCreate(Date.now(), code))

    const row = await DB()
      .prepare('SELECT status, code, last_activity_at, source, player_count FROM games WHERE game_uuid = ?')
      .bind(gameId)
      .first<any>()
    expect(row.status).toBe('active')
    expect(row.code).toBe(code)
    expect(row.source).toBe('online_authoritative') // forced server-side
    expect(Number(row.player_count)).toBe(2)
    expect(typeof row.last_activity_at).toBe('number')
    expect(await resolveActiveGameByCode(DB(), code)).toBe(gameId)
  })
})
