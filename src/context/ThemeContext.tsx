import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

interface ThemeContextValue {
  dark: boolean
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue>({ dark: false, toggle: () => {} })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem('sc-theme', dark ? 'dark' : 'light')
    } catch {
      // private mode — theme just won't persist
    }
  }, [dark])

  const toggle = useCallback(() => setDark((d) => !d), [])

  return <ThemeContext.Provider value={{ dark, toggle }}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- co-locating the hook with its provider is worth losing fast-refresh here
export function useTheme() {
  return useContext(ThemeContext)
}
