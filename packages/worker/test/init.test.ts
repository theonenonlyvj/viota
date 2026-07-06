import { env, runInDurableObject } from 'cloudflare:test'
import { it, expect } from 'vitest'
import { runMigrations, GameRepository } from '../src/do/storage'
import { serializeState } from '../src/do/state-codec'
import { initGameForOnline, type SeatOwner } from '../src/do/init'

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

const seatOwners: SeatOwner[] = [
  { ownerType: 'human', accountId: 'acct-A', displayName: 'Alice' },
  { ownerType: 'ai', displayName: 'Bot', aiDifficulty: 'medium', controlledByAi: true },
]

it('persists the post-deal state, meta, and seats', async () => {
  await runInDurableObject(stubFor('init-persist'), (_i, state: any) => {
    const sql = state.storage.sql
    runMigrations(sql)
    const repo = new GameRepository(sql)

    const { initialState, meta } = initGameForOnline(repo, 2, seatOwners, {
      engineVersion: 'viota-engine@test', gameUuid: 'game-1',
    })

    // initial_state persisted and equal to what was returned
    const stored = repo.getInitialState()
    expect(stored).not.toBeNull()
    expect(serializeState(stored!)).toBe(serializeState(initialState))

    // snapshot starts as the initial state (starting board is reconstructable)
    expect(serializeState(repo.getSnapshot()!)).toBe(serializeState(initialState))

    // meta
    expect(meta.player_count).toBe(2)
    expect(meta.status).toBe('active')
    expect(meta.current_seat).toBe(initialState.turnIndex)
    expect(meta.move_index).toBe(0)
    expect(meta.game_uuid).toBe('game-1')
    expect(repo.getMeta()).toMatchObject({ player_count: 2, game_uuid: 'game-1', engine_version: 'viota-engine@test' })

    // seats: GameState index == seat_index
    const seats = repo.getSeats()
    expect(seats.length).toBe(2)
    expect(seats[0]).toMatchObject({ seat_index: 0, owner_type: 'human', owner_account_id: 'acct-A', display_name: 'Alice', controlled_by_ai: false })
    expect(seats[1]).toMatchObject({ seat_index: 1, owner_type: 'ai', display_name: 'Bot', ai_difficulty: 'medium', controlled_by_ai: true })
  })
})

it('initial_state is immutable across a second init call (write-once)', async () => {
  await runInDurableObject(stubFor('init-immutable'), (_i, state: any) => {
    const sql = state.storage.sql
    runMigrations(sql)
    const repo = new GameRepository(sql)

    const first = initGameForOnline(repo, 2, seatOwners, { engineVersion: 'e', gameUuid: 'g1' })
    const firstJson = serializeState(first.initialState)

    // A second call must NOT re-deal or overwrite the immutable state.
    const second = initGameForOnline(repo, 2, seatOwners, { engineVersion: 'e', gameUuid: 'g2-ignored' })
    expect(serializeState(second.initialState)).toBe(firstJson)
    expect(serializeState(repo.getInitialState()!)).toBe(firstJson)
    // meta from the first init is preserved (idempotent no-op)
    expect(repo.getMeta()?.game_uuid).toBe('g1')
  })
})

it('replaying the initial_state (zero moves) reconstructs the same board', async () => {
  await runInDurableObject(stubFor('init-replay'), (_i, state: any) => {
    const sql = state.storage.sql
    runMigrations(sql)
    const repo = new GameRepository(sql)

    const { initialState } = initGameForOnline(repo, 3, [
      { ownerType: 'human', accountId: 'a0' },
      { ownerType: 'human', accountId: 'a1' },
      { ownerType: 'ai', controlledByAi: true },
    ], { engineVersion: 'e', gameUuid: 'g' })

    // Rehydrate purely from storage and confirm byte-exact board + pile.
    const rehydrated = repo.getInitialState()!
    expect(JSON.stringify(rehydrated.drawPile)).toBe(JSON.stringify(initialState.drawPile))
    expect(rehydrated.grid.size).toBe(initialState.grid.size)
    for (const [k, v] of initialState.grid.entries()) {
      expect(rehydrated.grid.get(k)).toEqual(v)
    }
    // Every seat's dealt hand is captured (hidden-hand reconstruction).
    expect(rehydrated.hands).toEqual(initialState.hands)
  })
})
