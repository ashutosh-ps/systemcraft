import { Lightbulb } from 'lucide-react'
import type { ComparisonSpec } from '../../lib/types'

export function ComparisonTable({ comparison }: { comparison: ComparisonSpec }) {
  const { columns, rows, verdict } = comparison
  return (
    <div className="overflow-hidden rounded-xl border border-surface-200 dark:border-surface-700">
      <div className="sc-scroll overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-surface-100 dark:bg-surface-850">
              {columns.map((c, i) => (
                <th
                  key={i}
                  className={`px-4 py-3 text-left font-semibold text-surface-900 dark:text-surface-100 ${
                    i === 0 ? 'w-44' : ''
                  }`}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className="border-t border-surface-200 bg-white even:bg-surface-50 dark:border-surface-700 dark:bg-surface-900 dark:even:bg-surface-850/50"
              >
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className={`px-4 py-3 align-top leading-snug ${
                      j === 0
                        ? 'font-medium text-surface-900 dark:text-surface-100'
                        : 'text-surface-600 dark:text-surface-300'
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {verdict && (
        <p className="flex items-start gap-2 border-t border-surface-200 bg-brand-50/60 px-4 py-3 text-sm text-surface-700 dark:border-surface-700 dark:bg-brand-950/30 dark:text-surface-300">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
          <span>
            <span className="font-semibold">Rule of thumb:</span> {verdict}
          </span>
        </p>
      )}
    </div>
  )
}
