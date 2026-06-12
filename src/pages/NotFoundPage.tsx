import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="font-mono text-6xl font-bold text-surface-300 dark:text-surface-700">404</p>
      <p className="mt-4 text-lg font-semibold text-surface-900 dark:text-surface-100">Page not found</p>
      <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
        That route doesn't resolve — maybe it was sharded somewhere else.
      </p>
      <Link
        to="/"
        className="mt-6 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
      >
        Back to the course
      </Link>
    </div>
  )
}
