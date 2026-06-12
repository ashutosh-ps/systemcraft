import { AnimatePresence, motion } from 'framer-motion'
import { Award, CheckCircle2, ChevronRight, HelpCircle, RotateCcw, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useProgress } from '../../context/ProgressContext'
import type { QuizQuestion } from '../../lib/types'

export function Quiz({ moduleId, questions }: { moduleId: string; questions: QuizQuestion[] }) {
  const { recordQuizScore, markComplete, quizScores } = useProgress()
  const [current, setCurrent] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [answers, setAnswers] = useState<boolean[]>([])
  const [finished, setFinished] = useState(false)

  const bestScore = quizScores[moduleId]
  const q = questions[current]
  const correctCount = answers.filter(Boolean).length

  const pick = (i: number) => {
    if (picked !== null) return
    setPicked(i)
    setAnswers((a) => [...a, i === q.answer])
  }

  const next = () => {
    if (current + 1 < questions.length) {
      setCurrent(current + 1)
      setPicked(null)
    } else {
      const score = answers.filter(Boolean).length / questions.length
      recordQuizScore(moduleId, score)
      if (score >= 0.6) markComplete(moduleId)
      setFinished(true)
    }
  }

  const restart = () => {
    setCurrent(0)
    setPicked(null)
    setAnswers([])
    setFinished(false)
  }

  if (questions.length === 0) return null

  return (
    <section className="rounded-2xl border border-surface-200 bg-white p-6 dark:border-surface-700 dark:bg-surface-900">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold text-surface-900 dark:text-surface-100">
          <HelpCircle className="h-5 w-5 text-brand-500" />
          Knowledge check
        </h2>
        {bestScore !== undefined && !finished && (
          <span className="text-xs text-surface-400">Best: {Math.round(bestScore * 100)}%</span>
        )}
      </div>

      <AnimatePresence mode="wait">
        {finished ? (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="py-6 text-center"
          >
            <Award
              className={`mx-auto h-12 w-12 ${
                correctCount / questions.length >= 0.6 ? 'text-emerald-500' : 'text-amber-500'
              }`}
            />
            <p className="mt-3 text-2xl font-bold text-surface-900 dark:text-surface-100">
              {correctCount} / {questions.length}
            </p>
            <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
              {correctCount / questions.length >= 0.6
                ? 'Nice — module marked complete. ✅'
                : 'Score 60%+ to mark this module complete. Review the sections above and retry.'}
            </p>
            <button
              onClick={restart}
              className="mt-5 inline-flex items-center gap-2 rounded-lg border border-surface-300 px-4 py-2 text-sm font-medium hover:bg-surface-100 dark:border-surface-600 dark:hover:bg-surface-800"
            >
              <RotateCcw className="h-4 w-4" /> Retake quiz
            </button>
          </motion.div>
        ) : (
          <motion.div key={current} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}>
            {/* Progress dots */}
            <div className="mb-4 flex items-center gap-1.5">
              {questions.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i < current
                      ? answers[i]
                        ? 'w-6 bg-emerald-400'
                        : 'w-6 bg-red-400'
                      : i === current
                        ? 'w-8 bg-brand-500'
                        : 'w-6 bg-surface-200 dark:bg-surface-700'
                  }`}
                />
              ))}
            </div>

            <p className="text-[15px] font-medium text-surface-900 dark:text-surface-100">
              {current + 1}. {q.question}
            </p>

            <div className="mt-4 space-y-2">
              {q.options.map((opt, i) => {
                const isCorrect = i === q.answer
                const isPicked = i === picked
                let cls =
                  'border-surface-200 hover:border-brand-400 hover:bg-brand-50/50 dark:border-surface-700 dark:hover:border-brand-500 dark:hover:bg-brand-950/30'
                if (picked !== null) {
                  if (isCorrect)
                    cls = 'border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-950/40'
                  else if (isPicked) cls = 'border-red-400 bg-red-50 dark:border-red-500 dark:bg-red-950/40'
                  else cls = 'border-surface-200 opacity-50 dark:border-surface-700'
                }
                return (
                  <button
                    key={i}
                    onClick={() => pick(i)}
                    disabled={picked !== null}
                    className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-sm transition-all ${cls}`}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-100 text-xs font-bold text-surface-500 dark:bg-surface-800 dark:text-surface-400">
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span className="flex-1">{opt}</span>
                    {picked !== null && isCorrect && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />}
                    {picked !== null && isPicked && !isCorrect && <XCircle className="h-5 w-5 shrink-0 text-red-500" />}
                  </button>
                )
              })}
            </div>

            <AnimatePresence>
              {picked !== null && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
                  <div className="mt-4 rounded-xl bg-surface-100 p-4 text-sm leading-relaxed text-surface-600 dark:bg-surface-850 dark:text-surface-300">
                    <span className="font-semibold text-surface-900 dark:text-surface-100">
                      {picked === q.answer ? 'Correct. ' : 'Not quite. '}
                    </span>
                    {q.explanation}
                  </div>
                  <button
                    onClick={next}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    {current + 1 < questions.length ? 'Next question' : 'See results'}
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
