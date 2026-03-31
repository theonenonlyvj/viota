import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Home from './Home'

test('Home page renders title', () => {
  render(<MemoryRouter><Home /></MemoryRouter>)
  expect(screen.getByText('Viota')).toBeInTheDocument()
})
