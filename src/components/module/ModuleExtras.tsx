import { AlertTriangle, ChevronDown, Cloud, Link2, MessageCircleQuestion } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getModule } from '../../data/course'
import type { CloudMapping, Difficulty, InterviewQuestion } from '../../lib/types'

const DIFF_STYLE: Record<Difficulty, string> = {
  Junior: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  Mid: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  Senior: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
}

export function DifficultyBadge({ level }: { level: Difficulty }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${DIFF_STYLE[level]}`}>{level}</span>
  )
}

export function InterviewQuestions({ questions }: { questions: InterviewQuestion[] }) {
  const [open, setOpen] = useState<number | null>(null)
  if (!questions.length) return null
  return (
    <section className="rounded-2xl border border-surface-200 bg-white p-6 dark:border-surface-700 dark:bg-surface-900">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-surface-900 dark:text-surface-100">
        <MessageCircleQuestion className="h-5 w-5 text-brand-500" />
        Interview questions
      </h2>
      <ul className="space-y-2">
        {questions.map((q, i) => (
          <li key={i} className="overflow-hidden rounded-xl border border-surface-200 dark:border-surface-700">
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-surface-50 dark:hover:bg-surface-850"
            >
              <DifficultyBadge level={q.difficulty} />
              <span className="flex-1 font-medium text-surface-800 dark:text-surface-200">{q.question}</span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-surface-400 transition-transform ${open === i ? 'rotate-180' : ''}`}
              />
            </button>
            {open === i && (
              <p className="border-t border-surface-200 bg-surface-50 px-4 py-3 text-sm leading-relaxed text-surface-600 dark:border-surface-700 dark:bg-surface-850 dark:text-surface-300">
                <span className="font-semibold text-surface-900 dark:text-surface-100">How to approach it: </span>
                {q.hint}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function CommonMistakes({ mistakes }: { mistakes: string[] }) {
  if (!mistakes.length) return null
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-6 dark:border-amber-900/60 dark:bg-amber-950/20">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-surface-900 dark:text-surface-100">
        <AlertTriangle className="h-5 w-5 text-amber-500" />
        Common mistakes
      </h2>
      <ul className="space-y-2.5">
        {mistakes.map((m, i) => (
          <li key={i} className="flex gap-3 text-sm leading-relaxed text-surface-700 dark:text-surface-300">
            <span className="mt-0.5 font-mono text-xs font-bold text-amber-500">✕</span>
            {m}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function CloudMappings({ mappings }: { mappings: CloudMapping[] }) {
  if (!mappings.length) return null
  return (
    <section className="rounded-2xl border border-surface-200 bg-white p-6 dark:border-surface-700 dark:bg-surface-900">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-surface-900 dark:text-surface-100">
        <Cloud className="h-5 w-5 text-brand-500" />
        Cloud service mappings
      </h2>
      <div className="sc-scroll overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200 text-left dark:border-surface-700">
              <th className="py-2 pr-4 font-semibold text-surface-900 dark:text-surface-100">Concept</th>
              <th className="py-2 pr-4 font-semibold text-orange-600 dark:text-orange-400">AWS</th>
              <th className="py-2 pr-4 font-semibold text-blue-600 dark:text-blue-400">GCP</th>
              <th className="py-2 font-semibold text-sky-600 dark:text-sky-400">Azure</th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m, i) => (
              <tr key={i} className="border-b border-surface-100 last:border-0 dark:border-surface-800">
                <td className="py-2.5 pr-4 font-medium text-surface-800 dark:text-surface-200">{m.concept}</td>
                <td className="py-2.5 pr-4 text-surface-600 dark:text-surface-300">{m.aws}</td>
                <td className="py-2.5 pr-4 text-surface-600 dark:text-surface-300">{m.gcp}</td>
                <td className="py-2.5 text-surface-600 dark:text-surface-300">{m.azure}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function RelatedTopics({ ids }: { ids: string[] }) {
  const related = ids.map(getModule).filter((m): m is NonNullable<ReturnType<typeof getModule>> => Boolean(m))
  if (!related.length) return null
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold tracking-wide text-surface-500 uppercase dark:text-surface-400">
        <Link2 className="h-4 w-4" />
        Related topics
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {related.map((m) => (
          <Link
            key={m.id}
            to={`/module/${m.id}`}
            className="group rounded-xl border border-surface-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-md dark:border-surface-700 dark:bg-surface-900 dark:hover:border-brand-500"
          >
            <p className="text-sm font-semibold text-surface-900 group-hover:text-brand-600 dark:text-surface-100 dark:group-hover:text-brand-400">
              {m.title}
            </p>
            <p className="mt-1 line-clamp-2 text-xs leading-snug text-surface-500 dark:text-surface-400">
              {m.description}
            </p>
            <p className="mt-2 text-[11px] text-surface-400">{m.estMinutes} min</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
