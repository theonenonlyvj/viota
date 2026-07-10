import type { Card, GameState, RegularCard } from '@viota/engine'
import type { GameRepository, SeatRow } from './storage'

/**
 * Per-seat redacted client view — the ONLY shape a client ever receives.
 *
 * Redaction boundary (hard rule):
 *  - the board `grid` is public;
 *  - the requesting seat's own hand is FULL;
 *  - every OTHER seat's hand is a COUNT only (never the cards);
 *  - the `drawPile` is a COUNT only (never the ordered array — leaking the
 *    order would break the hidden-information game AND replay secrecy);
 *  - `initial_state` has no client-reachable path at all.
 *
 * `grid` is emitted as entries (`[...grid.entries()]`) — the Map-safe wire form
 * the codec uses — so the client can rebuild it as `new Map(entries)`.
 */
export type ClientView = {
  grid: [string, Card][]
  mySeat: number
  myHand: Card[]
  handCounts: number[]
  drawPileCount: number
  scores: number[]
  turnIndex: number
  playedCards: RegularCard[]
  consecutivePasses: number
  finished: boolean
  /** Live seat roster (names are public within a game; nothing hidden here).
   *  Sourced from `seats.display_name`, NEVER from a one-time client snapshot,
   *  so it refreshes correctly both for the host (past the "Open/Open"
   *  placeholder) and on resume (past a fabricated "Player N"). */
  players: ClientPlayer[]
}

export type ClientPlayer = { seat: number; displayName: string; ownerType: string }

/** A seat's public display label: its real name when set, else an
 *  ownerType-appropriate placeholder (never "Player N" for a real human — that
 *  fabrication is exactly the bug this roster replaces). */
function playerLabel(s: SeatRow): string {
  if (s.display_name && s.display_name.length > 0) return s.display_name
  if (s.owner_type === 'open') return 'Open'
  if (s.owner_type === 'ai') return `AI ${s.seat_index + 1}`
  return `Player ${s.seat_index + 1}`
}

export function buildPlayerRoster(seats: SeatRow[]): ClientPlayer[] {
  return seats.map((s) => ({ seat: s.seat_index, displayName: playerLabel(s), ownerType: s.owner_type }))
}

/**
 * The waiting-room roster — the public projection of a `'waiting'` game (no
 * board, no deal). Names are public within a room; nothing hidden is exposed.
 */
export type WaitingRoomView = {
  status: 'waiting'
  playerCount: number
  code: string | null
  /** The seat allowed to press Start (the client shows the button only here). */
  hostSeat: number
  /** How many seats are still `'open'` — the count that will fill with AI at
   *  /start, so the host can confirm before starting. */
  openSeats: number
  /** The host-chosen AI-takeover patience (ms) for a disconnected on-turn seat;
   *  `0` = wait-for-me; null = the fixed away-turn default applies. */
  aiTakeoverMs: number | null
  seats: { seatIndex: number; ownerType: string; displayName: string | null }[]
}

export function buildWaitingRoomView(repo: GameRepository): WaitingRoomView {
  const meta = repo.getMeta()
  const seats = repo.getSeats()
  return {
    status: 'waiting',
    playerCount: meta?.player_count ?? 0,
    code: meta?.code ?? null,
    hostSeat: meta?.host_seat ?? 0,
    openSeats: seats.filter((s) => s.owner_type === 'open').length,
    aiTakeoverMs: meta?.ai_takeover_ms ?? null,
    seats: seats.map((s) => ({
      seatIndex: s.seat_index,
      ownerType: s.owner_type,
      displayName: s.display_name,
    })),
  }
}

export function buildClientView(state: GameState, seatIndex: number, seats: SeatRow[]): ClientView {
  return {
    grid: [...state.grid.entries()],
    mySeat: seatIndex,
    myHand: state.hands[seatIndex] ?? [], // own hand FULL
    handCounts: state.hands.map((h) => h.length), // others -> COUNT only
    drawPileCount: state.drawPile.length, // COUNT only, never the array
    scores: state.scores,
    turnIndex: state.turnIndex,
    playedCards: state.playedCards,
    consecutivePasses: state.consecutivePasses ?? 0,
    finished: state.finished ?? false,
    players: buildPlayerRoster(seats),
  }
}
