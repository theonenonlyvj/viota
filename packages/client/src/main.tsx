import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './theme/fonts'
import './theme.css'
import Layout from './components/Layout'
import Home from './pages/Home'
import Game from './pages/Game'
import Lobby from './pages/Lobby'
import WaitingRoom from './pages/WaitingRoom'
import OnlineGame from './pages/OnlineGame'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/lobby/:code" element={<WaitingRoom />} />
      </Route>
      <Route path="/game/local" element={<Game />} />
      <Route path="/game/online" element={<OnlineGame />} />
    </Routes>
  )
}

const rootEl = document.getElementById('root')
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </StrictMode>,
  )
}
