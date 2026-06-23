import { AnimatePresence, motion } from 'framer-motion'
import { Award, Brain, ChevronLeft, ChevronRight, RotateCcw, Shuffle, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { flashcardKindLabel, moduleToFlashcards, type Flashcard, type FlashcardKind } from '../../lib/flashcards'
import type { Module } from '../../lib/types'

const KIND_CHIP: Record<FlashcardKind, string> = {
  number: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300',
  tradeoff: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
  pitfall: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  interview: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
}

/** Fisher–Yates shuffle (called only from event handlers, never during render). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function Flashcards({ module }: { module: Module }) {
  const cards = useMemo(() => moduleToFlashcards(module), [module])
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])

  const [open, setOpen] = useState(false)
  const [order, setOrder] = useState<string[]>([])
  const [idx, setIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [finished, setFinished] = useState(false)

  const start = () => {
    setOrder(shuffle(cards.map((c) => c.id)))
    setIdx(0)
    setFlipped(false)
    setFinished(false)
    setOpen(true)
  }

  const next = () => {
    if (idx + 1 >= order.length) {
      setFinished(true)
      return
    }
    setIdx(idx + 1)
    setFlipped(false)
  }

  const prev = () => {
    if (idx === 0) return
    setIdx(idx - 1)
    setFlipped(false)
  }

  const reshuffle = () => {
    setOrder(shuffle(cards.map((c) => c.id)))
    setIdx(0)
    setFlipped(false)
    setFinished(false)
  }

  const close = () => {
    setOpen(false)
    setFlipped(false)
  }

  const current = open && !finished ? byId.get(order[idx]) : undefined

  if (cards.length === 0) return null

  return (
    <section className="rounded-2xl border border-surface-200 bg-white p-6 dark:border-surface-700 dark:bg-surface-900">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 text-white">
          <Brain className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-bold text-surface-900 dark:text-surface-100">
            Flashcards
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
              {cards.length} cards
            </span>
          </h2>
          <p className="mt-0.5 text-sm text-surface-500 dark:text-surface-400">
            Flip through this module's numbers, trade-offs, pitfalls & interview questions to test yourself.
          </p>
        </div>
        <button
          onClick={start}
          className="flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-brand-600/25 transition-all hover:bg-brand-700"
        >
          <Shuffle className="h-4 w-4" /> Practice
        </button>
      </div>

      {/* Practice modal */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={close}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              className="w-full max-w-lg overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-2xl dark:border-surface-700 dark:bg-surface-900"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center gap-3 border-b border-surface-200 px-4 py-3 dark:border-surface-700">
                <Brain className="h-4 w-4 text-brand-500" />
                <span className="truncate text-sm font-semibold text-surface-900 dark:text-surface-100">
                  {module.title}
                </span>
                <span className="ml-auto text-xs text-surface-400">
                  {finished ? `${order.length} cards` : `${idx + 1} / ${order.length}`}
                </span>
                {!finished && (
                  <button
                    onClick={reshuffle}
                    title="Shuffle"
                    className="rounded-lg p-1 text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800 dark:hover:text-surface-200"
                  >
                    <Shuffle className="h-4 w-4" />
                  </button>
                )}
                <button onClick={close} className="rounded-lg p-1 text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Progress */}
              <div className="h-1 w-full bg-surface-100 dark:bg-surface-800">
                <div
                  className="h-full bg-brand-500 transition-all duration-300"
                  style={{ width: `${order.length ? ((finished ? order.length : idx) / order.length) * 100 : 0}%` }}
                />
              </div>

              {finished ? (
                <div className="px-6 py-10 text-center">
                  <Award className="mx-auto h-12 w-12 text-emerald-500" />
                  <p className="mt-3 text-2xl font-bold text-surface-900 dark:text-surface-100">Deck complete</p>
                  <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                    You flipped through all {order.length} cards.
                  </p>
                  <div className="mt-6 flex justify-center gap-3">
                    <button
                      onClick={reshuffle}
                      className="inline-flex items-center gap-2 rounded-lg border border-surface-300 px-4 py-2 text-sm font-medium hover:bg-surface-100 dark:border-surface-600 dark:hover:bg-surface-800"
                    >
                      <RotateCcw className="h-4 w-4" /> Shuffle & restart
                    </button>
                    <button onClick={close} className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                      Done
                    </button>
                  </div>
                </div>
              ) : current ? (
                <div className="p-5">
                  {/* key per card → each new card mounts fresh on its question side
                      (no rotate-back animation that would briefly flash the next answer) */}
                  <FlipCard key={current.id} card={current} flipped={flipped} onFlip={() => setFlipped((f) => !f)} />

                  {/* Navigation */}
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <button
                      onClick={prev}
                      disabled={idx === 0}
                      className="flex items-center gap-1 rounded-lg border border-surface-200 px-4 py-2 text-sm font-medium text-surface-600 transition-colors hover:bg-surface-100 disabled:opacity-40 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800"
                    >
                      <ChevronLeft className="h-4 w-4" /> Prev
                    </button>
                    <button
                      onClick={next}
                      className="flex items-center gap-1 rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
                    >
                      {idx + 1 >= order.length ? 'Finish' : 'Next'} <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : null}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

function FlipCard({ card, flipped, onFlip }: { card: Flashcard; flipped: boolean; onFlip: () => void }) {
  return (
    <div style={{ perspective: 1200 }}>
      <motion.div
        initial={false}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.5, ease: 'easeInOut' }}
        style={{ transformStyle: 'preserve-3d', position: 'relative' }}
        className="h-64 w-full cursor-pointer"
        onClick={onFlip}
      >
        {/* Front */}
        <div
          style={{ backfaceVisibility: 'hidden' }}
          className="absolute inset-0 flex flex-col rounded-xl border border-surface-200 bg-surface-50 p-5 dark:border-surface-700 dark:bg-surface-850"
        >
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${KIND_CHIP[card.kind]}`}>
              {flashcardKindLabel(card.kind)}
            </span>
            {card.difficulty && <span className="text-[10px] font-medium text-surface-400">{card.difficulty}</span>}
          </div>
          <div className="flex flex-1 items-center justify-center">
            <p className="text-center text-lg font-semibold text-surface-900 dark:text-surface-100">{card.front}</p>
          </div>
          <p className="text-center text-xs text-surface-400">Click to reveal</p>
        </div>

        {/* Back */}
        <div
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          className="absolute inset-0 flex flex-col rounded-xl border-2 border-brand-300 bg-white p-5 dark:border-brand-700 dark:bg-surface-900"
        >
          <span className={`w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold ${KIND_CHIP[card.kind]}`}>Answer</span>
          <div className="sc-scroll mt-2 flex-1 overflow-y-auto">
            <p className="text-[15px] leading-relaxed text-surface-700 dark:text-surface-200">{card.back}</p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
