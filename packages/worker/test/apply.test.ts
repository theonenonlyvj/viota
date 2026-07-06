import { env, runInDurableObject } from 'cloudflare:test'
import { it, expect, describe } from 'vitest'
import { GameRepository } from '../src/do/storage'
import { serializeState } from '../src/do/state-codec'
import { replay } from '../src/do/replay'
import { applyAndPersist, type ApplyParams } from '../src/do/apply'
import { seedScriptedGame, buildScriptedGame } from './helpers'

function stubFor(name: string) {
  return env.GAME_DO.get(env.GAME_DO.idFromName(name))
}

/** Run applyAndPersist in the synchronous txn span, exactly as the DO does. */
function makeApply(state: any, repo: GameRepository) {
  const sql = state.storage.sql
  return (p: ApplyParams) => state.storage.transactionSync(() => applyAndPersist(sql, repo, p))
}

const step = (game: ReturnType<typeof buildScriptedGame>, i: number, over: Partial<ApplyParams> = {}): ApplyParams => ({
  seatIndex: game.script[i]!.seatIndex,
  move: game.script[i]!.move,
  clientMoveId: `cm-${i}`,
  accountId: game.script[i]!.accountId,
  now: 1000 + i,
  ...over,
})

describe('applyAndPersist', () => {
  it('applies exactly once with a server-derived move_index and correct turn_number', async () => {
    await runInDurableObject(stubFor('apply-exactly-once'), (_i, state: any) => {
      const { repo, game } = seedScriptedGame(state.storage.sql)
      const apply = makeApply(state, repo)

      const a = apply(step(game, 0))
      expect(a).toMatchObject({ ok: true, moveIndex: 1 })

      const b = apply(step(game, 1)) // wild_recycle
      expect(b).toMatchObject({ ok: true, moveIndex: 2 })
      // recycle does NOT advance the turn: still seat 1's turn.
      expect(repo.getMeta()!.current_seat).toBe(1)

      const c = apply(step(game, 2)) // pass
      expect(c).toMatchObject({ ok: true, moveIndex: 3 })
      expect(repo.getMeta()!.current_seat).toBe(0)

      const d = apply(step(game, 3)) // play
      expect(d).toMatchObject({ ok: true, moveIndex: 4 })

      const rows = repo.getMovesSince(0)
      expect(rows.map((r) => r.move_index)).toEqual([1, 2, 3, 4])
      // recycle (move 2) shares turn 2 with the pass (move 3) it precedes.
      expect(rows.map((r) => r.turn_number)).toEqual([1, 2, 2, 3])
      expect(rows.map((r) => r.type)).toEqual(['play', 'wild_recycle', 'pass', 'play'])
      // controlling_account_id attributes each move to the seat's owner.
      expect(rows.map((r) => r.controlling_account_id)).toEqual(['acct-0', 'acct-1', 'acct-1', 'acct-0'])
      expect(rows.every((r) => r.by_ai === false)).toBe(true)
      expect(repo.getMeta()!.move_index).toBe(4)
    })
  })

  it('records score_delta/score_after from the engine (0 for pass/recycle, >0 for a lot play)', async () => {
    await runInDurableObject(stubFor('apply-score'), (_i, state: any) => {
      const { repo, game } = seedScriptedGame(state.storage.sql)
      const apply = makeApply(state, repo)
      apply(step(game, 0))
      apply(step(game, 1))
      apply(step(game, 2))
      apply(step(game, 3))

      const rows = repo.getMovesSince(0)
      const recycle = rows.find((r) => r.type === 'wild_recycle')!
      const pass = rows.find((r) => r.type === 'pass')!
      const lastPlay = rows[3]!
      expect(recycle.score_delta).toBe(0)
      expect(pass.score_delta).toBe(0)
      expect(lastPlay.score_delta).toBeGreaterThan(0) // 4-card lot
      expect(lastPlay.score_after).toBe(repo.getSnapshot()!.scores[0])
    })
  })

  it('is idempotent: a duplicate clientMoveId is a benign ack, not a re-apply', async () => {
    await runInDurableObject(stubFor('apply-idempotent'), (_i, state: any) => {
      const { repo, game } = seedScriptedGame(state.storage.sql)
      const apply = makeApply(state, repo)

      const first = apply(step(game, 0, { clientMoveId: 'dup' }))
      expect(first).toMatchObject({ ok: true, moveIndex: 1 })

      // Re-submit the SAME clientMoveId. It is now seat 1's turn, but the
      // idempotency check fires BEFORE the turn check -> a benign duplicate ack,
      // NOT a false "not your turn". Exactly one row remains.
      const second = apply(step(game, 0, { clientMoveId: 'dup' }))
      expect('duplicate' in second && second.duplicate).toBe(true)
      if ('duplicate' in second) expect(second.view.mySeat).toBe(0)

      expect(repo.getMovesSince(0).length).toBe(1)
      expect(repo.getMeta()!.move_index).toBe(1)
    })
  })

  it('rejects a move whose accountId does not own the seat (authz), writing nothing', async () => {
    await runInDurableObject(stubFor('apply-authz'), (_i, state: any) => {
      const { repo, game } = seedScriptedGame(state.storage.sql)
      const apply = makeApply(state, repo)

      const r = apply(step(game, 0, { accountId: 'acct-wrong' }))
      expect(r).toEqual({ error: 'not_your_seat' })
      expect(repo.getMovesSince(0).length).toBe(0)
      expect(repo.getMeta()!.move_index).toBe(0)
    })
  })

  it('does NOT leak another seat\'s hand via a duplicate clientMoveId for a seat you do not own (authz precedes idempotency)', async () => {
    await runInDurableObject(stubFor('apply-leak-guard'), (_i, state: any) => {
      const { repo, game } = seedScriptedGame(state.storage.sql)
      const apply = makeApply(state, repo)

      // acct-0 legitimately plays seat 0 with a clientMoveId it therefore knows.
      const first = apply(step(game, 0, { clientMoveId: 'known-by-acct-0' }))
      expect(first).toMatchObject({ ok: true, moveIndex: 1 })

      // acct-0 replays its OWN clientMoveId but names seat 1 (owned by acct-1),
      // trying to get the duplicate branch to hand back seat 1's hand. Ownership
      // is checked BEFORE idempotency, so it is rejected as not_your_seat and no
      // per-seat view is ever built — the opponent's hand cannot leak.
      const attack = apply({
        seatIndex: 1,
        move: { type: 'pass', trades: [], tradeOrder: [] },
        clientMoveId: 'known-by-acct-0',
        accountId: 'acct-0',
        now: 2000,
      })
      expect(attack).toEqual({ error: 'not_your_seat' })
      expect('view' in attack).toBe(false)
    })
  })

  it('allows a server-minted AI move to bypass the account-ownership check', async () => {
    await runInDurableObject(stubFor('apply-ai-bypass'), (_i, state: any) => {
      const { repo, game } = seedScriptedGame(state.storage.sql)
      const apply = makeApply(state, repo)

      const r = apply(step(game, 0, { accountId: null, byAi: true, clientMoveId: 'ai:0:1', aiDifficulty: 'medium' }))
      expect(r).toMatchObject({ ok: true, moveIndex: 1 })
      const row = repo.getMovesSince(0)[0]!
      expect(row.by_ai).toBe(true)
      expect(row.ai_difficulty).toBe('medium')
      // still attributes the move to the seat's human owner
      expect(row.controlling_account_id).toBe('acct-0')
    })
  })

  it('rejects an out-of-turn play/pass with not_your_turn (turn check before the engine)', async () => {
    await runInDurableObject(stubFor('apply-not-your-turn'), (_i, state: any) => {
      const { repo } = seedScriptedGame(state.storage.sql)
      const apply = makeApply(state, repo)

      // seat 1 tries to play while it is seat 0's turn.
      const r = apply({
        seatIndex: 1,
        move: { type: 'play', placements: [{ card: { kind: 'regular', color: 'green', shape: 'circle', number: 1 }, position: { x: 9, y: 9 } }] },
        clientMoveId: 'off-turn',
        accountId: 'acct-1',
      })
      expect(r).toEqual({ error: 'not_your_turn' })
      expect(repo.getMovesSince(0).length).toBe(0)
    })
  })

  it('rejects any move once the game is no longer active (game_over)', async () => {
    await runInDurableObject(stubFor('apply-game-over'), (_i, state: any) => {
      const { repo, game } = seedScriptedGame(state.storage.sql)
      const apply = makeApply(state, repo)
      repo.putMeta({ ...repo.getMeta()!, status: 'completed' })

      const r = apply(step(game, 0))
      expect(r).toEqual({ error: 'game_over' })
      expect(repo.getMovesSince(0).length).toBe(0)
    })
  })

  it('surfaces the engine error string for an illegal (but shape-valid) move', async () => {
    await runInDurableObject(stubFor('apply-illegal'), (_i, state: any) => {
      const { repo } = seedScriptedGame(state.storage.sql)
      const apply = makeApply(state, repo)

      // seat 0 on turn, but plays onto the occupied starter cell (0,0).
      const r = apply({
        seatIndex: 0,
        move: { type: 'play', placements: [{ card: { kind: 'regular', color: 'red', shape: 'triangle', number: 2 }, position: { x: 0, y: 0 } }] },
        clientMoveId: 'illegal',
        accountId: 'acct-0',
      })
      expect('error' in r).toBe(true)
      if ('error' in r) expect(r.error).not.toBe('not_your_turn')
      expect(repo.getMovesSince(0).length).toBe(0)
    })
  })

  it('the persisted log replays byte-exactly to the live snapshot (pipeline flagship)', async () => {
    await runInDurableObject(stubFor('apply-replay'), (_i, state: any) => {
      const { repo, game } = seedScriptedGame(state.storage.sql)
      const apply = makeApply(state, repo)
      for (let i = 0; i < game.script.length; i++) apply(step(game, i))

      const replayed = replay(repo.getInitialState()!, repo.getMovesSince(0))
      expect(serializeState(replayed)).toBe(serializeState(repo.getSnapshot()!))
    })
  })
})
