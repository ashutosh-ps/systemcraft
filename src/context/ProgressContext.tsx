import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

interface ProgressState {
  /** module id -> completed */
  completed: Record<string, boolean>
  /** module id -> best quiz score (0..1) */
  quizScores: Record<string, number>
}

interface ProgressContextValue extends ProgressState {
  markComplete: (moduleId: string) => void
  markIncomplete: (moduleId: string) => void
  recordQuizScore: (moduleId: string, score: number) => void
  resetAll: () => void
}

const STORAGE_KEY = 'sc-progress'

function load(): ProgressState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { completed: parsed.completed ?? {}, quizScores: parsed.quizScores ?? {} }
    }
  } catch {
    // corrupted storage. Start fresh
  }
  return { completed: {}, quizScores: {} }
}

const ProgressContext = createContext<ProgressContextValue>({
  completed: {},
  quizScores: {},
  markComplete: () => {},
  markIncomplete: () => {},
  recordQuizScore: () => {},
  resetAll: () => {},
})

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ProgressState>(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // storage unavailable. Progress just won't persist
    }
  }, [state])

  const markComplete = useCallback((id: string) => {
    setState((s) => ({ ...s, completed: { ...s.completed, [id]: true } }))
  }, [])

  const markIncomplete = useCallback((id: string) => {
    setState((s) => {
      const completed = { ...s.completed }
      delete completed[id]
      return { ...s, completed }
    })
  }, [])

  const recordQuizScore = useCallback((id: string, score: number) => {
    setState((s) => ({
      ...s,
      quizScores: { ...s.quizScores, [id]: Math.max(s.quizScores[id] ?? 0, score) },
    }))
  }, [])

  const resetAll = useCallback(() => setState({ completed: {}, quizScores: {} }), [])

  return (
    <ProgressContext.Provider value={{ ...state, markComplete, markIncomplete, recordQuizScore, resetAll }}>
      {children}
    </ProgressContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- co-locating the hook with its provider is worth losing fast-refresh here
export function useProgress() {
  return useContext(ProgressContext)
}
