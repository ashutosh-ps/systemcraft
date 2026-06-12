import { useCallback, useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { Header } from './components/layout/Header'
import { Sidebar } from './components/layout/Sidebar'
import { SearchModal } from './components/layout/SearchModal'
import { HomePage } from './pages/HomePage'
import { ModulePage } from './pages/ModulePage'
import { CategoryPage } from './pages/CategoryPage'
import { NotFoundPage } from './pages/NotFoundPage'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => window.scrollTo(0, 0), [pathname])
  return null
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const location = useLocation()
  const isHome = location.pathname === '/'

  const openSearch = useCallback(() => setSearchOpen(true), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="min-h-screen">
      <ScrollToTop />
      <Header onMenu={() => setSidebarOpen(true)} onSearch={openSearch} />
      <div className="flex">
        {!isHome && <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />}
        <main className="min-w-0 flex-1">
          <Routes>
            <Route path="/" element={<HomePage onSearch={openSearch} />} />
            <Route path="/category/:categoryId" element={<CategoryPage />} />
            <Route path="/module/:moduleId" element={<ModulePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
      </div>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
