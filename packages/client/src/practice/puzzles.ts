import { posKey } from '@viota/engine'
import type { Card, RegularCard } from '@viota/engine'
import type { Puzzle } from './types'

const R = (color: any, shape: any, number: any): RegularCard => ({ kind: 'regular', color, shape, number })
const WILD: Card = { kind: 'wild' }
const at = (x: number, y: number, c: Card): [string, Card] => [posKey({ x, y }), c]

export const PUZZLES: Puzzle[] = [
  // --- The basics -----------------------------------------------------
  {
    id: 'open-line', title: 'Open a line', concept: 'The basics', mode: 'concept', answerKind: 'play',
    conceptCheck: 'any-line',
    instruction: 'Concept — any two cards can start a line. Play a card next to the one on the board.',
    position: {
      grid: [at(0, 0, R('red', 'circle', 1))],
      hand: [R('blue', 'triangle', 3), R('green', 'square', 4), R('yellow', 'plus', 2), R('red', 'circle', 4)],
    },
    explanation: 'Any two cards form a legal line, so any adjacent placement is a valid opening.',
  },

  // --- Reading lines ----------------------------------------------------
  {
    id: 'all-same-line', title: 'All-same line', concept: 'Reading lines', mode: 'concept', answerKind: 'play',
    conceptCheck: 'line-all-same',
    instruction: 'Concept — a line can hold one property constant. Play a card that shares a color, shape, or number with the board card.',
    position: {
      grid: [at(0, 0, R('red', 'circle', 1))],
      hand: [R('red', 'triangle', 2), R('blue', 'square', 3), R('yellow', 'circle', 4), R('green', 'plus', 1)],
    },
    explanation: 'red-triangle-2 keeps color constant, yellow-circle-4 keeps shape constant, and green-plus-1 keeps number constant — any of the three makes an "all-same" line.',
  },
  {
    id: 'all-different-line', title: 'All-different line', concept: 'Reading lines', mode: 'concept', answerKind: 'play',
    conceptCheck: 'line-all-different',
    instruction: 'Concept — a line can also be all-different on every property. Find the hand card that shares nothing with the board card.',
    position: {
      grid: [at(0, 0, R('red', 'circle', 1))],
      hand: [R('blue', 'square', 3), R('red', 'triangle', 2), R('yellow', 'plus', 1), R('green', 'circle', 4)],
    },
    explanation: 'blue-square-3 differs in color, shape, and number from red-circle-1 — a fully "all-different" line. The other three cards each share one property, which would NOT qualify.',
  },
  {
    id: 'mixed-properties', title: 'Mixed properties', concept: 'Reading lines', mode: 'concept', answerKind: 'play',
    conceptCheck: 'mixed-properties',
    instruction: 'Concept — the most common beginner mistake: a line only needs each PROPERTY to be same-or-different, not the whole card. Play a card that matches one property but not the others.',
    position: {
      grid: [at(0, 0, R('green', 'triangle', 2))],
      hand: [R('green', 'plus', 3), R('blue', 'square', 4), R('yellow', 'circle', 1), R('red', 'triangle', 4)],
    },
    explanation: 'green-plus-3 keeps color the same while shape and number both change — and red-triangle-4 does the same trick via shape. A line is legal as long as color, shape, and number are EACH independently all-same or all-different.',
  },
  {
    id: 'spans-both-ends', title: 'Extend both ends', concept: 'Reading lines', mode: 'concept', answerKind: 'play',
    conceptCheck: 'spans-both-ends',
    instruction: 'Concept — a single play can add cards at both ends of an existing segment at once. Bracket the two cards already on the board.',
    position: {
      grid: [at(1, 0, R('red', 'circle', 2)), at(2, 0, R('red', 'circle', 3))],
      hand: [R('red', 'circle', 1), R('red', 'circle', 4), R('blue', 'triangle', 1), R('yellow', 'square', 2)],
    },
    explanation: 'Placing red-circle-1 on the left and red-circle-4 on the right in the same turn completes the row [1,2,3,4] — one play, both ends.',
  },

  // --- Scoring big --------------------------------------------------------
  {
    id: 'second-line', title: 'Make a second line', concept: 'Scoring big', mode: 'top-score', answerKind: 'play',
    instruction: 'Top score — a card placed where a row and a column meet scores in BOTH lines at once. Find the highest total.',
    position: {
      grid: [at(1, 0, R('red', 'circle', 2)), at(0, 1, R('blue', 'triangle', 3))],
      hand: [R('green', 'square', 4), R('yellow', 'plus', 1), R('blue', 'circle', 2), R('red', 'triangle', 1)],
    },
    explanation: 'Playing into the corner cell where the row and column anchors meet counts that cell once per line — look for plays that touch two lines simultaneously rather than just one.',
  },
  {
    id: 'complete-lot', title: 'Complete a lot', concept: 'Scoring big', mode: 'top-score', answerKind: 'play',
    instruction: 'Top score — find the highest-scoring play. (Hint: a 4-card line doubles.)',
    position: {
      grid: [at(0, 0, R('red', 'circle', 1))],
      hand: [R('red', 'circle', 2), R('red', 'circle', 3), R('red', 'circle', 4), R('blue', 'triangle', 1)],
    },
    explanation: 'Extending to [1,2,3,4] same-color makes a lot: base 10 × 2 = 20.',
  },
  {
    id: 'play-four', title: 'Play four cards', concept: 'Scoring big', mode: 'top-score', answerKind: 'play',
    instruction: 'Top score — playing all 4 cards in one turn doubles your score on top of any lot bonus. Find the best use of your whole hand.',
    position: {
      grid: [at(0, 0, R('red', 'circle', 1))],
      hand: [R('blue', 'triangle', 1), R('blue', 'plus', 2), R('blue', 'square', 3), R('blue', 'circle', 4)],
    },
    explanation: 'Playing all 4 blue cards in a column forms a lot (×2) and, because it uses your whole hand in one turn, the four-card bonus (×2) fires too — the multipliers stack to ×4.',
  },
  {
    id: 'single-vs-multi', title: 'Single vs. multi-card', concept: 'Scoring big', mode: 'top-score', answerKind: 'play',
    instruction: 'Top score — one big card looks tempting, but a multi-card play scores far more. Find it.',
    position: {
      grid: [at(0, 0, R('yellow', 'plus', 1))],
      hand: [R('yellow', 'plus', 2), R('yellow', 'plus', 3), R('yellow', 'plus', 4), R('green', 'triangle', 3)],
    },
    explanation: 'Playing the lone green-triangle-3 alone scores only 1 + 3 = 4. Extending the row to a full yellow lot [1,2,3,4] scores 10 × 2 = 20 — always check whether a multi-card line beats the single best-looking card.',
  },
  {
    id: 'double-lot', title: 'Double lot', concept: 'Scoring big', mode: 'top-score', answerKind: 'play',
    instruction: 'Top score (advanced) — one play can complete two lots at once, and the multipliers stack (2 lots = ×4). Find it.',
    position: {
      grid: [
        at(0, 1, R('red', 'triangle', 1)),
        at(1, 0, R('blue', 'plus', 1)),
        at(1, 2, R('yellow', 'plus', 3)),
        at(1, 3, R('green', 'plus', 4)),
      ],
      hand: [R('red', 'plus', 2), R('red', 'square', 3), R('red', 'circle', 4), R('blue', 'triangle', 1)],
    },
    explanation: 'Playing red-plus-2, red-square-3, and red-circle-4 across row y=1 completes BOTH the row lot [red 1,2,3,4] and the column lot [blue/red/yellow/green-plus 1,2,3,4] in one play: base 10+10=20, and two lots compound to ×4, for a total of 80.',
  },

  // --- Wilds ----------------------------------------------------------
  {
    id: 'wild-in-two-lines', title: 'Wild across two lines', concept: 'Wilds', mode: 'concept', answerKind: 'play',
    conceptCheck: 'wild-in-two-lines',
    instruction: 'Concept — a wild placed at a crossing point must represent the same card in both lines it joins. Place the wild where the row and column meet.',
    position: {
      grid: [at(1, 0, R('green', 'plus', 2)), at(0, 1, R('yellow', 'circle', 4))],
      hand: [WILD, R('blue', 'square', 1), R('red', 'triangle', 3), R('green', 'circle', 1)],
    },
    explanation: 'The wild at the corner is part of a 2-card row line AND a 2-card column line at once. Two-card lines accept any card identity, so any single assignment for the wild satisfies both simultaneously — the placement is always legal here.',
  },

  // --- When to pass -----------------------------------------------------
  {
    id: 'forced-pass', title: 'Nothing to play', concept: 'When to pass', mode: 'concept', answerKind: 'forced-pass',
    instruction: 'Concept — sometimes you cannot play at all. What is your only legal action?',
    position: {
      grid: [
        at(0, 0, R('blue', 'triangle', 1)), at(1, 0, R('red', 'plus', 1)), at(2, 0, R('yellow', 'square', 1)), at(3, 0, R('green', 'circle', 1)),
        at(0, 1, R('red', 'plus', 2)), at(1, 1, R('yellow', 'square', 2)), at(2, 1, R('green', 'circle', 2)), at(3, 1, R('blue', 'triangle', 2)),
        at(0, 2, R('yellow', 'square', 3)), at(1, 2, R('green', 'circle', 3)), at(2, 2, R('blue', 'triangle', 3)), at(3, 2, R('red', 'plus', 3)),
        at(0, 3, R('green', 'circle', 4)), at(1, 3, R('blue', 'triangle', 4)), at(2, 3, R('red', 'plus', 4)), at(3, 3, R('yellow', 'square', 4)),
      ],
      hand: [R('blue', 'plus', 1), R('red', 'triangle', 1), R('green', 'square', 1), R('yellow', 'circle', 1)],
    },
    explanation: 'The 4×4 grid is completely full, and every row and column is already a maximal 4-card lot. Any cell you could legally reach would extend one of those lines to 5 cards, which is never allowed — so no card in your hand has a legal home. You must pass.',
  },
]
