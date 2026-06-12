import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, Clock, Download, Printer } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { CommonMistakes, CloudMappings, DifficultyBadge, InterviewQuestions, RelatedTopics } from '../components/module/ModuleExtras'
import { Quiz } from '../components/module/Quiz'
import { SectionRenderer } from '../components/module/SectionRenderer'
import { useProgress } from '../context/ProgressContext'
import { adjacentModules, getCategory, getModule } from '../data/course'
import { downloadModuleNotes } from '../lib/download'
import { NotFoundPage } from './NotFoundPage'

export function ModulePage() {
  const { moduleId } = useParams()
  const mod = moduleId ? getModule(moduleId) : undefined
  const { completed, markComplete, markIncomplete } = useProgress()

  if (!mod) return <NotFoundPage />

  const category = getCategory(mod.category)
  const { prev, next } = adjacentModules(mod.id)
  const isDone = Boolean(completed[mod.id])

  return (
    <div className="print-full mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-10" key={mod.id}>
      {/* Header */}
      <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <nav className="no-print mb-3 text-xs text-surface-400">
          <Link to="/" className="hover:text-brand-500">
            Home
          </Link>
          <span className="mx-1.5">/</span>
          <Link to={`/category/${category.id}`} className="hover:text-brand-500">
            {category.title}
          </Link>
        </nav>

        <h1 className="text-3xl font-extrabold tracking-tight text-surface-900 dark:text-white">{mod.title}</h1>
        <p className="mt-2 text-base leading-relaxed text-surface-500 dark:text-surface-400">{mod.description}</p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <DifficultyBadge level={mod.difficulty} />
          <span className="flex items-center gap-1.5 text-xs text-surface-500 dark:text-surface-400">
            <Clock className="h-3.5 w-3.5" />
            ~{mod.estMinutes} min
          </span>
          <span className="flex-1" />
          <button
            onClick={() => downloadModuleNotes(mod)}
            className="no-print flex items-center gap-1.5 rounded-lg border border-surface-300 px-3 py-1.5 text-xs font-medium text-surface-600 hover:bg-surface-100 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-800"
            title="Download notes as Markdown"
          >
            <Download className="h-3.5 w-3.5" />
            Notes
          </button>
          <button
            onClick={() => window.print()}
            className="no-print flex items-center gap-1.5 rounded-lg border border-surface-300 px-3 py-1.5 text-xs font-medium text-surface-600 hover:bg-surface-100 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-800"
            title="Print or save as PDF"
          >
            <Printer className="h-3.5 w-3.5" />
            PDF
          </button>
          <button
            onClick={() => (isDone ? markIncomplete(mod.id) : markComplete(mod.id))}
            className={`no-print flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              isDone
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                : 'bg-brand-600 text-white hover:bg-brand-700'
            }`}
          >
            {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
            {isDone ? 'Completed' : 'Mark complete'}
          </button>
        </div>
      </motion.header>

      <hr className="my-8 border-surface-200 dark:border-surface-800" />

      {/* Content sections */}
      <div className="space-y-10">
        {mod.sections.map((section, i) => (
          <SectionRenderer key={i} section={section} index={i} />
        ))}
      </div>

      {/* Extras */}
      <div className="mt-12 space-y-8">
        <CloudMappings mappings={mod.cloudMappings} />
        <CommonMistakes mistakes={mod.commonMistakes} />
        <InterviewQuestions questions={mod.interviewQuestions} />
        <div className="no-print">
          <Quiz moduleId={mod.id} questions={mod.quiz} />
        </div>
        <RelatedTopics ids={mod.related} />
      </div>

      {/* Prev / next */}
      <nav className="no-print mt-12 flex gap-3 border-t border-surface-200 pt-6 dark:border-surface-800">
        {prev && (
          <Link
            to={`/module/${prev.id}`}
            className="group flex flex-1 items-center gap-3 rounded-xl border border-surface-200 p-4 hover:border-brand-400 dark:border-surface-700 dark:hover:border-brand-500"
          >
            <ArrowLeft className="h-4 w-4 shrink-0 text-surface-400 group-hover:text-brand-500" />
            <span className="min-w-0">
              <span className="block text-[11px] text-surface-400 uppercase">Previous</span>
              <span className="block truncate text-sm font-semibold text-surface-800 dark:text-surface-200">
                {prev.title}
              </span>
            </span>
          </Link>
        )}
        {next && (
          <Link
            to={`/module/${next.id}`}
            className="group ml-auto flex flex-1 items-center justify-end gap-3 rounded-xl border border-surface-200 p-4 text-right hover:border-brand-400 dark:border-surface-700 dark:hover:border-brand-500"
          >
            <span className="min-w-0">
              <span className="block text-[11px] text-surface-400 uppercase">Next</span>
              <span className="block truncate text-sm font-semibold text-surface-800 dark:text-surface-200">
                {next.title}
              </span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-surface-400 group-hover:text-brand-500" />
          </Link>
        )}
      </nav>
    </div>
  )
}
