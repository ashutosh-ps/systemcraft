import { motion } from 'framer-motion'
import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import type { BeforeAfterSpec } from '../../lib/types'

export function BeforeAfter({ scenario }: { scenario: BeforeAfterSpec }) {
  const [showAfter, setShowAfter] = useState(false)

  return (
    <div className="rounded-xl border border-surface-200 bg-white p-5 dark:border-surface-700 dark:bg-surface-900">
      <div className="mb-4 flex items-center justify-center gap-3">
        <button
          onClick={() => setShowAfter(false)}
          className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
            !showAfter
              ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
              : 'text-surface-400 hover:text-surface-600 dark:hover:text-surface-300'
          }`}
        >
          Before
        </button>
        <ArrowRight className="h-4 w-4 text-surface-300" />
        <button
          onClick={() => setShowAfter(true)}
          className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
            showAfter
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
              : 'text-surface-400 hover:text-surface-600 dark:hover:text-surface-300'
          }`}
        >
          After
        </button>
      </div>

      <motion.div
        key={showAfter ? 'after' : 'before'}
        initial={{ opacity: 0, x: showAfter ? 24 : -24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-xl bg-surface-100 p-5 dark:bg-surface-850"
      >
        <p className="font-bold text-surface-900 dark:text-white">
          {showAfter ? scenario.afterTitle : scenario.beforeTitle}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-surface-600 dark:text-surface-300">
          {showAfter ? scenario.afterDescription : scenario.beforeDescription}
        </p>
      </motion.div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {scenario.metrics.map((m) => (
          <div key={m.label} className="rounded-lg border border-surface-200 p-3 text-center dark:border-surface-700">
            <p className="text-[11px] font-medium text-surface-400 uppercase">{m.label}</p>
            <p className="mt-1 font-mono text-sm font-bold tabular-nums">
              <span className={showAfter ? 'text-surface-400 line-through' : 'text-surface-900 dark:text-white'}>
                {m.before}
              </span>
              {showAfter && (
                <span className="ml-2 inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  {m.after}
                  {m.improved ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                </span>
              )}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
