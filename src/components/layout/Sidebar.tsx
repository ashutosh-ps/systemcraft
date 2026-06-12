import { CheckCircle2, Circle, X } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { categories, modulesInCategory } from '../../data/course'
import { useProgress } from '../../context/ProgressContext'

function CategoryProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-200 dark:bg-surface-800">
        <div className="h-full rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-medium tabular-nums text-surface-400">
        {done}/{total}
      </span>
    </div>
  )
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { completed } = useProgress()
  const location = useLocation()

  const nav = (
    <nav className="sc-scroll flex h-full flex-col gap-6 overflow-y-auto px-4 py-6">
      {categories.map((cat) => {
        const mods = modulesInCategory(cat.id)
        const done = mods.filter((m) => completed[m.id]).length
        return (
          <div key={cat.id}>
            <NavLink
              to={`/category/${cat.id}`}
              className="text-xs font-bold tracking-wider text-surface-500 uppercase hover:text-brand-600 dark:text-surface-400 dark:hover:text-brand-400"
            >
              {cat.title}
            </NavLink>
            <CategoryProgressBar done={done} total={mods.length} />
            <ul className="mt-2 space-y-0.5">
              {mods.map((m) => {
                const active = location.pathname === `/module/${m.id}`
                return (
                  <li key={m.id}>
                    <NavLink
                      to={`/module/${m.id}`}
                      onClick={onClose}
                      className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                        active
                          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                          : 'text-surface-600 hover:bg-surface-100 hover:text-surface-900 dark:text-surface-400 dark:hover:bg-surface-850 dark:hover:text-surface-200'
                      }`}
                    >
                      {completed[m.id] ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                      ) : (
                        <Circle className="h-4 w-4 shrink-0 text-surface-300 dark:text-surface-600" />
                      )}
                      <span className="flex-1 leading-snug">{m.title}</span>
                      <span className="text-[10px] tabular-nums text-surface-400 opacity-0 transition-opacity group-hover:opacity-100">
                        {m.estMinutes}m
                      </span>
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )

  return (
    <>
      {/* Desktop */}
      <aside className="no-print sticky top-14 hidden h-[calc(100vh-3.5rem)] w-72 shrink-0 border-r border-surface-200 bg-white lg:block dark:border-surface-800 dark:bg-surface-900">
        {nav}
      </aside>
      {/* Mobile drawer */}
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={onClose} />
          <aside className="absolute top-0 left-0 h-full w-80 max-w-[85vw] bg-white shadow-2xl dark:bg-surface-900">
            <div className="flex items-center justify-between border-b border-surface-200 px-4 py-3 dark:border-surface-800">
              <span className="text-sm font-semibold">Course content</span>
              <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-surface-100 dark:hover:bg-surface-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}
    </>
  )
}
