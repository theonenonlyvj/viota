import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SettingsMenu from './SettingsMenu'

describe('SettingsMenu', () => {
  it('shows quick-ref + how-to-play + quit; New game only when provided', () => {
    const onOpenHowToPlay = vi.fn(), onQuit = vi.fn()
    const { rerender } = render(<SettingsMenu onClose={() => {}} onOpenHowToPlay={onOpenHowToPlay} onQuit={onQuit} />)
    fireEvent.click(screen.getByRole('button', { name: /full how to play/i }))
    expect(onOpenHowToPlay).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /quit to menu/i }))
    expect(onQuit).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /new game/i })).toBeNull()
    const onNewGame = vi.fn()
    rerender(<SettingsMenu onClose={() => {}} onOpenHowToPlay={onOpenHowToPlay} onQuit={onQuit} onNewGame={onNewGame} />)
    fireEvent.click(screen.getByRole('button', { name: /new game/i }))
    expect(onNewGame).toHaveBeenCalled()
  })
})
