import type { Module } from '../../../lib/types'

const sharding: Module = {
  id: 'sharding',
  category: 'advanced',
  title: 'Sharding & Partitioning',
  description:
    'When one database can no longer hold or serve your data, you split it. Learn shard key selection, range vs hash vs consistent hashing, why resharding hurts, and how to survive celebrity hot spots.',
  difficulty: 'Senior',
  estMinutes: 150,
  keywords: [
    'shard key',
    'consistent hashing',
    'virtual nodes',
    'hot shard',
    'resharding',
    'Vitess',
    'scatter-gather',
    'partitioning',
  ],
  related: ['databases', 'replication', 'consensus', 'design-instagram'],
  sections: [
    {
      type: 'text',
      title: 'When a single database stops being enough',
      md: `
Sharding is the move you make *last*, after vertical scaling, caching, and read replicas are exhausted. Know the
ceiling you're racing toward: a well-tuned single PostgreSQL on big hardware (64+ cores, NVMe) sustains roughly
**40–50K TPS** of mixed OLTP traffic, and stays operationally pleasant up to a **few TB** of data. Past that,
physics and operations gang up on you:

- **Writes saturate one machine.** Replicas scale reads, but every write still funnels through a single primary. A write-heavy workload (chat, metrics, orders) hits the wall first.
- **Working set exceeds RAM.** When your hot data outgrows the buffer pool, cache hit rate collapses and p99 read latency jumps from ~1 ms to 10–50 ms.
- **Operations become scary.** At 5 TB, a \`pg_dump\` takes hours, \`VACUUM FULL\` is a weekend event, adding an index locks for minutes, and a restore-from-backup RTO is measured in *half-days*.

**Sharding (horizontal partitioning)** splits one logical dataset across N independent databases, each owning a
disjoint slice of rows. Each shard is small, fast, and boring again — backups in minutes, working set in RAM,
writes spread N ways.

> Interview tip: always present sharding as the *third* act. "Vertical + cache → read replicas → shard." Jumping
> straight to sharding signals you've never paid its operational bill.
`,
    },
    {
      type: 'text',
      title: 'Vertical vs horizontal partitioning — and choosing a shard key',
      md: `
#### Two axes of splitting

- **Vertical partitioning** splits by *column or table*: move \`user_profiles\` to one database and \`orders\` to another (this is also the data side of microservices). Easy wins, but each piece can still outgrow a machine.
- **Horizontal partitioning (sharding)** splits by *row*: users 1–10M on shard 0, 10M–20M on shard 1. This is the one that scales writes indefinitely — and the one this module is about.

#### The shard key decides everything

The shard key is the column whose value routes a row to a shard. You will live with this choice for years. Judge
candidates on three properties:

1. **High cardinality.** \`user_id\` (hundreds of millions of values) spreads load; \`country\` (~200 values) cannot — the US shard melts while Liechtenstein idles.
2. **Even access distribution.** Cardinality isn't enough if 1% of keys get 90% of traffic. More on celebrities later.
3. **Matches your query pattern.** If 95% of queries are "everything for this user," shard by \`user_id\` and those queries stay single-shard. Shard by \`order_id\` instead and every user-history page becomes a scatter-gather across all N shards.

**Monotonic keys are a trap.** Sharding by auto-increment ID or timestamp means *all new writes* land on the
newest range — one shard takes 100% of insert traffic while the rest serve cold history. This is the classic
hot-shard anti-pattern; it's why DynamoDB docs spend pages warning against timestamp partition keys.
`,
    },
    {
      type: 'comparison',
      title: 'Sharding strategies compared',
      comparison: {
        columns: ['Criterion', 'Range', 'Hash (mod N)', 'Consistent hashing', 'Directory-based'],
        rows: [
          [
            'How it routes',
            'Key falls in a range → shard owning that range',
            'hash(key) mod N',
            'hash(key) → next vnode clockwise on a ring',
            'Lookup table: key/tenant → shard',
          ],
          [
            'Range scans',
            'Excellent — adjacent keys co-located',
            'Impossible — adjacent keys scattered',
            'Impossible — same as hash',
            'Possible if directory groups ranges',
          ],
          [
            'Hot-spot risk',
            'High with monotonic keys (newest range is hot)',
            'Low — uniform spread',
            'Low, tunable via vnode count',
            'Depends entirely on assignment policy',
          ],
          [
            'Adding a shard',
            'Split one range — moves only that range',
            'Re-mod everything: ~all keys move',
            'Moves only ~1/N of keys',
            'Update table; move chosen tenants only',
          ],
          [
            'Extra infrastructure',
            'Range metadata (small)',
            'None',
            'Ring state shared by routers',
            'Highly available lookup service (SPOF risk)',
          ],
          [
            'Used by',
            'HBase, Spanner, Vitess range shards',
            'Naive app-level sharding (avoid)',
            'Cassandra, DynamoDB, Riak, Memcached clients',
            'Slack (tenant→shard), Shopify (pod per shop)',
          ],
        ],
        verdict:
          'Default to consistent hashing for uniform key-value load; choose range when you need locality/scans (and your key is not monotonic); choose directory when tenants are the natural unit and you want per-tenant placement control. Never ship hash mod N.',
      },
    },
    {
      type: 'diagram',
      title: 'A hash-sharded cluster behind a router',
      caption:
        'Application traffic flows through a shard-aware router that hashes the key and forwards to the owning shard. The ring topology lives in a config store, not in app code.',
      diagram: {
        height: 460,
        nodes: [
          {
            id: 'app',
            label: 'App Servers',
            kind: 'client',
            x: 30,
            y: 182,
            detail:
              'Stateless app tier issuing queries by user_id. At 50M DAU this generates ~30K QPS of reads and ~8K QPS of writes against the sharded tier.',
          },
          {
            id: 'router',
            label: 'Shard Router',
            kind: 'lb',
            x: 250,
            y: 182,
            detail:
              'Vitess vtgate / Citus coordinator / smart client library. Computes hash(user_id), looks up the owning shard on the ring, forwards the query. Adds ~0.2-0.5 ms per hop and scales horizontally itself.',
          },
          {
            id: 'config',
            label: 'Topology Store',
            kind: 'db',
            x: 250,
            y: 340,
            detail:
              'etcd/ZooKeeper holding the ring: vnode → shard assignments and shard health. Routers watch it for changes; updates propagate in <1 s during resharding.',
          },
          {
            id: 'shard0',
            label: 'Shard 0',
            kind: 'db',
            x: 540,
            y: 40,
            detail:
              'Owns ~25% of the keyspace via ~256 virtual nodes. ~800 GB of data, ~2K write TPS — comfortably inside single-Postgres limits with room to grow.',
          },
          {
            id: 'shard1',
            label: 'Shard 1',
            kind: 'db',
            x: 540,
            y: 150,
            detail:
              'Identical schema, disjoint rows. Each shard runs its own replication (1 primary + 2 replicas), its own backups, its own failover.',
          },
          {
            id: 'shard2',
            label: 'Shard 2',
            kind: 'db',
            x: 540,
            y: 260,
            detail:
              'Hash distribution keeps shards within ~5-10% of each other on storage and QPS — verify with per-shard dashboards, skew creeps in over time.',
          },
          {
            id: 'shard3',
            label: 'Shard 3',
            kind: 'db',
            x: 540,
            y: 370,
            detail:
              'When any shard nears ~70% of capacity, split it: spin up a new shard, move half its vnodes, copy ~400 GB in the background, cut over.',
          },
          {
            id: 'replicas',
            label: 'Replicas ×2/shard',
            kind: 'storage',
            x: 800,
            y: 205,
            detail:
              'Every shard primary streams to 2 replicas in other AZs. Sharding multiplies your HA surface: 4 shards = 4 independent failover domains to monitor.',
          },
        ],
        edges: [
          { from: 'app', to: 'router', label: 'query(user_id)' },
          { from: 'router', to: 'config', label: 'watch ring', dashed: true },
          { from: 'router', to: 'shard0', label: 'hash → s0' },
          { from: 'router', to: 'shard1' },
          { from: 'router', to: 'shard2' },
          { from: 'router', to: 'shard3' },
          { from: 'shard1', to: 'replicas', label: 'async WAL' },
          { from: 'shard2', to: 'replicas' },
        ],
      },
    },
    {
      type: 'code',
      title: 'Consistent hashing with virtual nodes (pseudocode)',
      language: 'python',
      code: `
# Consistent hashing ring with virtual nodes.
# Why vnodes: with 1 point per server, a 4-node ring can end up 60/20/15/5.
# With 100-256 vnodes per server, load evens out to within a few percent,
# and a removed node's keys scatter across ALL survivors, not one neighbor.

import bisect, hashlib

VNODES = 256  # Cassandra historically used 256; newer default is 16

def h(key: str) -> int:
    return int(hashlib.md5(key.encode()).hexdigest(), 16)

class Ring:
    def __init__(self):
        self.points = []   # sorted list of (hash, shard_name)

    def add_shard(self, shard: str):
        for v in range(VNODES):
            point = h(shard + "#" + str(v))
            bisect.insort(self.points, (point, shard))
        # Adding shard N+1 moves only ~1/(N+1) of all keys.
        # Naive "hash mod N" would move ~N/(N+1) — nearly everything.

    def remove_shard(self, shard: str):
        self.points = [(p, s) for (p, s) in self.points if s != shard]

    def lookup(self, key: str) -> str:
        if not self.points:
            raise RuntimeError("empty ring")
        i = bisect.bisect(self.points, (h(key), ""))
        if i == len(self.points):
            i = 0                      # wrap around the ring
        return self.points[i][1]

ring = Ring()
for s in ["shard-0", "shard-1", "shard-2", "shard-3"]:
    ring.add_shard(s)

ring.lookup("user:184467")   # -> deterministic shard, ~25% per shard
`,
    },
    {
      type: 'text',
      title: 'Resharding: the bill comes due',
      md: `
Whatever shard count you pick, you will outgrow it. **Resharding** — changing how keys map to shards while the
system serves production traffic — is where sharding designs go to die, so plan it on day one.

#### Two tricks that make it survivable

**1. Logical shards >> physical shards.** Instagram's classic scheme: a 64-bit ID packs **41 bits of millisecond
timestamp, 13 bits of logical shard ID (8,192 logical shards), and 10 bits of per-shard sequence** (mod 1024 —
so each logical shard can mint 1,024 IDs/ms). Those thousands of logical shards started out mapped onto just a
handful of Postgres machines. "Resharding" became *moving logical shards between machines* — a routing-table
update plus a data copy, never a re-hash of the keyspace.

**2. Online resharding, Vitess-style.** Vitess (built to scale YouTube's MySQL, now CNCF-graduated and running
Slack's MySQL fleet and Shopify-scale workloads) reshards with **VReplication**:

- Start the new target shards alongside the old ones.
- **Copy phase:** stream a consistent snapshot of rows into the targets while production continues.
- **Catch-up phase:** tail the source binlogs and apply ongoing changes until replication lag is near zero.
- **Cutover:** briefly block writes (typically **<1 s**), verify positions match, flip the routing rules in the topology store, and — crucially — keep a *reverse* replication stream so you can roll back.

> The litmus test for any sharding design: "describe your resharding procedure." If the answer involves downtime
> or a big-bang migration script, the design isn't finished.
`,
    },
    {
      type: 'text',
      title: 'Cross-shard queries and transactions: just don\'t',
      md: `
A query that can't be routed to one shard becomes a **scatter-gather**: the router fans out to all N shards, each
executes the query, and the router merges results. It works, but every property you care about degrades:

- **Latency is the max, not the average.** Your p50 becomes the *slowest* shard's p50; one slow shard drags every scatter-gather query. With 8 shards and per-shard p99 of 20 ms, fan-out p99 is roughly 1 − (0.99)^8 ≈ 8% chance of hitting a slow tail — your effective p92 is now 20 ms+.
- **Throughput divides.** A scatter-gather costs N shard-queries' worth of work, so a cluster that does 100K single-shard QPS does ~12K fan-out QPS across 8 shards.
- **Cross-shard transactions are worse.** Two-phase commit (2PC) holds locks across a network round trip on every participant, adds 2 extra RTTs (~2–10 ms), and a crashed coordinator leaves participants blocked. Spanner makes this work with TrueTime and Paxos per shard — you probably shouldn't.

#### What to do instead

- **Denormalize so reads are single-shard.** Store the data twice, keyed both ways (e.g., \`orders_by_user\` and \`orders_by_merchant\`), updated via an async pipeline.
- **Keep entities that transact together on the same shard** — shard by \`tenant_id\` so a tenant's invoices, payments, and users co-locate.
- **Push analytics out.** Cross-shard aggregations belong in a warehouse (BigQuery, Snowflake) fed by CDC, not in the OLTP path.
- **Accept sagas** (compensating actions) for the rare cross-shard write flow, instead of distributed locks.
`,
    },
    {
      type: 'text',
      title: 'Hot spots and the celebrity problem',
      md: `
Hashing spreads *keys* evenly — it does nothing about *traffic per key*. When Justin Bieber posts, every like and
comment hits **one** \`post_id\`, on one shard, on one row. Twitter, Instagram, and every social platform has a
named internal version of "the Bieber problem."

The hard numbers make it concrete: a **DynamoDB partition** caps at **10 GB of storage, 3,000 RCU and 1,000 WCU**.
A single hot partition key hitting 5,000 reads/s gets throttled no matter how much total table capacity you bought
(adaptive capacity helps, but per-partition limits still bind).

#### Mitigations, in escalation order

1. **Cache in front.** A celebrity post's content is identical for everyone — serve it from Redis/CDN and absorb 99%+ of reads before they touch a shard.
2. **Salt hot write keys.** Split \`post:123:likes\` into \`post:123:likes:0..15\` (append a random 0–15 suffix). Writes spread across 16 shards/partitions; reads sum 16 counters. You trade read cost for write headroom — standard for counters and time-series.
3. **Split the hot range/key.** Range-sharded systems (HBase, Spanner, DynamoDB adaptive capacity) detect hot ranges and split them automatically — even down to isolating a *single item* on its own partition.
4. **Special-case the celebrities.** Many feeds use fan-out-on-write for normal users but fan-out-on-read for accounts with >1M followers. A hard-coded "famous list" is ugly and ubiquitous.

> Monitor **per-shard** p99 and QPS, not cluster averages. A cluster at 30% average utilization with one shard at
> 95% is an outage in progress that your dashboard is hiding.
`,
    },
    {
      type: 'calculator',
      title: 'Try it: how much storage per shard?',
      calculator: 'storage',
    },
    {
      type: 'beforeAfter',
      title: 'Case: one overloaded Postgres → 8-shard cluster',
      scenario: {
        beforeTitle: 'Single Postgres primary doing everything',
        beforeDescription:
          'One r6i.8xlarge primary at 5.5 TB and 42K TPS — within 10% of its write ceiling. Buffer pool hit rate down to 92%, nightly backups take 6 hours, VACUUM falls behind weekly, and adding an index means a maintenance window. Every incident is a company-wide incident.',
        afterTitle: '8 hash-sharded primaries behind vtgate-style routers',
        afterDescription:
          'Keyspace split by hash(user_id) into 8,192 logical shards mapped to 8 physical primaries (each with 2 replicas). Each shard holds ~700 GB and ~6K TPS. Routers consult the topology store; resharding is a background vnode move, not a migration project.',
        metrics: [
          { label: 'Write capacity ceiling', before: '~45K TPS', after: '~360K TPS (8×)', improved: true },
          { label: 'Data per database', before: '5.5 TB', after: '~700 GB', improved: true },
          { label: 'p99 write latency (peak)', before: '85 ms', after: '9 ms', improved: true },
          { label: 'Backup / restore window', before: '6 h / 9 h', after: '40 min / 1 h per shard', improved: true },
          { label: 'Cross-entity transactions', before: 'Free (single node)', after: 'Sagas or 2PC — redesigned', improved: false },
        ],
      },
    },
  ],
  quiz: [
    {
      question:
        'You shard an events table by a timestamp-based key. What predictably goes wrong?',
      options: [
        'Reads become impossible to route',
        'Hash collisions corrupt data across shards',
        'All inserts concentrate on the shard owning the newest range — a hot shard',
        'Storage usage becomes uneven across old shards',
      ],
      answer: 2,
      explanation:
        'Monotonic keys mean every new write lands in the latest range, so one shard takes 100% of insert load while others sit idle. Use a hashed or compound key instead.',
    },
    {
      question:
        'With naive hash(key) mod N sharding, what happens when you grow from 8 to 9 shards?',
      options: [
        'Almost every key changes its owning shard, forcing a near-total data reshuffle',
        'Exactly 1/9 of keys move to the new shard',
        'Nothing moves until you manually rebalance',
        'Only keys with hash values above a threshold move',
      ],
      answer: 0,
      explanation:
        'Changing the modulus remaps ~8/9 of all keys. Consistent hashing exists precisely to fix this: adding a node moves only ~1/N of keys.',
    },
    {
      question: 'Why do consistent hashing implementations use virtual nodes?',
      options: [
        'To encrypt the routing table',
        'To smooth load imbalance and spread a removed node’s keys across all survivors',
        'To make range scans efficient',
        'To eliminate the need for a topology store',
      ],
      answer: 1,
      explanation:
        'With one ring point per server, random placement can give one server 3-4x the keyspace of another, and a failed node dumps its entire load on one neighbor. 100-256 vnodes per server fixes both.',
    },
    {
      question:
        'A DynamoDB table has 40,000 RCU provisioned, but reads of one popular item are being throttled. Why?',
      options: [
        'The table-level RCU limit was miscalculated',
        'DynamoDB throttles all reads during partition splits',
        'The item exceeds the 400 KB size limit',
        'Per-partition limits (3,000 RCU) bind regardless of total table capacity',
      ],
      answer: 3,
      explanation:
        'A single partition key lives on one partition, which caps at 3,000 RCU / 1,000 WCU / 10 GB. Total table capacity can’t help one hot key — you need caching or key salting.',
    },
    {
      question: 'What makes Vitess-style online resharding safe to run in production?',
      options: [
        'It pauses all writes for the duration of the copy',
        'It copies a snapshot, then tails binlogs to catch up, cuts over in under a second, and keeps reverse replication for rollback',
        'It only works on read replicas, never primaries',
        'It rewrites application queries to hit both old and new shards forever',
      ],
      answer: 1,
      explanation:
        'VReplication’s copy + catch-up + brief cutover pattern keeps downtime sub-second, and the reverse stream means a bad cutover can be undone — the property that makes teams actually willing to reshard.',
    },
  ],
  interviewQuestions: [
    {
      question: 'Your Postgres database is hitting its write limits. Walk me through your options before and after deciding to shard.',
      hint: 'Expected order: vertical scaling (state the ~50K TPS / few-TB practical ceiling), caching and write batching, read replicas (don’t help writes), vertical table partitioning, then sharding. For sharding: shard key choice, routing layer, and what breaks (transactions, joins, unique constraints).',
      difficulty: 'Junior',
    },
    {
      question: 'How would you pick the shard key for a multi-tenant SaaS (think Slack workspaces)?',
      hint: 'Look for: tenant_id keeps each tenant’s queries single-shard and transactions intra-tenant; discuss the whale-tenant problem (one workspace bigger than a shard) and answers — directory-based placement so big tenants get dedicated shards, or sub-sharding the whale by channel/user.',
      difficulty: 'Mid',
    },
    {
      question: 'Design Instagram’s photo ID and sharding scheme. Why generate IDs that embed the shard?',
      hint: 'Expect the 41-bit timestamp + 13-bit logical shard + 10-bit sequence layout, why IDs are roughly time-sortable (feed ordering without a join), why logical shards (8,192) decouple from physical machines, and how resharding becomes a routing-table move.',
      difficulty: 'Senior',
    },
    {
      question: 'A scatter-gather query across your 16 shards has terrible p99. Diagnose and fix.',
      hint: 'Structure: tail-at-scale math (p99 of fan-out ≈ chance any shard is slow — with 16 shards you hit a per-shard p99 event ~15% of the time), then fixes: denormalized single-shard read models, hedged/backup requests after p95, partial results with timeouts, moving the query to an async/analytics path.',
      difficulty: 'Senior',
    },
  ],
  commonMistakes: [
    'Sharding too early. A few TB and <40K TPS fits one well-tuned Postgres plus replicas — sharding before that trades a hardware problem for a permanent engineering tax.',
    'Choosing the shard key to match today’s biggest table instead of the dominant query pattern. If 95% of reads are per-user, shard by user_id even if orders is the big table.',
    'Shipping hash mod N because consistent hashing "seemed complicated." The first capacity expansion then requires migrating ~90% of your data.',
    'Designing the happy path and hand-waving resharding. If you can’t describe the online copy + catch-up + cutover procedure, you’ve designed a system you can’t grow.',
    'Watching cluster-average dashboards. Hot shards hide in averages — alert on per-shard p99, per-shard QPS, and max/min shard skew ratio.',
  ],
  cloudMappings: [
    { concept: 'Managed sharded SQL (MySQL)', aws: 'Aurora Limitless / RDS + Vitess on EKS', gcp: 'Cloud SQL + Vitess on GKE / PlanetScale', azure: 'Azure Database for MySQL + Vitess on AKS' },
    { concept: 'Hash-partitioned NoSQL', aws: 'DynamoDB (partition key)', gcp: 'Bigtable (row-key ranges) / Firestore', azure: 'Cosmos DB (partition key)' },
    { concept: 'Distributed SQL (auto-sharding)', aws: 'Aurora DSQL', gcp: 'Spanner', azure: 'Cosmos DB for PostgreSQL (Citus)' },
    { concept: 'Postgres extension sharding', aws: 'RDS + pg_partman / Citus self-managed', gcp: 'AlloyDB + Citus self-managed', azure: 'Cosmos DB for PostgreSQL (managed Citus)' },
    { concept: 'Topology / config store', aws: 'etcd or ZooKeeper on EC2/EKS', gcp: 'etcd on GKE', azure: 'etcd on AKS' },
    { concept: 'CDC pipeline for denormalized views', aws: 'DMS / DynamoDB Streams + Kinesis', gcp: 'Datastream + Pub/Sub', azure: 'Change feed + Event Hubs' },
  ],
}

export default sharding
