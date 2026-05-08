import { useLocation, useNavigate } from 'react-router-dom'

const tabs = [
  { path: '/', label: '主页', icon: '🏠' },
  { path: '/review', label: '复习', icon: '📖' },
  { path: '/notes', label: '笔记', icon: '📝' },
]

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white border-t border-gray-200 z-50">
      <div className="flex justify-around items-center h-14">
        {tabs.map((tab) => {
          const isActive = location.pathname === tab.path
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${
                isActive ? 'text-indigo-600' : 'text-gray-400'
              }`}
            >
              <span className="text-lg">{tab.icon}</span>
              <span className="text-xs mt-0.5 font-medium">{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
