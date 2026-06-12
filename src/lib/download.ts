import type { Module, Section } from './types'

/** Serialize a module to a readable markdown document for offline notes. */
export function moduleToMarkdown(mod: Module): string {
  const lines: string[] = []
  lines.push(`# ${mod.title}`)
  lines.push('')
  lines.push(`> ${mod.description}`)
  lines.push('')
  lines.push(`**Difficulty:** ${mod.difficulty} · **Estimated time:** ${mod.estMinutes} min`)
  lines.push('')

  for (const section of mod.sections) {
    lines.push(...sectionToMarkdown(section))
    lines.push('')
  }

  if (mod.cloudMappings.length) {
    lines.push('## Cloud service mappings')
    lines.push('')
    lines.push('| Concept | AWS | GCP | Azure |')
    lines.push('| --- | --- | --- | --- |')
    for (const m of mod.cloudMappings) {
      lines.push(`| ${m.concept} | ${m.aws} | ${m.gcp} | ${m.azure} |`)
    }
    lines.push('')
  }

  if (mod.commonMistakes.length) {
    lines.push('## Common mistakes')
    lines.push('')
    for (const m of mod.commonMistakes) lines.push(`- ${m}`)
    lines.push('')
  }

  if (mod.interviewQuestions.length) {
    lines.push('## Interview questions')
    lines.push('')
    for (const q of mod.interviewQuestions) {
      lines.push(`- **(${q.difficulty})** ${q.question}`)
      lines.push(`  - Hint: ${q.hint}`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('Generated from SystemCraft — Interactive System Design Course')
  return lines.join('\n')
}

function sectionToMarkdown(section: Section): string[] {
  const out: string[] = []
  if ('title' in section && section.title) out.push(`## ${section.title}`, '')
  switch (section.type) {
    case 'text':
      out.push(section.md.trim())
      break
    case 'code':
      out.push('```' + section.language, section.code.trim(), '```')
      break
    case 'comparison': {
      const { columns, rows, verdict } = section.comparison
      out.push(`| ${columns.join(' | ')} |`)
      out.push(`| ${columns.map(() => '---').join(' | ')} |`)
      for (const row of rows) out.push(`| ${row.join(' | ')} |`)
      if (verdict) out.push('', `**Verdict:** ${verdict}`)
      break
    }
    case 'keyNumbers':
      for (const n of section.numbers) out.push(`- **${n.metric}:** ${n.value} — ${n.context}`)
      break
    case 'diagram':
      out.push(`*[Interactive diagram${section.caption ? `: ${section.caption}` : ''} — view online]*`)
      break
    case 'calculator':
      out.push('*[Interactive capacity calculator — view online]*')
      break
    case 'tradeoff':
      out.push('*[Interactive consistency/availability trade-off visualizer — view online]*')
      break
    case 'beforeAfter': {
      const s = section.scenario
      out.push(`**Before — ${s.beforeTitle}:** ${s.beforeDescription}`, '')
      out.push(`**After — ${s.afterTitle}:** ${s.afterDescription}`, '')
      for (const m of s.metrics) out.push(`- ${m.label}: ${m.before} → ${m.after}`)
      break
    }
  }
  return out
}

export function downloadModuleNotes(mod: Module) {
  const md = moduleToMarkdown(mod)
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${mod.id}-notes.md`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
