import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import HowToPlay from './HowToPlay'

describe('HowToPlay', () => {
  it('renders the rules sections and closes', () => {
    const onClose = vi.fn()
    render(<HowToPlay onClose={onClose} />)
    expect(screen.getByText(/What is a line/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
  it('writes nothing to localStorage (ephemeral)', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<HowToPlay onClose={() => {}} />)
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })
})
