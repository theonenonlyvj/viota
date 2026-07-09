import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

// stub the heavy pages so the routing test stays about the footer
vi.mock('./pages/Home', () => ({ default: () => <div>home</div> }))
vi.mock('./pages/Lobby', () => ({ default: () => <div>lobby</div> }))
vi.mock('./pages/WaitingRoom', () => ({ default: () => <div>waiting</div> }))
vi.mock('./pages/Game', () => ({ default: () => <div>local game</div> }))
vi.mock('./pages/OnlineGame', () => ({ default: () => <div>online game</div> }))
vi.mock('./pages/Practice', () => ({ default: () => <div>practice</div> }))

import { AppRoutes } from './main'

function at(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>)
}

test('footer shows on chrome routes', () => {
  for (const p of ['/', '/lobby', '/lobby/ABC123', '/practice']) {
    const { unmount } = at(p)
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    unmount()
  }
})

test('footer is absent on game routes', () => {
  for (const p of ['/game/local', '/game/online']) {
    const { unmount } = at(p)
    expect(screen.queryByRole('contentinfo')).toBeNull()
    unmount()
  }
})
