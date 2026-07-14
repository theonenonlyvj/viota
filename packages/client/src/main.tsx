import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './theme/fonts'
import './theme.css'
import Layout from './components/Layout'
import Home from './pages/Home'
import Game from './pages/Game'
import Lobby from './pages/Lobby'
import Room from './pages/Room'
import OnlineGame from './pages/OnlineGame'
import Practice from './pages/Practice'
import Leaderboard from './pages/Leaderboard'
import YourStats from './pages/YourStats'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/lobby/:code" element={<Room />} />
        <Route path="/practice" element={<Practice />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/stats" element={<YourStats />} />
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
