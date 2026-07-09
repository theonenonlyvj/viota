import Card from '../components/Card'
import type { Card as CardT } from '@viota/engine'

export type RulesSection = { id: string; title: string; body: React.ReactNode; quickRef?: boolean }

const C = (color: any, shape: any, number: any): CardT => ({ kind: 'regular', color, shape, number })
const Row = ({ cards }: { cards: CardT[] }) => (
  <div style={{ display: 'flex', gap: 6, margin: '8px 0' }}>{cards.map((c, i) => <Card key={i} card={c} />)}</div>
)

export const RULES_SECTIONS: RulesSection[] = [
  { id: 'object', title: 'Object', quickRef: true, body: (
    <p>Score the most points by adding cards in <b>lines</b> connected to the grid. The 66-card deck is every
       combination of 4 colors × 4 shapes × 4 numbers (64 cards) plus 2 wilds.</p>
  ) },
  { id: 'line', title: 'What is a line?', quickRef: true, body: (
    <>
      <p>A <b>line</b> is 2–4 cards in a straight row or column (no gaps, no diagonals). For <i>each</i> property
         — color, shape, number — the values must be <b>either all the same or all different</b> across the line.
         The three properties are judged independently.</p>
      <p style={{ color: '#4ade80' }}>Legal — same color, different shapes, same number:</p>
      <Row cards={[C('red', 'triangle', 2), C('red', 'plus', 2), C('red', 'circle', 2)]} />
      <p style={{ color: '#4ade80' }}>Legal — "mixed": same color, all-different shapes, all-different numbers:</p>
      <Row cards={[C('green', 'triangle', 2), C('green', 'plus', 3), C('green', 'circle', 1)]} />
    </>
  ) },
  { id: 'lots', title: 'Lots (4-card lines)', quickRef: true, body: (
    <p>A 4-card line is a <b>lot</b> and doubles your score for the turn. Each additional lot doubles again
       (2 lots = ×4). Max line length is 4.</p>
  ) },
  { id: 'scoring', title: 'Scoring', quickRef: true, body: (
    <>
      <p>Add the face values of every card in each line you create or extend this turn. A card shared by two
         lines counts once <i>per line</i>. Wilds are worth 0.</p>
      <p>Then multiply the whole turn: <b>×2 for each lot</b>, <b>×2 if you play 4 cards this turn</b>,
         and <b>×2 if this turn ends the game</b> (draw pile empty and you play your last card).</p>
    </>
  ) },
  { id: 'wilds', title: 'Wild cards', quickRef: true, body: (
    <p>A wild stands for any card (face value 0). It stays unnamed until a line needs it, and must mean the
       same card in every line it joins. Before your turn you may <b>recycle</b> a wild already on the board —
       swap it for a matching card from your hand — and replay the wild later. Multiple recycles per turn are allowed.</p>
  ) },
  { id: 'pass', title: 'Pass & trade', quickRef: true, body: (
    <p>Instead of playing, you may <b>pass</b> and trade some, all, or none of your cards to the bottom of the
       draw pile (you choose their order), then redraw to 4.</p>
  ) },
  { id: 'end', title: 'Ending the game', body: (
    <p>The game ends when the draw pile is empty and a player plays their last card (that turn scores double).
       Highest score wins. <i>viota house rules:</i> if everyone passes for 3 full rounds the game ends;
       exact ties may play an optional agreed sudden-death round.</p>
  ) },
]

export const QUICK_REF: RulesSection[] = RULES_SECTIONS.filter(s => s.quickRef)
