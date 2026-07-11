import CardComp from './Card'
import type { Card } from '@viota/engine'

type Props =
  | { variant: 'placed'; card: Card; rotation?: number }
  | { variant: 'staged'; card: Card; onUnstage: () => void; rotation?: number }
  | { variant: 'valid'; onPlace: () => void }
  | { variant: 'wild'; card: Card; onRecycle: () => void; rotation?: number }
  | { variant: 'wild-targeted'; card: Card; rotation?: number }
  | { variant: 'empty' }

export default function Cell(props: Props) {
  if (props.variant === 'placed') {
    return <CardComp card={props.card} rotation={props.rotation} />
  }
  if (props.variant === 'staged') {
    return <CardComp card={props.card} selected onClick={props.onUnstage} rotation={props.rotation} />
  }
  if (props.variant === 'wild') {
    return <CardComp card={props.card} onClick={props.onRecycle} rotation={props.rotation} />
  }
  if (props.variant === 'wild-targeted') {
    return <CardComp card={props.card} glow="purple" rotation={props.rotation} />
  }
  if (props.variant === 'valid') {
    return (
      <div
        data-testid="valid-cell"
        style={{
          width: 56, height: 56, borderRadius: 7,
          border: '2px dashed #4ade80',
          background: 'rgba(74,222,128,0.07)',
          boxShadow: '0 0 10px rgba(74,222,128,0.25)',
          cursor: 'pointer',
        }}
        onClick={props.onPlace}
      />
    )
  }
  return (
    <div style={{ width: 56, height: 56, borderRadius: 7, border: '1px dashed #2a2a4a', opacity: 0.3 }} />
  )
}
