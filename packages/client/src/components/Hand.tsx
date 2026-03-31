import type { Card, Placement } from '@viota/engine'
import CardComp from './Card'

type Props = {
  hand: Card[]
  selectedCard: Card | null
  staged: Placement[]
  onSelectCard: (card: Card) => void
}

export default function Hand({ hand, selectedCard, staged, onSelectCard }: Props) {
  const stagedRefs = new Set(staged.map(p => p.card))

  return (
    <div style={{ display: 'flex', gap: 7 }}>
      {hand.map((card, i) => {
        const isStaged = stagedRefs.has(card)
        const isSelected = card === selectedCard
        return (
          <div key={i} style={{ opacity: isStaged ? 0.3 : 1 }}>
            <CardComp
              card={card}
              selected={isSelected}
              onClick={isStaged ? undefined : () => onSelectCard(card)}
            />
          </div>
        )
      })}
    </div>
  )
}
