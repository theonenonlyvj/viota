import { useLayoutEffect } from 'react'

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function getFocusables(card: HTMLElement): HTMLElement[] {
  return Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

/**
 * Shared modal a11y behavior (spec §4/§8): Escape dismiss + a simple focus
 * trap. On open, focus moves into the card (or its first focusable
 * descendant); Tab/Shift+Tab wrap within the card's focusable elements. On
 * close/unmount, focus is restored to whatever element triggered the modal
 * (if it's still in the document). No-ops entirely when `open` is false.
 */
export function useModalDismiss(open: boolean, onClose: () => void, cardRef: React.RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    if (!open) return

    const trigger = document.activeElement as HTMLElement | null
    const card = cardRef.current
    const focusables = card ? getFocusables(card) : []
    ;(focusables[0] ?? card)?.focus()

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab' || !card) return

      const items = getFocusables(card)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement

      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (trigger && trigger.isConnected) trigger.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose])
}
