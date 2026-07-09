import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Layout from './Layout'

test('renders the routed child and the footer once', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>child page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByText('child page')).toBeInTheDocument()
  expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
})
