import type { Card, Placement, RegularCard } from '@viota/engine'
import CardComp from './Card'

type Props = {
  hand: Card[]
  selectedCard: Card | null
  staged: Placement[]
  onSelectCard: (card: Card) => void
  recycleValidCards?: Card[]
  onConfirmRecycle?: (card: RegularCard) => void
}

export default function Hand({ hand, selectedCard, staged, onSelectCard, recycleValidCards, onConfirmRecycle }: Props) {
  const stagedRefs = new Set(staged.map(p => p.card))
  const recycling = recycleValidCards && recycleValidCards.length > 0
  const validSet = recycling ? new Set(recycleValidCards) : null

  return (
    <div style={{ display: 'flex', gap: 7 }}>
      {hand.map((card, i) => {
        const isStaged = stagedRefs.has(card)

        if (recycling && validSet) {
          const isValid = validSet.has(card)
          return (
            <div key={i} style={{ opacity: isValid ? 1 : 0.3 }}>
              <CardComp
                card={card}
                glow={isValid ? 'purple' : undefined}
                onClick={isValid && onConfirmRecycle ? () => onConfirmRecycle(card as RegularCard) : undefined}
              />
            </div>
          )
        }

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
