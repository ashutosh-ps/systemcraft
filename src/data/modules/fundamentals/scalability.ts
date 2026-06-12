import type { Module } from '../../../lib/types'

const scalability: Module = {
  id: 'scalability',
  category: 'fundamentals',
  title: 'Scalability, Availability & Consistency',
  description:
    'The three forces every architecture balances. Learn vertical vs horizontal scaling, how availability is measured in nines, and why the CAP theorem forces real trade-offs.',
  difficulty: 'Junior',
  estMinutes: 120,
  keywords: ['CAP theorem', 'nines', 'SLA', 'horizontal scaling', 'vertical scaling', 'stateless', 'redundancy'],
  related: ['load-balancing', 'caching', 'distributed-systems', 'replication'],
  sections: [
    {
      type: 'text',
      title: 'Why systems need to scale',
      md: `
A single well-tuned server takes you surprisingly far — a modern 32-core machine with 128 GB RAM can serve
**5,000–10,000 simple requests/second**. Twitter ran on a monolith for years. But growth breaks single machines in
predictable ways:

- **Compute saturates.** CPU-bound endpoints (feed ranking, image resizing) hit 100% utilization and p99 latency explodes from 50 ms to multiple seconds.
- **Memory runs out.** Working sets that no longer fit in RAM spill to disk, and a 100 µs lookup becomes a 10 ms one — a **100× slowdown**.
- **A single machine is a single point of failure.** Hardware fails constantly at scale: with an annual disk failure rate of ~1–2%, a fleet of 10,000 disks loses several *every week*.

**Scalability** is the property that adding resources yields proportional capacity. A system that doubles its servers
but only gains 20% throughput doesn't scale — coordination overhead is eating the gains (this is Amdahl's law in
practice).

> Interview tip: never say "we'll just add more servers." Say *what* you scale (stateless app tier), *what stops you*
> (the shared database), and *what you do about it* (read replicas, then sharding).
`,
    },
    {
      type: 'text',
      title: 'Vertical vs horizontal scaling',
      md: `
#### Vertical scaling (scale up)

Buy a bigger box. Zero code changes — your Postgres just gets 4× the RAM. AWS will happily rent you an
\`u-24tb1.metal\` with **24 TB of RAM** for roughly **$200,000/month**. Costs grow super-linearly and there's a hard
ceiling, but for databases it's often the right *first* move because it preserves single-node simplicity
(transactions, joins, no distributed anything).

#### Horizontal scaling (scale out)

Add more commodity machines behind a load balancer. Cost grows linearly, capacity is effectively unbounded, and
losing one node out of fifty is a non-event. The price you pay is architectural: nodes can't keep local state,
requests need routing, and data may need partitioning.

The single most important enabler is a **stateless app tier**: any server can handle any request because session
state lives in a shared store (Redis, signed cookies/JWTs) instead of server memory. Stateless servers are cattle,
not pets — you can kill, clone, and autoscale them freely.
`,
    },
    {
      type: 'comparison',
      title: 'Design decision: scale up or scale out?',
      comparison: {
        columns: ['Criterion', 'Vertical (scale up)', 'Horizontal (scale out)'],
        rows: [
          ['Effort to adopt', 'None — same architecture', 'High — LB, statelessness, possibly sharding'],
          ['Cost curve', 'Super-linear (2× capacity ≈ 3–4× price)', 'Roughly linear with node count'],
          ['Ceiling', '~24 TB RAM / 448 vCPUs (largest cloud instances)', 'Practically unbounded'],
          ['Fault tolerance', 'None — one box, one blast radius', 'Survives individual node failures'],
          ['Latency consistency', 'Excellent — no network hops between components', 'Needs care: cross-node calls add 0.5–2 ms each'],
          ['Best for', 'Databases early on, dev simplicity', 'Web/API tiers, anything stateless'],
        ],
        verdict:
          'Scale the stateless tier horizontally from day one; scale the database vertically until read replicas and then sharding become necessary.',
      },
    },
    {
      type: 'diagram',
      title: 'From one box to a scalable web tier',
      caption: 'A canonical three-tier architecture: stateless app servers scale horizontally behind a load balancer.',
      diagram: {
        height: 360,
        nodes: [
          { id: 'users', label: 'Clients', kind: 'client', x: 30, y: 150, detail: 'Browsers and mobile apps. At 10M DAU making 20 requests/day each, expect ~2,300 QPS average and ~7,000 QPS at peak (3× factor).' },
          { id: 'lb', label: 'Load Balancer', kind: 'lb', x: 250, y: 150, detail: 'Distributes traffic across app servers (round-robin or least-connections). Health-checks every few seconds and ejects dead nodes. An AWS ALB handles millions of QPS and costs ~$20/month + $0.008/LCU-hour.' },
          { id: 'app1', label: 'App Server 1', kind: 'server', x: 490, y: 40, detail: 'Stateless: no session data in memory, so any server can serve any user. A typical 8-core node handles ~1,000 QPS of business logic.' },
          { id: 'app2', label: 'App Server 2', kind: 'server', x: 490, y: 150, detail: 'Identical clone. Autoscaling adds/removes clones based on CPU or request depth — scale-out takes ~1–3 minutes on EC2, seconds on Lambda/Cloud Run.' },
          { id: 'app3', label: 'App Server N', kind: 'server', x: 490, y: 260, detail: 'Capacity math: peak 7,000 QPS ÷ 1,000 QPS/server = 7 servers, +30% headroom → provision ~9.' },
          { id: 'cache', label: 'Redis Cache', kind: 'cache', x: 740, y: 60, detail: 'Shared session store + hot data cache. Sub-millisecond reads at 100K+ ops/sec per node. This is what lets app servers stay stateless.' },
          { id: 'db', label: 'PostgreSQL', kind: 'db', x: 740, y: 240, detail: 'The stateful core — hardest part to scale. First move: bigger instance. Second: read replicas. Third: sharding. Covered in later modules.' },
        ],
        edges: [
          { from: 'users', to: 'lb', label: 'HTTPS' },
          { from: 'lb', to: 'app1' },
          { from: 'lb', to: 'app2' },
          { from: 'lb', to: 'app3' },
          { from: 'app1', to: 'cache', label: 'sessions' },
          { from: 'app2', to: 'cache' },
          { from: 'app2', to: 'db', label: 'SQL' },
          { from: 'app3', to: 'db' },
        ],
      },
    },
    {
      type: 'calculator',
      title: 'Try it: estimate your QPS',
      calculator: 'qps',
    },
    {
      type: 'text',
      title: 'Availability and the nines',
      md: `
**Availability** is the fraction of time a system answers correctly. It's quoted in "nines":

- **99% (two nines)** — 3.65 days down/year. Hobby projects.
- **99.9% (three nines)** — 8.8 hours/year. Typical internal tooling SLA.
- **99.99% (four nines)** — 52 minutes/year. Serious SaaS (Stripe, Slack target this publicly).
- **99.999% (five nines)** — 5.3 minutes/year. Telecom-grade; requires automated failover everywhere, because a human can't even join the incident call in 5 minutes.

Two composition rules drive every HA design:

1. **Serial components multiply.** A request that traverses LB → app → DB, each 99.9% available, yields 0.999³ ≈ **99.7%** — chains are weaker than their weakest link.
2. **Redundant components compensate.** Two independent 99% replicas, where either can serve, give 1 − (0.01)² = **99.99%**. Redundancy buys nines cheaply — *if* failover is automatic.

This is why real systems deploy across **multiple availability zones** (independent power/network within a region,
<2 ms apart) and sometimes multiple regions (independent geography, 50–150 ms apart) — and why an SLA is only as
credible as its failover automation.
`,
    },
    {
      type: 'keyNumbers',
      title: 'Latency numbers every engineer should know',
      numbers: [
        { metric: 'L1 cache reference', value: '0.5 ns', context: 'The baseline everything else is measured against.' },
        { metric: 'RAM access', value: '100 ns', context: 'Reading from memory — 200× slower than L1.' },
        { metric: 'SSD random read', value: '~100 µs', context: '1,000× slower than RAM. Why caches exist.' },
        { metric: 'Same-DC network round trip', value: '~0.5 ms', context: 'Every microservice hop pays this.' },
        { metric: 'Cross-continent round trip', value: '~150 ms', context: 'US ↔ Europe. Why CDNs and regions exist.' },
        { metric: 'Disk seek (HDD)', value: '~10 ms', context: 'Spinning rust. Avoid on the hot path entirely.' },
      ],
    },
    {
      type: 'text',
      title: 'Consistency and the CAP theorem',
      md: `
**Consistency** here means: does every read see the most recent write? In a replicated system, writes take time to
propagate, so the answer is a design choice.

The **CAP theorem** (Brewer, 2000): when a network **P**artition splits your replicas, you must choose between
**C**onsistency (refuse requests that might return stale data) and **A**vailability (answer everyone, possibly
stale). You cannot have both *during the partition* — and partitions are a fact of life, so the choice is mandatory.

- **CP systems** (ZooKeeper, etcd, Spanner, HBase): the minority side of a partition stops serving. Correctness over uptime. Use for money, locks, leader election.
- **AP systems** (Cassandra, DynamoDB defaults, DNS): every node keeps answering; conflicts get reconciled later. Uptime over freshness. Use for feeds, counters, carts.

In practice the more useful framing is **PACELC**: if Partitioned, trade Availability vs Consistency; **E**lse, trade
**L**atency vs **C**onsistency. Even with zero failures, synchronous replication to a quorum costs you milliseconds on
every write — Spanner pays ~10 ms commit latency for global strong consistency, while DynamoDB answers eventually
consistent reads in ~1–2 ms.

Most large systems mix models per data type: strongly consistent for balances and inventory, eventually consistent
for like counts and presence. Saying *that sentence* in an interview is worth more than reciting the theorem.
`,
    },
    {
      type: 'tradeoff',
      title: 'Explore the trade-off yourself',
    },
    {
      type: 'beforeAfter',
      title: 'Case: surviving a 10× traffic spike',
      scenario: {
        beforeTitle: 'Single 16-core server doing everything',
        beforeDescription:
          'App + Postgres on one box. At 2,000 QPS the CPU pins at 100%, p99 hits 8 seconds, and a kernel OOM-kill takes the whole product down. Availability last quarter: 98.9%.',
        afterTitle: 'Stateless tier behind an ALB, cache, managed DB',
        afterDescription:
          '9 stateless app nodes autoscale 6→20 behind a load balancer; sessions moved to Redis; Postgres on its own instance with a replica. The spike now just triggers a scale-out event.',
        metrics: [
          { label: 'Peak capacity', before: '2,000 QPS', after: '20,000 QPS', improved: true },
          { label: 'p99 latency at peak', before: '8,000 ms', after: '180 ms', improved: true },
          { label: 'Availability', before: '98.9%', after: '99.95%', improved: true },
        ],
      },
    },
    {
      type: 'code',
      title: 'Capacity estimation cheat-sheet (interview-ready)',
      language: 'python',
      code: `
# Back-of-the-envelope template — memorize the flow, not the numbers
DAU = 10_000_000          # daily active users
req_per_user = 20         # requests per user per day
peak_factor = 3           # peak traffic vs average

avg_qps = DAU * req_per_user / 86_400        # ~2,300 QPS
peak_qps = avg_qps * peak_factor             # ~7,000 QPS

# Servers: assume ~1,000 QPS per app server, keep 30% headroom
servers = peak_qps / 1_000 * 1.3             # ~9 servers

# Storage: 1M new items/day x 100 KB x 3 replicas x 5 years
storage = 1e6 * 100e3 * 3 * 365 * 5          # ~547 TB

# Useful identities:
#   1 day = 86,400 s  (round to 100K for mental math)
#   1M requests/day ≈ 12 QPS average
#   2.5M seconds in a month
`,
    },
  ],
  quiz: [
    {
      question: 'Your service chain is LB → app → DB, each component 99.9% available. What is the overall availability?',
      options: ['99.9%', '~99.7%', '99.97%', '~98%'],
      answer: 1,
      explanation:
        'Serial dependencies multiply: 0.999 × 0.999 × 0.999 ≈ 0.997. Chaining components always lowers availability — redundancy within each tier is how you win it back.',
    },
    {
      question: 'Which change is the prerequisite for horizontally scaling a web tier?',
      options: [
        'Moving to a NoSQL database',
        'Making app servers stateless (sessions in a shared store)',
        'Adding a CDN',
        'Switching to gRPC',
      ],
      answer: 1,
      explanation:
        'If session state lives in server memory, requests are pinned to specific machines and you can\'t freely add/remove nodes. Externalizing state (Redis, JWTs) makes servers interchangeable.',
    },
    {
      question: 'During a network partition, a CP system will…',
      options: [
        'Serve all requests with possibly stale data',
        'Refuse requests on the minority side to avoid returning stale data',
        'Automatically merge conflicting writes with CRDTs',
        'Lose committed data',
      ],
      answer: 1,
      explanation:
        'CP systems sacrifice availability: nodes that can\'t reach a quorum stop answering rather than risk inconsistency. AP systems make the opposite choice and reconcile later.',
    },
    {
      question: 'Roughly how much downtime per year does 99.99% availability allow?',
      options: ['8.8 hours', '52 minutes', '5 minutes', '3.65 days'],
      answer: 1,
      explanation:
        'Four nines ≈ 52.6 minutes/year (0.01% of 525,600 minutes). Each extra nine cuts allowed downtime by 10× — and roughly 10×es the engineering cost.',
    },
    {
      question: 'A startup\'s Postgres is CPU-bound at 80% with 500 QPS of mixed traffic. The cheapest sound *first* step is:',
      options: [
        'Shard the database across 4 nodes',
        'Rewrite in a faster language',
        'Scale the instance up and add a cache for hot reads',
        'Migrate to Cassandra',
      ],
      answer: 2,
      explanation:
        'Vertical scaling plus caching preserves single-node simplicity (transactions, joins) and typically buys 5–10× headroom. Sharding is a last resort because it complicates everything downstream.',
    },
  ],
  interviewQuestions: [
    {
      question: 'How would you scale a web application from 1,000 to 10 million users?',
      hint: 'Walk through stages: single server → separate DB → stateless app tier + LB → cache → read replicas → CDN → sharding/queues. At each stage name the bottleneck that forces the next step and give rough QPS numbers.',
      difficulty: 'Junior',
    },
    {
      question: 'Your SLA is 99.99% but your single-region deployment was down 40 minutes last month. What do you change?',
      hint: 'Discuss multi-AZ redundancy, automated health-check-driven failover, removing serial single points of failure, and error budgets. Note that 40 min/month ≈ 99.9% — a full nine short.',
      difficulty: 'Mid',
    },
    {
      question: 'Explain a real scenario where you would deliberately choose eventual consistency.',
      hint: 'Like counts, news feeds, presence indicators: high write volume, reads tolerate seconds of staleness, and unavailability costs more than staleness. Contrast with a payments ledger where the trade flips.',
      difficulty: 'Mid',
    },
    {
      question: 'Design a 5-nines service. What does the last nine actually cost you?',
      hint: 'Five nines = 5.3 min/year — beyond human reaction time. Requires N+2 redundancy, multi-region active-active, automated failover tested via chaos engineering, deploy strategies with instant rollback. Engineering cost grows ~10× per nine.',
      difficulty: 'Senior',
    },
  ],
  commonMistakes: [
    '"Just add more servers" without identifying whether the bottleneck is the stateless tier (easy) or the database (hard). Interviewers probe exactly this.',
    'Quoting the CAP theorem as "pick 2 of 3". Partitions aren\'t optional — the real choice is C vs A during a partition, and latency vs consistency the rest of the time (PACELC).',
    'Designing for 100× scale on day one. Premature sharding adds operational pain for years; design so you *can* shard, don\'t shard now.',
    'Forgetting the peak-to-average factor. Provisioning for average QPS means falling over every evening; 2–5× peaking is normal, 10×+ for spiky events.',
    'Treating availability as a property of servers rather than of the whole chain — one 99% dependency caps your 99.99% service.',
  ],
  cloudMappings: [
    { concept: 'Managed load balancer', aws: 'ALB / NLB', gcp: 'Cloud Load Balancing', azure: 'Azure Load Balancer / App Gateway' },
    { concept: 'Autoscaling stateless compute', aws: 'EC2 Auto Scaling / ECS / Lambda', gcp: 'Managed Instance Groups / Cloud Run', azure: 'VM Scale Sets / Container Apps' },
    { concept: 'Shared session store / cache', aws: 'ElastiCache (Redis)', gcp: 'Memorystore', azure: 'Azure Cache for Redis' },
    { concept: 'Managed relational DB with replicas', aws: 'RDS / Aurora', gcp: 'Cloud SQL / AlloyDB', azure: 'Azure Database for PostgreSQL' },
    { concept: 'Multi-AZ / zone redundancy', aws: 'Availability Zones', gcp: 'Zones', azure: 'Availability Zones' },
    { concept: 'Globally consistent database', aws: 'DynamoDB Global Tables (AP) ', gcp: 'Spanner (CP)', azure: 'Cosmos DB (tunable)' },
  ],
}

export default scalability
