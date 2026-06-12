import { Calculator } from 'lucide-react'
import { useState } from 'react'
import type { CalculatorKind } from '../../lib/types'

function fmt(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(n >= 1e13 ? 0 : 1) + 'T'
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K'
  return n < 10 && n % 1 !== 0 ? n.toFixed(1) : Math.round(n).toLocaleString()
}

function fmtBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

interface Field {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
  unit?: string
  log?: boolean
}

interface CalcDef {
  title: string
  description: string
  fields: Field[]
  compute: (v: Record<string, number>) => { label: string; value: string; note?: string }[]
}

const CALCULATORS: Record<CalculatorKind, CalcDef> = {
  qps: {
    title: 'QPS estimator',
    description: 'Back-of-the-envelope queries per second from daily active users.',
    fields: [
      { key: 'dau', label: 'Daily active users', min: 1e4, max: 2e9, step: 1, default: 1e7, log: true },
      { key: 'actions', label: 'Requests per user per day', min: 1, max: 500, step: 1, default: 20 },
      { key: 'peak', label: 'Peak-to-average ratio', min: 1, max: 10, step: 0.5, default: 3 },
    ],
    compute: (v) => {
      const avg = (v.dau * v.actions) / 86400
      return [
        { label: 'Average QPS', value: fmt(avg) },
        { label: 'Peak QPS', value: fmt(avg * v.peak), note: 'Provision for this' },
        {
          label: 'App servers needed',
          value: fmt(Math.ceil((avg * v.peak) / 1000)),
          note: 'at ~1,000 QPS per server',
        },
      ]
    },
  },
  storage: {
    title: 'Storage estimator',
    description: 'Project raw and replicated storage growth over time.',
    fields: [
      { key: 'items', label: 'New items per day', min: 1e3, max: 1e9, step: 1, default: 1e6, log: true },
      { key: 'size', label: 'Average item size (KB)', min: 1, max: 10240, step: 1, default: 100, log: true },
      { key: 'replication', label: 'Replication factor', min: 1, max: 5, step: 1, default: 3 },
      { key: 'years', label: 'Retention (years)', min: 1, max: 10, step: 1, default: 5 },
    ],
    compute: (v) => {
      const perDay = v.items * v.size * 1024
      const total = perDay * 365 * v.years * v.replication
      return [
        { label: 'Daily ingest (raw)', value: fmtBytes(perDay) },
        { label: `Total after ${v.years}y (×${v.replication} replicas)`, value: fmtBytes(total) },
        {
          label: 'Monthly S3 cost (standard)',
          value: '$' + fmt((total / 1024 ** 3) * 0.023),
          note: 'at $0.023/GB-month',
        },
      ]
    },
  },
  bandwidth: {
    title: 'Bandwidth estimator',
    description: 'Egress bandwidth from request volume and payload size.',
    fields: [
      { key: 'qps', label: 'Peak QPS', min: 100, max: 1e7, step: 1, default: 1e4, log: true },
      { key: 'size', label: 'Average response size (KB)', min: 1, max: 10240, step: 1, default: 200, log: true },
    ],
    compute: (v) => {
      const bps = v.qps * v.size * 1024 * 8
      const monthly = v.qps * v.size * 1024 * 86400 * 30
      return [
        { label: 'Peak egress', value: fmt(bps / 1e9) + ' Gbps' },
        { label: 'Monthly transfer', value: fmtBytes(monthly) },
        {
          label: 'Monthly CDN cost',
          value: '$' + fmt((monthly / 1024 ** 3) * 0.085),
          note: 'at ~$0.085/GB (CloudFront)',
        },
      ]
    },
  },
  'cache-sizing': {
    title: 'Cache sizing (80/20 rule)',
    description: 'Size a cache to hold the hot working set.',
    fields: [
      { key: 'requests', label: 'Requests per day', min: 1e6, max: 1e11, step: 1, default: 1e9, log: true },
      { key: 'size', label: 'Average object size (KB)', min: 1, max: 1024, step: 1, default: 10, log: true },
      { key: 'hot', label: 'Hot data share (%)', min: 5, max: 50, step: 5, default: 20 },
    ],
    compute: (v) => {
      const dailyBytes = v.requests * v.size * 1024
      const cacheBytes = dailyBytes * (v.hot / 100)
      const nodes = Math.max(1, Math.ceil(cacheBytes / (64 * 1024 ** 3)))
      return [
        { label: 'Daily data touched', value: fmtBytes(dailyBytes) },
        { label: 'Cache size needed', value: fmtBytes(cacheBytes), note: `${v.hot}% of traffic = hot set` },
        { label: 'Redis nodes (64 GB each)', value: String(nodes) },
      ]
    },
  },
}

/** Map slider position (0..1000) to value, optionally log-scaled for huge ranges. */
function sliderToValue(pos: number, f: Field): number {
  const t = pos / 1000
  if (f.log) {
    const lo = Math.log10(f.min)
    const hi = Math.log10(f.max)
    return Math.round(10 ** (lo + t * (hi - lo)))
  }
  return Math.round((f.min + t * (f.max - f.min)) / f.step) * f.step
}

function valueToSlider(value: number, f: Field): number {
  if (f.log) {
    const lo = Math.log10(f.min)
    const hi = Math.log10(f.max)
    return ((Math.log10(value) - lo) / (hi - lo)) * 1000
  }
  return ((value - f.min) / (f.max - f.min)) * 1000
}

export function CapacityCalculator({ kind }: { kind: CalculatorKind }) {
  const def = CALCULATORS[kind]
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(def.fields.map((f) => [f.key, f.default])),
  )

  const results = def.compute(values)

  return (
    <div className="rounded-xl border border-surface-200 bg-white p-5 dark:border-surface-700 dark:bg-surface-900">
      <div className="mb-1 flex items-center gap-2">
        <Calculator className="h-4 w-4 text-brand-500" />
        <h3 className="text-sm font-bold text-surface-900 dark:text-surface-100">{def.title}</h3>
      </div>
      <p className="mb-5 text-xs text-surface-400">{def.description}</p>

      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        <div className="space-y-5">
          {def.fields.map((f) => (
            <div key={f.key}>
              <div className="mb-1 flex items-baseline justify-between">
                <label className="text-xs font-medium text-surface-600 dark:text-surface-300">{f.label}</label>
                <span className="font-mono text-xs font-semibold text-brand-600 dark:text-brand-400">
                  {fmt(values[f.key])}
                  {f.unit ?? ''}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1000}
                value={valueToSlider(values[f.key], f)}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: sliderToValue(Number(e.target.value), f) }))}
                className="w-full accent-brand-600"
              />
            </div>
          ))}
        </div>

        <div className="space-y-3">
          {results.map((r) => (
            <div
              key={r.label}
              className="flex items-center justify-between rounded-lg bg-surface-100 px-4 py-3 dark:bg-surface-850"
            >
              <div>
                <p className="text-xs text-surface-500 dark:text-surface-400">{r.label}</p>
                {r.note && <p className="text-[10px] text-surface-400">{r.note}</p>}
              </div>
              <p className="font-mono text-lg font-bold text-surface-900 tabular-nums dark:text-white">{r.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
