import { motion } from 'framer-motion'
import { Scale } from 'lucide-react'
import { useState } from 'react'

interface ZoneInfo {
  label: string
  systems: string
  reads: string
  writes: string
  partition: string
  useWhen: string
}

const ZONES: ZoneInfo[] = [
  {
    label: 'Strong consistency (CP)',
    systems: 'Spanner, etcd, ZooKeeper, HBase',
    reads: 'Always return the latest committed write — linearizable.',
    writes: 'Acknowledged only after a quorum agrees; +5–100 ms latency.',
    partition: 'Minority side refuses requests. Correct, but partially unavailable.',
    useWhen: 'Money movement, inventory counts, leader election, configuration.',
  },
  {
    label: 'Quorum / tunable',
    systems: 'Cassandra (QUORUM), DynamoDB (strong reads), MongoDB (majority)',
    reads: 'R + W > N gives read-your-writes; single-region p99 ~10 ms.',
    writes: 'Wait for a majority of replicas (e.g. 2 of 3).',
    partition: 'Available as long as a majority of replicas are reachable.',
    useWhen: 'User profiles, shopping carts, most OLTP workloads.',
  },
  {
    label: 'Eventual consistency (AP)',
    systems: 'DynamoDB (default), Cassandra (ONE), DNS, S3 (legacy model), CDNs',
    reads: 'May be stale for ms–seconds; served locally at ~1 ms.',
    writes: 'Acknowledged by one node, replicated asynchronously.',
    partition: 'Every side keeps serving; conflicts reconciled later (LWW, CRDTs).',
    useWhen: 'Feeds, likes, view counters, presence, caches — where stale ≠ wrong.',
  },
]

export function TradeoffVisualizer() {
  const [pos, setPos] = useState(50)
  const zone = ZONES[pos < 34 ? 0 : pos < 67 ? 1 : 2]

  return (
    <div className="rounded-xl border border-surface-200 bg-white p-5 dark:border-surface-700 dark:bg-surface-900">
      <div className="mb-1 flex items-center gap-2">
        <Scale className="h-4 w-4 text-brand-500" />
        <h3 className="text-sm font-bold text-surface-900 dark:text-surface-100">
          Consistency ↔ Availability trade-off explorer
        </h3>
      </div>
      <p className="mb-6 text-xs text-surface-400">
        Drag the slider. During a network partition you can't have both — see what each position costs you.
      </p>

      <div className="relative mb-2 h-3 rounded-full bg-gradient-to-r from-blue-500 via-violet-500 to-emerald-500 opacity-80" />
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        className="relative -mt-5 mb-1 h-3 w-full cursor-pointer appearance-none bg-transparent accent-white"
        aria-label="Consistency versus availability position"
      />
      <div className="mb-6 flex justify-between text-[11px] font-semibold tracking-wide uppercase">
        <span className="text-blue-600 dark:text-blue-400">Consistency</span>
        <span className="text-violet-600 dark:text-violet-400">Balanced</span>
        <span className="text-emerald-600 dark:text-emerald-400">Availability</span>
      </div>

      <motion.div
        key={zone.label}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-xl bg-surface-100 p-5 dark:bg-surface-850"
      >
        <p className="text-base font-bold text-surface-900 dark:text-white">{zone.label}</p>
        <p className="mt-0.5 text-xs text-surface-500 dark:text-surface-400">e.g. {zone.systems}</p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          {(
            [
              ['Reads', zone.reads],
              ['Writes', zone.writes],
              ['During a partition', zone.partition],
              ['Reach for it when', zone.useWhen],
            ] as const
          ).map(([term, def]) => (
            <div key={term} className="rounded-lg bg-white p-3 dark:bg-surface-900">
              <dt className="text-[11px] font-semibold tracking-wide text-surface-400 uppercase">{term}</dt>
              <dd className="mt-1 leading-snug text-surface-600 dark:text-surface-300">{def}</dd>
            </div>
          ))}
        </dl>
      </motion.div>
    </div>
  )
}
