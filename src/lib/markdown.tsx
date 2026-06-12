import React from 'react'
import { Link } from 'react-router-dom'

/**
 * Minimal markdown renderer covering the subset used by course content:
 * ###/#### headings, paragraphs, - and 1. lists, > blockquotes,
 * **bold**, *italic*, `code`, [text](url). Internal links (starting with /)
 * render as router Links.
 */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  // Tokenize: code spans first (no nesting inside), then bold, italic, links
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyPrefix}-${i++}`
    if (tok.startsWith('`')) {
      out.push(
        <code
          key={key}
          className="rounded bg-surface-200/70 px-1.5 py-0.5 font-mono text-[0.85em] text-brand-700 dark:bg-surface-800 dark:text-brand-300"
        >
          {tok.slice(1, -1)}
        </code>,
      )
    } else if (tok.startsWith('**')) {
      out.push(
        <strong key={key} className="font-semibold text-surface-900 dark:text-surface-100">
          {renderInline(tok.slice(2, -2), key)}
        </strong>,
      )
    } else if (tok.startsWith('*')) {
      out.push(<em key={key}>{renderInline(tok.slice(1, -1), key)}</em>)
    } else {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!
      const [, label, href] = lm
      if (href.startsWith('/')) {
        out.push(
          <Link key={key} to={href} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            {label}
          </Link>,
        )
      } else {
        out.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            {label}
          </a>,
        )
      }
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

type Block =
  | { kind: 'h3' | 'h4' | 'p' | 'quote'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }

function parseBlocks(md: string): Block[] {
  const lines = md.split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  let quote: string[] = []
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null

  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: 'p', text: para.join(' ') })
      para = []
    }
  }
  const flushQuote = () => {
    if (quote.length) {
      blocks.push({ kind: 'quote', text: quote.join(' ') })
      quote = []
    }
  }
  const flushList = () => {
    if (list) {
      blocks.push(list)
      list = null
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const trimmed = line.trim()
    if (!trimmed) {
      flushPara()
      flushQuote()
      flushList()
      continue
    }
    if (trimmed.startsWith('#### ')) {
      flushPara()
      flushQuote()
      flushList()
      blocks.push({ kind: 'h4', text: trimmed.slice(5) })
    } else if (trimmed.startsWith('### ')) {
      flushPara()
      flushQuote()
      flushList()
      blocks.push({ kind: 'h3', text: trimmed.slice(4) })
    } else if (trimmed.startsWith('>')) {
      flushPara()
      flushList()
      quote.push(trimmed.replace(/^>\s?/, ''))
    } else if (/^[-*] /.test(trimmed)) {
      flushPara()
      flushQuote()
      if (!list || list.kind !== 'ul') {
        flushList()
        list = { kind: 'ul', items: [] }
      }
      list.items.push(trimmed.slice(2))
    } else if (/^\d+\. /.test(trimmed)) {
      flushPara()
      flushQuote()
      if (!list || list.kind !== 'ol') {
        flushList()
        list = { kind: 'ol', items: [] }
      }
      list.items.push(trimmed.replace(/^\d+\. /, ''))
    } else {
      flushList()
      flushQuote()
      para.push(trimmed)
    }
  }
  flushPara()
  flushQuote()
  flushList()
  return blocks
}

export function Markdown({ md }: { md: string }) {
  const blocks = parseBlocks(md)
  return (
    <div className="sc-prose space-y-4">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'h3':
            return (
              <h3 key={i} className="pt-2 text-lg font-semibold text-surface-900 dark:text-surface-100">
                {renderInline(b.text, `h3-${i}`)}
              </h3>
            )
          case 'h4':
            return (
              <h4 key={i} className="pt-1 text-base font-semibold text-surface-900 dark:text-surface-100">
                {renderInline(b.text, `h4-${i}`)}
              </h4>
            )
          case 'quote':
            return (
              <blockquote
                key={i}
                className="rounded-r-lg border-l-4 border-brand-400 bg-brand-50 px-4 py-3 text-surface-700 dark:border-brand-500 dark:bg-brand-950/40 dark:text-surface-300"
              >
                {renderInline(b.text, `q-${i}`)}
              </blockquote>
            )
          case 'ul':
            return (
              <ul key={i} className="list-disc space-y-1.5 pl-6 marker:text-brand-500">
                {b.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `ul-${i}-${j}`)}</li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={i} className="list-decimal space-y-1.5 pl-6 marker:font-semibold marker:text-brand-500">
                {b.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `ol-${i}-${j}`)}</li>
                ))}
              </ol>
            )
          default:
            return <p key={i}>{renderInline(b.text, `p-${i}`)}</p>
        }
      })}
    </div>
  )
}
