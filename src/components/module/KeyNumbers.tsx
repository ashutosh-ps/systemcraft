import { motion } from 'framer-motion'
import { Gauge } from 'lucide-react'
import type { KeyNumber } from '../../lib/types'

export function KeyNumbers({ numbers }: { numbers: KeyNumber[] }) {
  return (
    <div className="rounded-xl border border-surface-200 bg-white p-5 dark:border-surface-700 dark:bg-surface-900">
      <div className="mb-4 flex items-center gap-2">
        <Gauge className="h-4 w-4 text-brand-500" />
        <h3 className="text-sm font-bold text-surface-900 dark:text-surface-100">Numbers worth memorizing</h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {numbers.map((n, i) => (
          <motion.div
            key={n.metric}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.05 }}
            className="rounded-lg bg-surface-100 p-4 dark:bg-surface-850"
          >
            <p className="font-mono text-lg font-bold text-brand-600 tabular-nums dark:text-brand-400">{n.value}</p>
            <p className="mt-0.5 text-xs font-semibold text-surface-900 dark:text-surface-100">{n.metric}</p>
            <p className="mt-1 text-xs leading-snug text-surface-500 dark:text-surface-400">{n.context}</p>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
