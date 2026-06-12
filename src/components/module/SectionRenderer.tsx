import { motion } from 'framer-motion'
import { Markdown } from '../../lib/markdown'
import type { Section } from '../../lib/types'
import { BeforeAfter } from './BeforeAfter'
import { CapacityCalculator } from './CapacityCalculator'
import { CodeBlock } from './CodeBlock'
import { ComparisonTable } from './ComparisonTable'
import { Diagram } from './Diagram'
import { KeyNumbers } from './KeyNumbers'
import { TradeoffVisualizer } from './TradeoffVisualizer'

function SectionBody({ section }: { section: Section }) {
  switch (section.type) {
    case 'text':
      return <Markdown md={section.md} />
    case 'code':
      return <CodeBlock title={section.title} language={section.language} code={section.code} />
    case 'diagram':
      return <Diagram diagram={section.diagram} caption={section.caption} />
    case 'comparison':
      return <ComparisonTable comparison={section.comparison} />
    case 'calculator':
      return <CapacityCalculator kind={section.calculator} />
    case 'tradeoff':
      return <TradeoffVisualizer />
    case 'beforeAfter':
      return <BeforeAfter scenario={section.scenario} />
    case 'keyNumbers':
      return <KeyNumbers numbers={section.numbers} />
  }
}

export function SectionRenderer({ section, index }: { section: Section; index: number }) {
  const showHeading = Boolean(section.title) && section.type !== 'code'
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4 }}
    >
      {showHeading && (
        <h2 className="mb-4 flex items-center gap-3 text-xl font-bold tracking-tight text-surface-900 dark:text-surface-100">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-100 font-mono text-xs font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
            {String(index + 1).padStart(2, '0')}
          </span>
          {section.title}
        </h2>
      )}
      <SectionBody section={section} />
    </motion.section>
  )
}
