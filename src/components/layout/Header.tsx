import { Boxes, Menu, Moon, Search, Sun } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTheme } from '../../context/ThemeContext'
import { useProgress } from '../../context/ProgressContext'
import { orderedModules } from '../../data/course'

function OverallProgress() {
  const { completed } = useProgress()
  const done = orderedModules.filter((m) => completed[m.id]).length
  const total = orderedModules.length
  const pct = total === 0 ? 0 : done / total
  const r = 9
  const circ = 2 * Math.PI * r

  return (
    <div className="hidden items-center gap-2 sm:flex" title={`${done} of ${total} modules completed`}>
      <svg width="24" height="24" viewBox="0 0 24 24" className="-rotate-90">
        <circle cx="12" cy="12" r={r} fill="none" strokeWidth="3" className="stroke-surface-200 dark:stroke-surface-700" />
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          className="stroke-brand-500 transition-all duration-700"
        />
      </svg>
      <span className="text-xs font-medium tabular-nums text-surface-500 dark:text-surface-400">
        {Math.round(pct * 100)}%
      </span>
    </div>
  )
}

export function Header({ onMenu, onSearch }: { onMenu: () => void; onSearch: () => void }) {
  const { dark, toggle } = useTheme()

  return (
    <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-surface-200 bg-white/80 px-4 backdrop-blur-md dark:border-surface-800 dark:bg-surface-900/80">
      <button
        onClick={onMenu}
        className="rounded-lg p-2 hover:bg-surface-100 lg:hidden dark:hover:bg-surface-800"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      <Link to="/" className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white">
          <Boxes className="h-5 w-5" />
        </span>
        <span className="text-base font-bold tracking-tight text-surface-900 dark:text-white">
          System<span className="text-brand-600 dark:text-brand-400">Craft</span>
        </span>
      </Link>

      <div className="flex-1" />

      <button
        onClick={onSearch}
        className="flex items-center gap-2 rounded-lg border border-surface-200 bg-surface-50 px-3 py-1.5 text-sm text-surface-500 transition-colors hover:border-surface-300 dark:border-surface-700 dark:bg-surface-850 dark:text-surface-400 dark:hover:border-surface-600"
      >
        <Search className="h-4 w-4" />
        <span className="hidden md:inline">Search topics…</span>
        <kbd className="hidden rounded border border-surface-300 px-1.5 py-0.5 font-mono text-[10px] md:inline dark:border-surface-600">
          ⌘K
        </kbd>
      </button>

      <OverallProgress />

      <button
        onClick={toggle}
        className="rounded-lg p-2 text-surface-500 hover:bg-surface-100 hover:text-surface-900 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-white"
        aria-label="Toggle dark mode"
      >
        {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </button>
    </header>
  )
}
