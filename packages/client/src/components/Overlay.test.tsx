import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Overlay from './Overlay'

describe('Overlay', () => {
  it('renders as a dialog with its children', () => {
    render(<Overlay title="Hi" onClose={() => {}}><p>body</p></Overlay>)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })
  it('closes on ESC', () => {
    const onClose = vi.fn()
    render(<Overlay onClose={onClose}><p>x</p></Overlay>)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
  it('closes on backdrop click but not on panel click', () => {
    const onClose = vi.fn()
    render(<Overlay onClose={onClose}><p>x</p></Overlay>)
    fireEvent.click(screen.getByTestId('overlay-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('overlay-panel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
