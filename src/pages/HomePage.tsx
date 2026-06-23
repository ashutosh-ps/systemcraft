import { motion } from 'framer-motion'
import { ArrowRight, BookOpen, Clock, Flame, GraduationCap, Layers, Search, Sparkles, Workflow } from 'lucide-react'
import { Link } from 'react-router-dom'
import { DifficultyBadge } from '../components/module/ModuleExtras'
import { useProgress } from '../context/ProgressContext'
import { categories, modulesInCategory, orderedModules, totalCourseMinutes } from '../data/course'

const POPULAR_IDS = ['caching', 'databases', 'design-instagram', 'sharding', 'load-balancing', 'design-uber']

const STATS = [
  { icon: BookOpen, value: '19', label: 'In-depth modules' },
  { icon: Clock, value: '~45h', label: 'Of guided content' },
  { icon: Workflow, value: '30+', label: 'Interactive diagrams' },
  { icon: GraduationCap, value: '95+', label: 'Quiz & interview questions' },
]

function Hero({ onSearch }: { onSearch: () => void }) {
  return (
    <section className="relative overflow-hidden">
      {/* Decorative grid + glow */}
      <div
        className="absolute inset-0 opacity-[0.04] dark:opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />
      <div className="absolute -top-40 left-1/2 h-96 w-[40rem] -translate-x-1/2 rounded-full bg-brand-500/20 blur-3xl" />

      <div className="relative mx-auto max-w-5xl px-4 py-20 text-center sm:py-28">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 dark:border-brand-800 dark:bg-brand-950/60 dark:text-brand-300">
            <Sparkles className="h-3.5 w-3.5" />
            Free · Interactive · Interview-focused
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-extrabold tracking-tight text-surface-900 sm:text-6xl dark:text-white">
            Master <span className="bg-gradient-to-r from-brand-500 to-violet-500 bg-clip-text text-transparent">System Design</span>, one interactive module at a time
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-surface-500 dark:text-surface-400">
            From load balancers to consensus algorithms to designing YouTube — 19 modules with clickable
            architecture diagrams, capacity calculators, real production numbers, and quizzes that make it stick.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/module/scalability"
              className="group flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-brand-600/25 transition-all hover:bg-brand-700 hover:shadow-brand-600/40"
            >
              Start learning
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <button
              onClick={onSearch}
              className="flex items-center gap-2 rounded-xl border border-surface-300 bg-white px-6 py-3 text-sm font-semibold text-surface-700 hover:border-surface-400 dark:border-surface-600 dark:bg-surface-900 dark:text-surface-200 dark:hover:border-surface-500"
            >
              <Search className="h-4 w-4" />
              Search topics
            </button>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

function StatsRow() {
  return (
    <section className="mx-auto max-w-5xl px-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STATS.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08 }}
            className="rounded-2xl border border-surface-200 bg-white p-5 text-center dark:border-surface-700 dark:bg-surface-900"
          >
            <s.icon className="mx-auto h-5 w-5 text-brand-500" />
            <p className="mt-2 text-2xl font-extrabold text-surface-900 tabular-nums dark:text-white">{s.value}</p>
            <p className="text-xs text-surface-400">{s.label}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

function LearningPath() {
  const { completed } = useProgress()
  return (
    <section className="mx-auto max-w-5xl px-4 py-20">
      <h2 className="text-center text-3xl font-extrabold tracking-tight text-surface-900 dark:text-white">
        Your learning path
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-center text-surface-500 dark:text-surface-400">
        Three stages, each building on the last. Finish all of them and you can hold your own in any design review.
      </p>

      <div className="relative mt-12 space-y-8 lg:space-y-0">
        {/* Connector line on large screens */}
        <div className="absolute top-8 right-[16%] left-[16%] hidden h-0.5 bg-gradient-to-r from-brand-300 via-violet-300 to-emerald-300 lg:block dark:from-brand-700 dark:via-violet-700 dark:to-emerald-700" />
        <div className="grid gap-6 lg:grid-cols-3">
          {categories.map((cat, i) => {
            const mods = modulesInCategory(cat.id)
            const done = mods.filter((m) => completed[m.id]).length
            const hours = Math.round(mods.reduce((s, m) => s + m.estMinutes, 0) / 60)
            const icons = [Layers, Flame, GraduationCap] as const
            const Icon = icons[i]
            return (
              <motion.div
                key={cat.id}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.12 }}
                className="relative"
              >
                <Link
                  to={`/category/${cat.id}`}
                  className="group block h-full rounded-2xl border border-surface-200 bg-white p-6 transition-all hover:-translate-y-1 hover:border-brand-400 hover:shadow-xl dark:border-surface-700 dark:bg-surface-900 dark:hover:border-brand-500"
                >
                  <span className="relative z-10 mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-lg lg:mx-0">
                    <Icon className="h-7 w-7" />
                  </span>
                  <p className="mt-4 text-xs font-bold tracking-wider text-brand-500 uppercase">Stage {i + 1}</p>
                  <h3 className="mt-1 text-xl font-bold text-surface-900 group-hover:text-brand-600 dark:text-white dark:group-hover:text-brand-400">
                    {cat.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-surface-500 dark:text-surface-400">{cat.tagline}</p>
                  <div className="mt-4 flex items-center justify-between text-xs text-surface-400">
                    <span>
                      {mods.length} modules · ~{hours}h
                    </span>
                    <span className="font-semibold text-brand-500">
                      {done}/{mods.length} done
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-100 dark:bg-surface-800">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-all duration-700"
                      style={{ width: `${mods.length ? (done / mods.length) * 100 : 0}%` }}
                    />
                  </div>
                </Link>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function PopularTopics() {
  const popular = POPULAR_IDS.map((id) => orderedModules.find((m) => m.id === id)).filter(
    (m): m is NonNullable<typeof m> => Boolean(m),
  )
  return (
    <section className="bg-surface-100/60 py-20 dark:bg-surface-900/40">
      <div className="mx-auto max-w-5xl px-4">
        <h2 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-surface-900 dark:text-white">
          <Flame className="h-6 w-6 text-orange-500" />
          Most popular topics
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {popular.map((m, i) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06 }}
            >
              <Link
                to={`/module/${m.id}`}
                className="group flex h-full flex-col rounded-2xl border border-surface-200 bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-md dark:border-surface-700 dark:bg-surface-900 dark:hover:border-brand-500"
              >
                <span className="flex items-center justify-between">
                  <DifficultyBadge level={m.difficulty} />
                  <span className="text-xs text-surface-400">{m.estMinutes} min</span>
                </span>
                <h3 className="mt-3 font-bold text-surface-900 group-hover:text-brand-600 dark:text-white dark:group-hover:text-brand-400">
                  {m.title}
                </h3>
                <p className="mt-1.5 line-clamp-2 flex-1 text-sm text-surface-500 dark:text-surface-400">
                  {m.description}
                </p>
                <span className="mt-3 flex items-center gap-1 text-xs font-semibold text-brand-500">
                  Start module <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function HomePage({ onSearch }: { onSearch: () => void }) {
  return (
    <div>
      <Hero onSearch={onSearch} />
      <StatsRow />
      <LearningPath />
      <PopularTopics />
      <footer className="border-t border-surface-200 py-10 text-center text-xs text-surface-400 dark:border-surface-800">
        <p>
          SystemCraft · {orderedModules.length} modules · ~{Math.round(totalCourseMinutes / 60)} hours of content ·
          Built with React, TypeScript, Tailwind & Framer Motion
        </p>
      </footer>
    </div>
  )
}
