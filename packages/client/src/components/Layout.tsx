import { Outlet } from 'react-router-dom'
import AuroraBackground from './AuroraBackground'
import Footer from './Footer'

export default function Layout() {
  return (
    <div className="chrome-scroll">
      <AuroraBackground>
        <Outlet />
      </AuroraBackground>
      <Footer />
    </div>
  )
}
