import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Game from './pages/Game'
import Lobby from './pages/Lobby'
import WaitingRoom from './pages/WaitingRoom'
import OnlineGame from './pages/OnlineGame'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/game/local" element={<Game />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/lobby/:code" element={<WaitingRoom />} />
        <Route path="/game/online" element={<OnlineGame />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
)
