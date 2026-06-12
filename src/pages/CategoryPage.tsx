import { motion } from 'framer-motion'
import { CheckCircle2, Clock } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { DifficultyBadge } from '../components/module/ModuleExtras'
import { useProgress } from '../context/ProgressContext'
import { categories, modulesInCategory } from '../data/course'
import type { CategoryId } from '../lib/types'
import { NotFoundPage } from './NotFoundPage'

export function CategoryPage() {
  const { categoryId } = useParams()
  const category = categories.find((c) => c.id === categoryId)
  const { completed } = useProgress()

  if (!category) return <NotFoundPage />

  const mods = modulesInCategory(category.id as CategoryId)
  const totalMin = mods.reduce((s, m) => s + m.estMinutes, 0)

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-10">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-extrabold tracking-tight text-surface-900 dark:text-white">{category.title}</h1>
        <p className="mt-2 text-surface-500 dark:text-surface-400">{category.tagline}</p>
        <p className="mt-3 flex items-center gap-1.5 text-sm text-surface-400">
          <Clock className="h-4 w-4" />
          {mods.length} modules · ~{Math.round(totalMin / 60)} hours
        </p>
      </motion.div>

      <div className="mt-8 space-y-3">
        {mods.map((m, i) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Link
              to={`/module/${m.id}`}
              className="group flex items-center gap-4 rounded-2xl border border-surface-200 bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-md dark:border-surface-700 dark:bg-surface-900 dark:hover:border-brand-500"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-100 font-mono text-sm font-bold text-surface-500 dark:bg-surface-850 dark:text-surface-400">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-semibold text-surface-900 group-hover:text-brand-600 dark:text-surface-100 dark:group-hover:text-brand-400">
                    {m.title}
                  </span>
                  {completed[m.id] && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-sm text-surface-500 dark:text-surface-400">
                  {m.description}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1.5">
                <DifficultyBadge level={m.difficulty} />
                <span className="text-xs text-surface-400">{m.estMinutes} min</span>
              </span>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
