# Six-Human Iota Exploration

Date: 2026-07-09
Branch: `5-plus-player-exploration`
Status: design exploration only; no implementation planned from this branch

## Summary

The council recommendation is: do not build true live 6-player Iota.

The source game is explicitly tuned for 2-4 rules seats: a 66-card unique deck,
4-card hands, 1-4 cards played per turn, 4-card maximum lines, and scoring that
can spike hard through lots, all-4-card turns, and the final hand-out bonus.
Expanding that directly to six individual turn seats creates too much downtime,
too few meaningful turns per player, and too much endgame variance.

The best six-human shape is **three teams of two**, implemented as a normal
3-seat Iota game. Each team shares one 4-card hand, one score, and one turn.
Partners discuss; one captain submits. The rules engine can remain conceptually
faithful because the number of rules seats stays within canonical 2-4 Iota.

## Ground Truths That Stay Fixed

These are source-rule constraints, not balancing knobs:

- Canonical Iota is 2-4 players.
- The deck is 66 cards: 64 unique regular cards plus 2 wilds.
- Regular cards are the 4 colors x 4 shapes x 4 numbers matrix.
- Hand size is 4 cards.
- A play places 1-4 cards in one straight line connected to the grid.
- A line is 2-4 contiguous row/column cards.
- Every property in a line is either all same or all different.
- A 4-card line is a lot and doubles the turn score.
- Playing all 4 cards in one turn doubles the turn score.
- The game ends when the draw pile is empty and one player plays their last card;
  that turn receives the final doubling bonus.
- Wild and recycle rules remain exactly as defined by the source rules.

Any six-human mode must be labeled as a viota party variant or team mode, not as
canonical 6-player Iota.

## Why Naive 6-Player Iota Fails

### Downtime

Iota is a private-hand tactical puzzle. With six individual seats, five other
turns can rewrite the board before a player acts again. Off-turn planning becomes
fragile, and a pass after a long wait feels bad.

At a modest 60 seconds per turn, a player may wait about five minutes between
turns. Since the deck is small, that player may only get a few meaningful scoring
turns in the whole game.

### Deck Economy

For `P` players with 4-card hands:

`draw pile = 66 - 4P - 1`

| Rules seats | Initial draw pile | Initial private cards | Max stranded cards at end |
| ---: | ---: | ---: | ---: |
| 4 | 49 | 16 / 66 | 12 |
| 6 | 41 | 24 / 66 | 20 |

Six individual players hide 24 cards before turn one. The draw pile starts at
41, and a fast ending can strand up to 20 cards in non-ending hands. That is a
large fraction of the deck never meaningfully entering the shared board.

### Turn Count And Variance

With six individual players, the earliest ending requires only 45 played cards
after the starter. If average play size is:

- 1.5 cards per scoring turn: about 5.0 scoring turns per player
- 2.0 cards per scoring turn: about 3.75 scoring turns per player
- 2.5 cards per scoring turn: about 3.0 scoring turns per player

That is too few turns for Iota's scoring variance to normalize. Lots and cross
lines are exciting because they spike; in a six-player free-for-all they can feel
more like seat-order luck than earned strategy.

### Endgame Fairness

The source ending is immediate: when the draw pile is empty and one player plays
their last card, the game ends and that turn gets the final double. At six
individual seats, this is harsh. One player can combine lot multipliers, the
all-4 bonus, and the final bonus while several opponents still hold uncashable
cards.

### Pass/Trade Friction

Pass/trade is a healthy repair valve in 2-4 player Iota. At six individual seats,
it can consume one of only 3-5 meaningful turns. Players will either avoid
passing and make weak plays, or pass and feel punished.

## Variants Considered

### Recommended: Three Teams Of Two

Shape:

- Six humans form three teams.
- The game has three rules seats.
- Each seat has one shared 4-card hand.
- Each team has one score and one turn.
- Teammates may discuss privately or openly.
- One teammate is the captain for the current team turn and submits the move.
- Captain rotates each team turn or can be handed off explicitly.

Why it works:

- Preserves deck economy, hand size, line rules, scoring, wilds, and turn loop.
- Keeps only three decision turns per round.
- Every human is engaged on half the table's turns as either captain or partner.
- Maintains hidden information between teams.
- Avoids creating a fake 6-player ruleset.

UX implications:

- Team-only hand visibility.
- Team-only staging/suggestion layer.
- Captain submit button.
- Easy captain handoff.
- Visible turn timer, likely 45-75 seconds, with one optional extension.
- Strong celebration for lots and big scoring turns.

Primary playtest questions:

- Does one partner dominate decisions?
- Does rotating captain fix domination without making teams clumsy?
- Is one shared 4-card hand enough agency for both players?
- Does team discussion need a timer to prevent analysis drag?

### Competitive Alternative: Two Parallel 3-Player Tables

Shape:

- Six humans split into two separate 3-player games.
- A room hub shows both public boards, scores, and game states.
- Players can spectate the other table's public board only.
- Optional finals/rematch flow after both tables end.

Why it works:

- Preserves individual agency.
- Everyone gets normal Iota pacing.
- Avoids team quarterbacking.

Why it is not the primary recommendation:

- It is less of a shared-table experience.
- It needs room-hub product work.
- It is tournament structure, not a single party game.

### Async Only: Six Individual Seats

Shape:

- Six individual players are allowed only in correspondence mode, not live mode.
- Turns use long timers, reminders, and AI cover at deadline.
- Players can plan privately between turns.

Why it might work:

- Long downtime becomes expected rather than painful.
- Board changes are not interrupting a live social session.

Why it is not a first build:

- Requires real notifications to feel good.
- Still needs endgame balancing.
- Does not solve live six-person fun.

## Kill List

Do not build these as first-class six-human modes:

- Live six-player free-for-all with unchanged rules.
- Shrinking hands to 3 or 2.
- Increasing hand size to 5.
- Adding a second deck or duplicate regular cards.
- Adding more colors, shapes, numbers, wilds, or special card powers.
- Simultaneous turns on the same board.
- Six individual players with team scoring but individual hidden hands.
- Any mode that exposes opponent hands outside the authorized team.

## If A True 6-Seat Variant Is Ever Tested

The council does not recommend this for live play. If it is tested anyway, label
it as casual and separate from canonical Iota. Minimum balancing changes:

- Keep the 66-card deck.
- Keep 4-card hands.
- Keep 1-4 card plays.
- Keep standard line, lot, wild, and pass/trade rules.
- Finish the current round after the end condition is triggered, so all players
  receive equal turns.
- Remove the final x2 multiplier, or replace it with a small flat bonus. The
  recommendation is to remove it.
- After the draw pile is empty, allow pass with no trade so the final round
  cannot stall.

Even with those changes, the expected result is a casual party variant, not the
best six-person mode.

## Implementation Direction

Do not expand the engine to 6 rules seats as the primary path.

If this exploration becomes implementation work, specify it as:

**Six Humans, Three Seats**

Likely high-level work:

- Room/lobby support for teams: six humans assigned to three seats.
- Seat authorization supports more than one account per rules seat.
- Redaction changes so both teammates can see the shared team hand.
- Only the current captain can submit, or both teammates can stage while captain
  confirms.
- AI cover triggers only when no teammate on the current seat is present, or
  when the captain deadline expires and no teammate claims captain.
- UI shows team scores, teammate identity, captain state, and team-only planning.

The canonical engine rules should stay unchanged unless a later implementation
plan identifies a minimal, tested abstraction for multiple accounts per seat.

## Decision

Close this branch as a documented exploration. The recommended product direction
is not "5+ player Iota"; it is "six-human team mode" with three rules seats.
