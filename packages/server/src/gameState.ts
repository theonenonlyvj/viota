import type { Db } from './db'
import type { Card, GameState, RegularCard } from '@viota/engine'

export type ClientView = {
  grid: [string, Card][]
  myHand: Card[]
  handSizes: number[]
  drawPileCount: number
  scores: number[]
  turnIndex: number
  playedCards: RegularCard[]
}

export function serializeGrid(grid: Map<string, Card>): string {
  return JSON.stringify([...grid.entries()])
}

export function deserializeGrid(json: string): Map<string, Card> {
  return new Map(JSON.parse(json) as [string, Card][])
}

export function saveState(db: Db, roomCode: string, state: GameState): void {
  db.prepare(`
    INSERT INTO game_states (room_code, grid_json, draw_pile_json, hands_json, scores_json, turn_index, played_cards_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(room_code) DO UPDATE SET
      grid_json = excluded.grid_json,
      draw_pile_json = excluded.draw_pile_json,
      hands_json = excluded.hands_json,
      scores_json = excluded.scores_json,
      turn_index = excluded.turn_index,
      played_cards_json = excluded.played_cards_json,
      updated_at = excluded.updated_at
  `).run(
    roomCode,
    serializeGrid(state.grid),
    JSON.stringify(state.drawPile),
    JSON.stringify(state.hands),
    JSON.stringify(state.scores),
    state.turnIndex,
    JSON.stringify(state.playedCards),
    Date.now()
  )
}

export function loadState(db: Db, roomCode: string): GameState | null {
  const row = db.prepare('SELECT * FROM game_states WHERE room_code = ?').get(roomCode) as
    | { grid_json: string; draw_pile_json: string; hands_json: string; scores_json: string; turn_index: number; played_cards_json: string }
    | undefined

  if (!row) return null

  return {
    grid: deserializeGrid(row.grid_json),
    drawPile: JSON.parse(row.draw_pile_json) as Card[],
    hands: JSON.parse(row.hands_json) as Card[][],
    scores: JSON.parse(row.scores_json) as number[],
    turnIndex: row.turn_index,
    playedCards: JSON.parse(row.played_cards_json) as RegularCard[],
  }
}

export function buildClientView(state: GameState, playerIndex: number): ClientView {
  return {
    grid: [...state.grid.entries()],
    myHand: state.hands[playerIndex] ?? [],
    handSizes: state.hands.map(h => h.length),
    drawPileCount: state.drawPile.length,
    scores: state.scores,
    turnIndex: state.turnIndex,
    playedCards: state.playedCards,
  }
}
