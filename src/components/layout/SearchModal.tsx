import { AnimatePresence, motion } from 'framer-motion'
import { Clock, FileText, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { orderedModules, getCategory } from '../../data/course'
import type { Module } from '../../lib/types'

interface SearchHit {
  module: Module
  /** Higher is better */
  score: number
  matchedOn: string
}

function searchModules(query: string): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: SearchHit[] = []
  for (const mod of orderedModules) {
    let score = 0
    let matchedOn = ''
    if (mod.title.toLowerCase().includes(q)) {
      score += 10
      matchedOn = mod.title
    }
    if (mod.description.toLowerCase().includes(q)) {
      score += 5
      matchedOn = matchedOn || mod.description
    }
    for (const kw of mod.keywords) {
      if (kw.toLowerCase().includes(q)) {
        score += 3
        matchedOn = matchedOn || `keyword: ${kw}`
      }
    }
    for (const s of mod.sections) {
      if (s.title?.toLowerCase().includes(q)) {
        score += 2
        matchedOn = matchedOn || `section: ${s.title}`
      }
    }
    if (score > 0) hits.push({ module: mod, score, matchedOn })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 8)
}

/** Mounted fresh each time the modal opens, so query/selection state resets naturally. */
function SearchPanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const navigate = useNavigate()

  const hits = useMemo(() => searchModules(query), [query])
  const safeSelected = Math.min(selected, Math.max(hits.length - 1, 0))

  const go = (mod: Module) => {
    onClose()
    navigate(`/module/${mod.id}`)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(Math.min(safeSelected + 1, hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(Math.max(safeSelected - 1, 0))
    } else if (e.key === 'Enter' && hits[safeSelected]) {
      go(hits[safeSelected].module)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: -12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -12 }}
      transition={{ duration: 0.15 }}
      className="w-full max-w-xl overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-2xl dark:border-surface-700 dark:bg-surface-900"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-3 border-b border-surface-200 px-4 dark:border-surface-700">
        <Search className="h-5 w-5 text-surface-400" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search modules, topics, keywords…"
          className="w-full bg-transparent py-4 text-sm outline-none placeholder:text-surface-400"
        />
        <kbd className="rounded border border-surface-300 px-1.5 py-0.5 font-mono text-[10px] text-surface-400 dark:border-surface-600">
          esc
        </kbd>
      </div>

      {query && hits.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-surface-400">No results for “{query}”</p>
      )}

      {hits.length > 0 && (
        <ul className="max-h-80 overflow-y-auto py-2">
          {hits.map((hit, i) => (
            <li key={hit.module.id}>
              <button
                onClick={() => go(hit.module)}
                onMouseEnter={() => setSelected(i)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left ${
                  i === safeSelected ? 'bg-brand-50 dark:bg-brand-950/50' : ''
                }`}
              >
                <FileText className="h-4 w-4 shrink-0 text-brand-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-surface-900 dark:text-surface-100">
                    {hit.module.title}
                  </span>
                  <span className="block truncate text-xs text-surface-400">
                    {getCategory(hit.module.category).title} · {hit.matchedOn}
                  </span>
                </span>
                <span className="flex items-center gap-1 text-xs text-surface-400">
                  <Clock className="h-3 w-3" />
                  {hit.module.estMinutes}m
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!query && (
        <p className="px-4 py-6 text-center text-xs text-surface-400">
          Try “caching”, “raft”, “rate limiting”, or “youtube”
        </p>
      )}
    </motion.div>
  )
}

export function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh] backdrop-blur-sm"
          onClick={onClose}
        >
          <SearchPanel onClose={onClose} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
