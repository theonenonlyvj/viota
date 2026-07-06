import { env, runInDurableObject } from 'cloudflare:test'
import { it, expect, describe } from 'vitest'
import { runMigrations, GameRepository, type SeatRow } from '../src/do/storage'
import { createWaitingRoom } from '../src/do/init'
import { promoteHost } from '../src/do/presence'

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

const NOW = 5_000_000

/** A joined human seat (defaults to NOT present — lobby seats never heartbeat). */
function humanSeat(seat_index: number, over: Partial<SeatRow> = {}): SeatRow {
  return {
    seat_index,
    owner_account_id: `acct-${seat_index}`,
    ghost_id: null,
    owner_type: 'human',
    display_name: `P${seat_index}`,
    ai_difficulty: null,
    controlled_by_ai: false,
    disconnected_at: null,
    last_seen_at: null,
    final_score: null,
    ...over,
  }
}

function seedRoom(sql: any): GameRepository {
  runMigrations(sql)
  const repo = new GameRepository(sql)
  createWaitingRoom(repo, {
    playerCount: 3, hostAccountId: 'acct-0', hostDisplayName: 'Host',
    gameUuid: 'g', engineVersion: 'e', code: 'AAA111',
  })
  return repo
}

describe('promoteHost (waiting-room host handoff)', () => {
  it('promotes to another human even when NO seat is present (lobby seats never heartbeat)', async () => {
    await runInDurableObject(stubFor('promote-no-presence'), (_i, state: any) => {
      const repo = seedRoom(state.storage.sql)
      repo.putSeat(humanSeat(1)) // joined, never heartbeated (last_seen null)
      // seat 2 stays 'open'

      const newHost = promoteHost(repo, 0, NOW)
      expect(newHost).toBe(1) // the lowest-index other human — NOT null
      expect(repo.getMeta()!.host_seat).toBe(1)
    })
  })

  it('prefers a PRESENT human successor when one exists', async () => {
    await runInDurableObject(stubFor('promote-prefer-present'), (_i, state: any) => {
      const repo = seedRoom(state.storage.sql)
      repo.putSeat(humanSeat(1)) // absent human
      repo.putSeat(humanSeat(2, { last_seen_at: NOW })) // present human

      const newHost = promoteHost(repo, 0, NOW)
      expect(newHost).toBe(2) // present one preferred over the lower-index absent one
    })
  })

  it('returns null when the departing seat is not the host', async () => {
    await runInDurableObject(stubFor('promote-not-host'), (_i, state: any) => {
      const repo = seedRoom(state.storage.sql)
      repo.putSeat(humanSeat(1))
      expect(promoteHost(repo, 1, NOW)).toBeNull() // host is seat 0, not the departing seat 1
      expect(repo.getMeta()!.host_seat).toBe(0)
    })
  })

  it('returns null when there is no other human to promote (all remaining seats open)', async () => {
    await runInDurableObject(stubFor('promote-no-human'), (_i, state: any) => {
      const repo = seedRoom(state.storage.sql) // seats 1,2 are 'open'
      expect(promoteHost(repo, 0, NOW)).toBeNull()
      expect(repo.getMeta()!.host_seat).toBe(0)
    })
  })
})
