import { render, screen } from '@testing-library/react'
import Footer from './Footer'

test('exact links with new-tab + noopener', () => {
  render(<Footer />)
  const fb = screen.getByRole('link', { name: /feedback/i })
  expect(fb).toHaveAttribute('href', 'https://theonenonlyvj.github.io/personal-site/contact')
  expect(fb).toHaveAttribute('target', '_blank')
  expect(fb.getAttribute('rel')).toContain('noopener')
  const cta = screen.getByRole('link', { name: /click here/i })
  expect(cta).toHaveAttribute('href', 'https://theonenonlyvj.github.io/personal-site')
  expect(cta).toHaveAttribute('target', '_blank')
  expect(cta.getAttribute('rel')).toContain('noopener')
})

test('verbatim copy with period outside the link', () => {
  render(<Footer />)
  expect(screen.getByRole('contentinfo').textContent)
    .toBe('Have Feedback? Want to see my other projects? Click here.')
})
