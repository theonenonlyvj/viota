import { env, runInDurableObject } from 'cloudflare:test'
import { it, expect } from 'vitest'
import { runMigrations, GameRepository } from '../src/do/storage'
import { createWaitingRoom, dealInto } from '../src/do/init'

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

it('meta.status CHECK accepts waiting (migration widened it) + stores code', async () => {
  await runInDurableObject(stubFor('wr-status'), (_i, state: any) => {
    const sql = state.storage.sql
    runMigrations(sql)
    const repo = new GameRepository(sql)
    repo.putMeta({
      move_index: 0, status: 'waiting', current_seat: 0, player_count: 2,
      engine_version: 'e', game_uuid: 'g', code: 'CODE12',
    })
    const meta = repo.getMeta()!
    expect(meta.status).toBe('waiting')
    expect(meta.code).toBe('CODE12')
  })
})

it('createWaitingRoom writes a waiting meta + host seat + open seats, no deal', async () => {
  await runInDurableObject(stubFor('wr-create'), (_i, state: any) => {
    const sql = state.storage.sql
    runMigrations(sql)
    const repo = new GameRepository(sql)

    const { meta } = createWaitingRoom(repo, {
      playerCount: 3,
      hostAccountId: 'acct-host',
      hostDisplayName: 'Host',
      gameUuid: 'room-1',
      engineVersion: 'viota-engine@test',
      code: 'ABC123',
    })

    expect(meta.status).toBe('waiting')
    expect(meta.player_count).toBe(3)
    expect(meta.current_seat).toBe(0)
    expect(meta.move_index).toBe(0)
    expect(meta.game_uuid).toBe('room-1')
    expect(meta.code).toBe('ABC123')

    // No deal yet — the deal happens at /start.
    expect(repo.getInitialState()).toBeNull()
    expect(repo.getSnapshot()).toBeNull()

    const seats = repo.getSeats()
    expect(seats.length).toBe(3)
    expect(seats[0]).toMatchObject({
      seat_index: 0, owner_type: 'human', owner_account_id: 'acct-host',
      display_name: 'Host', controlled_by_ai: false,
    })
    expect(seats[1]).toMatchObject({ seat_index: 1, owner_type: 'open', owner_account_id: null })
    expect(seats[2]).toMatchObject({ seat_index: 2, owner_type: 'open', owner_account_id: null })
  })
})

it('createWaitingRoom is idempotent (a re-create returns the existing meta)', async () => {
  await runInDurableObject(stubFor('wr-idem'), (_i, state: any) => {
    const sql = state.storage.sql
    runMigrations(sql)
    const repo = new GameRepository(sql)
    createWaitingRoom(repo, { playerCount: 2, hostAccountId: 'h', hostDisplayName: 'H', gameUuid: 'g1', engineVersion: 'e', code: 'AAA111' })
    const again = createWaitingRoom(repo, { playerCount: 2, hostAccountId: 'h', hostDisplayName: 'H', gameUuid: 'g2-ignored', engineVersion: 'e', code: 'BBB222' })
    expect(again.meta.game_uuid).toBe('g1')
    expect(again.meta.code).toBe('AAA111')
  })
})

it('dealInto deals into an existing waiting room without clobbering seat owners', async () => {
  await runInDurableObject(stubFor('wr-deal'), (_i, state: any) => {
    const sql = state.storage.sql
    runMigrations(sql)
    const repo = new GameRepository(sql)
    createWaitingRoom(repo, { playerCount: 2, hostAccountId: 'acct-host', hostDisplayName: 'Host', gameUuid: 'room-2', engineVersion: 'e', code: 'CODE55' })
    // A joiner has claimed seat 1.
    const s1 = repo.getSeats()[1]!
    repo.putSeat({ ...s1, owner_type: 'human', owner_account_id: 'acct-join', display_name: 'Joiner' })

    const { initialState, meta } = dealInto(repo, 2)
    expect(meta.status).toBe('active')
    expect(meta.current_seat).toBe(initialState.turnIndex)
    expect(meta.game_uuid).toBe('room-2') // preserved from the waiting meta
    expect(meta.move_index).toBe(0)
    expect(repo.getInitialState()).not.toBeNull()
    expect(repo.getSnapshot()).not.toBeNull()

    // Seat owners are NOT clobbered by the deal.
    const seats = repo.getSeats()
    expect(seats[0]).toMatchObject({ owner_account_id: 'acct-host', owner_type: 'human' })
    expect(seats[1]).toMatchObject({ owner_account_id: 'acct-join', owner_type: 'human' })
    // Hands were dealt (2 players -> 4 cards each).
    expect(initialState.hands[0]!.length).toBe(4)
    expect(initialState.hands[1]!.length).toBe(4)
  })
})
