import { Check, Copy } from 'lucide-react'
import React, { useState } from 'react'

/**
 * Lightweight regex-based syntax highlighter — enough for the short
 * pseudo-code, SQL, JS/TS, Python, JSON and shell snippets in course content.
 */

const KEYWORDS: Record<string, string[]> = {
  default: [
    'function', 'return', 'if', 'else', 'for', 'while', 'const', 'let', 'var', 'class', 'new', 'import',
    'from', 'export', 'async', 'await', 'try', 'catch', 'throw', 'switch', 'case', 'break', 'continue',
    'def', 'lambda', 'pass', 'raise', 'with', 'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False',
    'null', 'undefined', 'true', 'false', 'interface', 'type', 'extends', 'implements', 'public', 'private',
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE',
    'INDEX', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'ON', 'GROUP', 'BY', 'ORDER', 'LIMIT', 'PRIMARY', 'KEY',
    'NOT', 'NULL', 'UNIQUE', 'AND', 'OR', 'AS', 'HAVING', 'COUNT', 'SUM', 'AVG', 'DISTINCT', 'BIGINT',
    'VARCHAR', 'TIMESTAMP', 'PARTITION', 'SHARD',
  ],
}

interface Token {
  text: string
  cls?: string
}

function tokenize(code: string): Token[] {
  const tokens: Token[] = []
  // Order matters: comments, strings, numbers, keywords, identifiers
  const re =
    /(\/\/[^\n]*|#[^\n]*|--[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_]*\.?\d*(?:e[+-]?\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|([^\s\w]+|\s+)/g
  let m: RegExpExecArray | null
  const kw = new Set(KEYWORDS.default)
  while ((m = re.exec(code)) !== null) {
    const [, comment, str, num, word, rest] = m
    if (comment !== undefined) tokens.push({ text: comment, cls: 'text-surface-400 italic dark:text-surface-500' })
    else if (str !== undefined) tokens.push({ text: str, cls: 'text-emerald-600 dark:text-emerald-400' })
    else if (num !== undefined) tokens.push({ text: num, cls: 'text-amber-600 dark:text-amber-400' })
    else if (word !== undefined) {
      if (kw.has(word)) tokens.push({ text: word, cls: 'text-brand-600 font-semibold dark:text-brand-400' })
      else tokens.push({ text: word })
    } else if (rest !== undefined) tokens.push({ text: rest })
  }
  return tokens
}

export function CodeBlock({ title, language, code }: { title?: string; language: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const tokens = tokenize(code.trim())

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.trim())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable (e.g. insecure context) — silently ignore
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-surface-200 dark:border-surface-700">
      <div className="flex items-center justify-between border-b border-surface-200 bg-surface-100 px-4 py-2 dark:border-surface-700 dark:bg-surface-850">
        <div className="flex items-center gap-2">
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          <span className="ml-2 text-xs font-medium text-surface-500 dark:text-surface-400">
            {title ?? language}
          </span>
        </div>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-surface-500 hover:bg-surface-200 dark:text-surface-400 dark:hover:bg-surface-800"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="sc-scroll overflow-x-auto bg-white p-4 text-[13px] leading-relaxed dark:bg-surface-900">
        <code className="font-mono">
          {tokens.map((t, i) =>
            t.cls ? (
              <span key={i} className={t.cls}>
                {t.text}
              </span>
            ) : (
              <React.Fragment key={i}>{t.text}</React.Fragment>
            ),
          )}
        </code>
      </pre>
    </div>
  )
}
