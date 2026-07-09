import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import SettingsMenu from './SettingsMenu'

test('shows quick-ref + how-to-play + quit; New game only when provided', async () => {
  const onOpenHowToPlay = vi.fn()
  const onQuit = vi.fn()
  const { rerender } = render(
    <SettingsMenu open onClose={() => {}} onOpenHowToPlay={onOpenHowToPlay} onQuit={onQuit} />,
  )
  await userEvent.click(screen.getByRole('button', { name: /full how to play/i }))
  expect(onOpenHowToPlay).toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: /quit to menu/i }))
  expect(onQuit).toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: /new game/i })).toBeNull()

  const onNewGame = vi.fn()
  rerender(<SettingsMenu open onClose={() => {}} onOpenHowToPlay={onOpenHowToPlay} onQuit={onQuit} onNewGame={onNewGame} />)
  await userEvent.click(screen.getByRole('button', { name: /new game/i }))
  expect(onNewGame).toHaveBeenCalled()
})

test('returns null when closed', () => {
  const { container } = render(
    <SettingsMenu open={false} onClose={() => {}} onOpenHowToPlay={() => {}} onQuit={() => {}} />,
  )
  expect(container.firstChild).toBeNull()
})
