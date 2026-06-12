import { AnimatePresence, motion } from 'framer-motion'
import { MousePointerClick, X } from 'lucide-react'
import { useState } from 'react'
import type { DiagramNode, DiagramSpec, NodeKind } from '../../lib/types'

const NODE_W = 150
const NODE_H = 56

/** Per-kind styling: [fill, stroke, darkFill] tailwind-free hex values used inside SVG */
const KIND_STYLE: Record<NodeKind, { fill: string; stroke: string; glyph: string }> = {
  client: { fill: '#f1f5f9', stroke: '#94a3b8', glyph: '👤' },
  lb: { fill: '#ede9fe', stroke: '#8b5cf6', glyph: '⚖️' },
  server: { fill: '#dbeafe', stroke: '#3b82f6', glyph: '🖥️' },
  service: { fill: '#dbeafe', stroke: '#3b82f6', glyph: '⚙️' },
  db: { fill: '#dcfce7', stroke: '#22c55e', glyph: '🗄️' },
  cache: { fill: '#ffedd5', stroke: '#f97316', glyph: '⚡' },
  queue: { fill: '#fef9c3', stroke: '#eab308', glyph: '📬' },
  cdn: { fill: '#cffafe', stroke: '#06b6d4', glyph: '🌐' },
  storage: { fill: '#d1fae5', stroke: '#10b981', glyph: '🪣' },
  search: { fill: '#fce7f3', stroke: '#ec4899', glyph: '🔍' },
  external: { fill: '#f3f4f6', stroke: '#9ca3af', glyph: '🔌' },
}

function nodeRect(n: DiagramNode) {
  return { x: n.x, y: n.y, w: n.w ?? NODE_W, h: n.h ?? NODE_H }
}

/** Point where the line from rect-center toward (tx,ty) crosses the rect border. */
function borderPoint(n: DiagramNode, tx: number, ty: number) {
  const { x, y, w, h } = nodeRect(n)
  const cx = x + w / 2
  const cy = y + h / 2
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const scaleX = dx !== 0 ? w / 2 / Math.abs(dx) : Infinity
  const scaleY = dy !== 0 ? h / 2 / Math.abs(dy) : Infinity
  const scale = Math.min(scaleX, scaleY)
  return { x: cx + dx * scale, y: cy + dy * scale }
}

function center(n: DiagramNode) {
  const { x, y, w, h } = nodeRect(n)
  return { x: x + w / 2, y: y + h / 2 }
}

export function Diagram({ diagram, caption }: { diagram: DiagramSpec; caption?: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = diagram.nodes.find((n) => n.id === selectedId) ?? null
  const nodeById = new Map(diagram.nodes.map((n) => [n.id, n]))

  return (
    <div className="overflow-hidden rounded-xl border border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-900">
      <div className="flex items-center gap-2 border-b border-surface-200 bg-surface-100 px-4 py-2 text-xs text-surface-500 dark:border-surface-700 dark:bg-surface-850 dark:text-surface-400">
        <MousePointerClick className="h-3.5 w-3.5" />
        Click any component to explore it
      </div>

      <svg viewBox={`0 0 1000 ${diagram.height}`} className="block w-full" role="img" aria-label={caption ?? 'Architecture diagram'}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" className="fill-surface-400 dark:fill-surface-500" />
          </marker>
        </defs>

        {/* Edges */}
        {diagram.edges.map((e, i) => {
          const a = nodeById.get(e.from)
          const b = nodeById.get(e.to)
          if (!a || !b) return null
          const ca = center(a)
          const cb = center(b)
          const p1 = borderPoint(a, cb.x, cb.y)
          const p2 = borderPoint(b, ca.x, ca.y)
          const mx = (p1.x + p2.x) / 2
          const my = (p1.y + p2.y) / 2
          return (
            <g key={i}>
              <motion.line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                strokeWidth="1.5"
                strokeDasharray={e.dashed ? '6 4' : undefined}
                markerEnd="url(#arrow)"
                markerStart={e.bidirectional ? 'url(#arrow)' : undefined}
                className="stroke-surface-400 dark:stroke-surface-500"
                initial={{ pathLength: 0, opacity: 0 }}
                whileInView={{ pathLength: 1, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.3 + i * 0.05 }}
              />
              {e.label && (
                <motion.g
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.5 + i * 0.05 }}
                >
                  <rect
                    x={mx - e.label.length * 3.4 - 4}
                    y={my - 9}
                    width={e.label.length * 6.8 + 8}
                    height={18}
                    rx={4}
                    className="fill-white dark:fill-surface-900"
                  />
                  <text
                    x={mx}
                    y={my + 4}
                    textAnchor="middle"
                    fontSize="11"
                    className="fill-surface-500 font-sans dark:fill-surface-400"
                  >
                    {e.label}
                  </text>
                </motion.g>
              )}
            </g>
          )
        })}

        {/* Nodes */}
        {diagram.nodes.map((n, i) => {
          const { x, y, w, h } = nodeRect(n)
          const style = KIND_STYLE[n.kind]
          const isSelected = n.id === selectedId
          return (
            <motion.g
              key={n.id}
              initial={{ opacity: 0, scale: 0.85 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: i * 0.06 }}
              style={{ cursor: 'pointer' }}
              onClick={() => setSelectedId(isSelected ? null : n.id)}
            >
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={10}
                fill={style.fill}
                stroke={isSelected ? '#4f68fb' : style.stroke}
                strokeWidth={isSelected ? 3 : 1.5}
              />
              <text x={x + 14} y={y + h / 2 + 5} fontSize="16">
                {style.glyph}
              </text>
              <text
                x={x + 38}
                y={y + h / 2 + 4}
                fontSize="13"
                fontWeight="600"
                fill="#1e293b"
                className="font-sans"
              >
                {n.label.length > 16 ? n.label.slice(0, 15) + '…' : n.label}
              </text>
            </motion.g>
          )
        })}
      </svg>

      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-surface-200 dark:border-surface-700"
          >
            <div className="flex items-start gap-3 bg-brand-50/50 p-4 dark:bg-brand-950/30">
              <span className="text-xl">{KIND_STYLE[selected.kind].glyph}</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">{selected.label}</p>
                <p className="mt-1 text-sm leading-relaxed text-surface-600 dark:text-surface-300">{selected.detail}</p>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                className="rounded-lg p-1 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-800"
                aria-label="Close detail"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {caption && (
        <p className="border-t border-surface-200 px-4 py-2 text-center text-xs text-surface-400 dark:border-surface-700">
          {caption}
        </p>
      )}
    </div>
  )
}
