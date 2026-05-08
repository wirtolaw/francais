import { HashRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Review from './pages/Review'
import Notes from './pages/Notes'
import BottomNav from './components/BottomNav'

export default function App() {
  return (
    <HashRouter>
      <div className="min-h-screen bg-gray-50 flex justify-center">
        <div className="w-full max-w-[430px] bg-white min-h-screen pb-16 relative">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/review" element={<Review />} />
            <Route path="/notes" element={<Notes />} />
          </Routes>
          <BottomNav />
        </div>
      </div>
    </HashRouter>
  )
}
