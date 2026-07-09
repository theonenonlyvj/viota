import { render, screen } from '@testing-library/react'
import AuroraBackground from './AuroraBackground'

test('renders children above non-interactive background layers', () => {
  const { container } = render(<AuroraBackground><button>Play</button></AuroraBackground>)
  expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  expect(container.querySelector('.aurora__grain')).not.toBeNull()
  expect(container.querySelector('.aurora__vignette')).not.toBeNull()
})
