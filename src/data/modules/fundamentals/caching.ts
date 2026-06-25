import type { Module } from '../../../lib/types'

const caching: Module = {
  id: 'caching',
  category: 'fundamentals',
  title: 'Caching Strategies',
  description:
    'The highest-leverage optimization in system design. Learn the five caching patterns, eviction policies, why invalidation is genuinely hard, and how to survive a cache stampede.',
  difficulty: 'Junior',
  estMinutes: 130,
  keywords: ['cache-aside', 'write-through', 'LRU', 'TTL', 'Redis', 'Memcached', 'cache stampede', 'hit ratio'],
  related: ['cdn-edge', 'databases', 'scalability', 'design-instagram'],
  sections: [
    {
      type: 'text',
      title: 'Why caching is the highest-leverage optimization',
      md: `
A cache trades cheap RAM for expensive repeated work. The numbers are brutal: a Postgres query that touches disk
costs **5–10 ms**; the same value from Redis costs **0.2–0.5 ms**; from in-process memory, **under 1 µs**. One Redis
node sustains **~100,000 ops/second at sub-millisecond latency**. To match that with a relational database you'd
need a fleet.

The economics work because most workloads are wildly skewed. Real traffic follows a Zipf distribution: roughly
**20% of keys serve 80%+ of reads** (Twitter reported that caching ~1% of their data served the majority of reads).
So a cache holding a small fraction of your dataset absorbs most of your traffic.

The math you must be able to do in an interview is **effective latency**:

> effective latency = hit_ratio × cache_latency + (1 − hit_ratio) × backend_latency

At 99% hit ratio with a 0.5 ms cache and 10 ms DB: 0.99 × 0.5 + 0.01 × 10 = **0.6 ms average**. Drop to 90% and it's
1.45 ms, and your database now eats **10× the miss traffic**. Hit ratio improvements matter most at the top: going
from 98% → 99% *halves* database load.

Cost check: cloud RAM runs **$2–4/GB-month** (an ElastiCache \`cache.r7g.large\` gives ~13 GB for ~$120/month)
versus **~$0.08/GB-month** for gp3 SSD. RAM is ~30–50× pricier per byte but ~1,000× faster per access. For hot
data, that trade is a steal.
`,
    },
    {
      type: 'text',
      title: 'Read patterns: cache-aside and read-through',
      md: `
#### Cache-aside (lazy loading): the default

The application owns the logic: check the cache; on miss, read the database, then write the value into the cache
with a TTL. **90% of caching in the wild is cache-aside on Redis.**

- **Pros:** only requested data gets cached; cache failure degrades to "slow," not "down"; works with any backend.
- **Cons:** every miss pays three trips (cache miss + DB read + cache set); first request after expiry is always
  slow; the application carries the invalidation burden.

#### Read-through

The cache itself sits in front of the database and loads misses transparently; the app talks only to the cache.
DynamoDB Accelerator (DAX) and most CDN behavior work this way, and libraries like Caffeine give you read-through
in-process.

- **Pros:** application code is trivially simple; loading logic lives in one place, which makes **request
  coalescing** (one loader per key, covered below) easy to bolt on.
- **Cons:** you need cache infrastructure that understands your data source; cold starts still hammer the backend
  unless you pre-warm.

The practical difference is *who is responsible for misses*: your code (cache-aside) or the cache layer
(read-through). In interviews, say cache-aside by default and reach for read-through when you control the cache
tier and want coalescing for free.
`,
    },
    {
      type: 'text',
      title: 'Write patterns: through, behind, and around',
      md: `
#### Write-through

Every write goes to the cache **and** the database synchronously before acking the client. The cache is never
stale for written keys.

- **Cost:** write latency = cache write + DB write (~1 ms + ~5 ms). You also cache data that may never be read.
- **Use when:** read-after-write consistency matters, such as user profile edits, settings, shopping carts.

#### Write-behind (write-back)

Acknowledge after writing the cache only; flush to the database asynchronously, often batched. Writes complete in
**under 1 ms**, and batching 100 writes into one bulk insert can cut DB write load **10–50×**.

- **The catch:** a cache node crash before flush **loses acknowledged writes**. Only acceptable for tolerable-loss
  data (view counters, telemetry) or with a durable buffer (Redis AOF, or a queue like Kafka in front).

#### Write-around

Writes go straight to the database, skipping the cache; the key enters the cache only when read (via cache-aside).
Perfect for write-heavy, rarely-read data (audit logs, bulk imports) because it keeps churn out of your precious
RAM.

> Rule of thumb: cache-aside reads + write-around writes is the boring, safe default. Add write-through for keys
> needing read-your-writes. Reach for write-behind only when write volume is the bottleneck *and* you can lose a
> few seconds of data.
`,
    },
    {
      type: 'comparison',
      title: 'Design decision: Redis vs Memcached',
      comparison: {
        columns: ['Criterion', 'Redis', 'Memcached'],
        rows: [
          ['Data model', 'Strings, hashes, lists, sets, sorted sets, streams', 'Strings/blobs only'],
          ['Threading', 'Single-threaded core (+ I/O threads in 6.0+); ~100–200K ops/s/node', 'Multi-threaded; ~1M ops/s on a 32-core box'],
          ['Persistence', 'RDB snapshots + AOF log; can survive restarts', 'None; pure volatile cache'],
          ['Replication & HA', 'Built-in replicas, Sentinel, Redis Cluster', 'None built in (client-side sharding only)'],
          ['Eviction', 'LRU, LFU, TTL, random; per-policy config', 'Slab-based LRU (memory-efficient for uniform sizes)'],
          ['Memory efficiency', 'Higher overhead per key (~90 bytes)', 'Lower overhead (~50 bytes); slabs avoid fragmentation'],
          ['Use it for', 'Default choice: sessions, leaderboards, queues, rate limits', 'Pure ephemeral page/object cache at extreme throughput'],
        ],
        verdict:
          'Pick Redis unless you specifically need a dead-simple, multi-threaded blob cache and nothing else: the data structures and HA story make Redis the default in 2025 (Valkey if you want the open-source fork).',
      },
    },
    {
      type: 'text',
      title: 'Eviction policies: LRU, LFU, and TTL',
      md: `
Caches are finite; something must go. The eviction policy decides *what*, and it directly sets your hit ratio.

- **LRU (Least Recently Used):** evict what was touched longest ago. Great for temporal locality (a user browsing
  their own feed). Redis implements *approximate* LRU: it samples 5 random keys and evicts the stalest, which gets
  within a few percent of true LRU at a fraction of the bookkeeping cost.
- **LFU (Least Frequently Used):** evict what is accessed *least often*. Better when popularity is stable
  (product catalog, reference data) because one accidental scan can't flush your genuinely hot keys the way it
  can with LRU. Redis \`allkeys-lfu\` uses a decaying counter so old popularity fades.
- **TTL (time-to-live):** not strictly eviction but expiry: every key gets a lifetime (60 s for volatile data,
  hours for stable data). TTL is your **invalidation safety net**: even if every explicit invalidation fails,
  staleness is bounded by the TTL.

Two production tips:

1. **Jitter your TTLs.** Setting 10,000 keys to exactly 3600 s means they all expire in the same second: a
   synchronized miss storm. Use 3600 ± random(300).
2. **Watch the eviction rate metric.** Sustained evictions with a sub-90% hit ratio means the cache is too small;
   sizing it to hold your working set (use the calculator below) is cheaper than the DB capacity to absorb misses.
`,
    },
    {
      type: 'diagram',
      title: 'Multi-level caching: browser to database',
      caption:
        'Each layer absorbs traffic before it reaches the next. A request that hits the browser cache costs 0 ms of network; one that falls all the way through costs a DB query.',
      diagram: {
        height: 380,
        nodes: [
          {
            id: 'browser',
            label: 'Browser cache',
            kind: 'client',
            x: 20,
            y: 170,
            detail:
              'HTTP caching via Cache-Control / ETag headers. A hit costs ~0 ms and zero server load. Static assets with max-age=31536000 plus hashed filenames never re-download.',
          },
          {
            id: 'cdn',
            label: 'CDN edge',
            kind: 'cdn',
            x: 210,
            y: 170,
            detail:
              'CloudFront/Fastly POP near the user, ~10–30 ms away. Serves 90%+ of static and cacheable API responses; egress at ~$0.08/GB instead of hitting your origin.',
          },
          {
            id: 'app',
            label: 'App server',
            kind: 'server',
            x: 400,
            y: 170,
            detail:
              'Origin application. Checks L1 (in-process), then L2 (Redis), then falls through to Postgres. Each layer it skips saves 0.2–10 ms.',
          },
          {
            id: 'l1',
            label: 'In-process L1',
            kind: 'cache',
            x: 590,
            y: 60,
            detail:
              'Caffeine/Guava map inside the process: ~100 ns per hit, zero network. Small (100 MB–1 GB) and per-node, so it duplicates data and staleness is per-instance; keep TTLs to seconds.',
          },
          {
            id: 'redis',
            label: 'Redis L2',
            kind: 'cache',
            x: 590,
            y: 270,
            detail:
              'Shared cache tier: ~100K ops/s/node at 0.2–0.5 ms. One consistent view for all app servers. Cluster mode shards keys across nodes for capacity beyond one box.',
          },
          {
            id: 'db',
            label: 'PostgreSQL',
            kind: 'db',
            x: 800,
            y: 170,
            detail:
              'Source of truth. A well-indexed point query costs 1–10 ms and real CPU. The whole pyramid above exists so this node sees only the ~1–5% of reads that miss everywhere else.',
          },
        ],
        edges: [
          { from: 'browser', to: 'cdn', label: 'miss → HTTPS' },
          { from: 'cdn', to: 'app', label: 'miss → origin' },
          { from: 'app', to: 'l1', label: 'check L1' },
          { from: 'app', to: 'redis', label: 'L1 miss → L2' },
          { from: 'redis', to: 'db', label: 'L2 miss → SQL', dashed: true },
        ],
      },
    },
    {
      type: 'calculator',
      title: 'Try it: size your cache',
      calculator: 'cache-sizing',
    },
    {
      type: 'text',
      title: 'Invalidation pain and the hot key problem',
      md: `
> As Phil Karlton put it: "There are only two hard things in Computer Science: cache invalidation and naming things."

The pain is real because invalidation is a **distributed consistency problem in disguise**. The classic bug:
process A updates the DB and deletes the cache key; process B, mid-flight with the *old* value, repopulates the
cache after A's delete. Now the cache serves stale data until TTL expiry. Mitigations, in increasing rigor:

- **Delete, don't update**, the cache on writes (smaller race window, idempotent).
- **Short TTLs as a backstop**: bound staleness to something the product tolerates (30–300 s).
- **CDC-driven invalidation**: tail the database changelog (Debezium → Kafka) and invalidate from a single ordered
  stream. This is how Facebook's memcache layer stays consistent at scale (see the *TAO/memcache* papers).

#### Hot keys

A uniform cluster dies non-uniformly. When one key gets disproportionate traffic (a celebrity's profile, a viral
post, a global config flag), **every request for it lands on the one shard that owns it**. A Redis node doing
100K ops/s tips over when a single key alone draws 300K ops/s, while its neighbors idle.

Fixes:

- **Replicate the key**: write \`config:flag:1\` … \`config:flag:10\` and have clients read a random suffix, giving
  10× the read capacity for one key.
- **L1 in-process cache** for the hottest few hundred keys: even a 1-second local TTL absorbs almost all reads
  for a viral key.
- **Detect first**: sample commands (\`redis-cli --hotkeys\`, or client-side metrics), because hot keys are invisible in
  average-load dashboards.
`,
    },
    {
      type: 'text',
      title: 'Thundering herd: cache stampede and request coalescing',
      md: `
A **cache stampede** (thundering herd) happens when a popular key expires and *every* concurrent request misses at
once. If a key serving 5,000 req/s expires and the DB query takes 200 ms, you get **~1,000 identical queries**
slamming the database in the gap, which slows the query further, which lets more requests pile up. This exact
failure mode has taken down major sites during traffic spikes; it's a favorite interview probe.

Three defenses, often combined:

1. **Request coalescing (single-flight).** Only the *first* miss for a key fetches from the DB; concurrent misses
   wait on that one in-flight result. Go's \`singleflight\` package, or a Redis \`SET key NX EX 10\` lock, turns
   1,000 queries into 1.
2. **Probabilistic early refresh (XFetch).** Each request *may* refresh the value slightly before expiry, with
   probability rising as the deadline nears. Hot keys are refreshed before they ever expire; cold keys just lapse.
3. **Stale-while-revalidate.** Serve the expired value immediately and refresh in the background. CDNs ship this
   as a header (\`stale-while-revalidate=60\`); app caches implement it with a soft TTL inside the value.

Related: a **cold-start herd** after a cache flush or new cluster. Mitigate by warming the cache from a key-access
log before taking traffic, and by enabling traffic gradually (10% → 50% → 100%).

> Senior signal: mention that coalescing belongs per app instance *and* globally. 200 app servers each doing
> single-flight still send 200 concurrent queries without a shared lock or read-through tier.
`,
    },
    {
      type: 'code',
      title: 'Cache-aside with stampede protection (pseudocode)',
      language: 'python',
      code: `
# Cache-aside read path with: TTL jitter, single-flight lock, stale-while-revalidate
import random, time

TTL = 300                 # hard TTL (seconds)
SOFT_TTL = 240            # refresh after this; serve stale meanwhile
LOCK_TTL = 10             # max time one loader may hold the lock

def get_user(user_id):
    key = "user:" + str(user_id)
    entry = cache.get(key)             # ~0.3 ms to Redis

    if entry is not None:
        if entry.age < SOFT_TTL:
            return entry.value                       # fresh hit (the 95%+ path)
        # Soft-expired: serve stale, refresh in background if we win the lock
        if cache.set(key + ":lock", 1, nx=True, ex=LOCK_TTL):
            background(refresh, key, user_id)        # one refresher per key
        return entry.value                           # stale-while-revalidate

    # Hard miss: single-flight so 1,000 concurrent misses -> 1 DB query
    if cache.set(key + ":lock", 1, nx=True, ex=LOCK_TTL):
        value = db.query("SELECT * FROM users WHERE id = %s", user_id)  # 5-10 ms
        jitter = random.randint(0, 60)               # avoid synchronized expiry
        cache.set(key, wrap(value), ex=TTL + jitter)
        cache.delete(key + ":lock")
        return value
    else:
        time.sleep(0.05)                             # losers wait ~50 ms and retry
        return get_user(user_id)                     # winner has filled it by now

def refresh(key, user_id):
    value = db.query("SELECT * FROM users WHERE id = %s", user_id)
    cache.set(key, wrap(value), ex=TTL + random.randint(0, 60))
    cache.delete(key + ":lock")

# Write path: update DB first, then DELETE (not update) the cache key.
def update_user(user_id, fields):
    db.execute("UPDATE users SET ... WHERE id = %s", user_id)
    cache.delete("user:" + str(user_id))   # next read repopulates
`,
    },
    {
      type: 'beforeAfter',
      title: 'Case: adding a cache layer to a read-heavy API',
      scenario: {
        beforeTitle: 'Every read hits Postgres',
        beforeDescription:
          'Product-catalog API doing 8,000 read QPS straight against a db.r6g.2xlarge ($1,050/month). CPU sits at 90%, p99 is 450 ms, and every marketing email triggers a near-outage. Scaling the instance again doubles the bill for ~40% more headroom.',
        afterTitle: 'Cache-aside Redis tier in front',
        afterDescription:
          'Two cache.r7g.large Redis nodes ($240/month) with 5-minute jittered TTLs and single-flight loading. Hit ratio stabilizes at 95%, so Postgres sees ~400 QPS of misses plus writes, and it was downsized one instance class.',
        metrics: [
          { label: 'DB read load', before: '8,000 QPS', after: '~400 QPS', improved: true },
          { label: 'p99 read latency', before: '450 ms', after: '12 ms', improved: true },
          { label: 'Infra cost (DB + cache)', before: '$1,050/mo', after: '$765/mo', improved: true },
          { label: 'Data staleness bound', before: '0 s (always fresh)', after: '≤ 5 min on cached keys', improved: false },
        ],
      },
    },
  ],
  quiz: [
    {
      question:
        'Your cache has a 0.5 ms hit latency and your DB a 10 ms query. At a 99% hit ratio, what is the approximate effective average latency?',
      options: ['5.25 ms', '0.5 ms', '~0.6 ms', '1.45 ms'],
      answer: 2,
      explanation:
        '0.99 × 0.5 ms + 0.01 × 10 ms = 0.495 + 0.1 ≈ 0.6 ms. Note that dropping to 90% hits gives 1.45 ms, and 10× the DB miss traffic.',
    },
    {
      question: 'Which write strategy can lose acknowledged writes if a cache node crashes?',
      options: ['Write-behind (write-back)', 'Write-through', 'Write-around', 'Cache-aside'],
      answer: 0,
      explanation:
        'Write-behind acks after writing only the cache and flushes to the DB asynchronously, so anything buffered but not yet flushed dies with the node. Use it only for tolerable-loss data or with a durable buffer.',
    },
    {
      question:
        'A key serving 5,000 req/s expires, and the underlying DB query takes 200 ms. Without protection, roughly how many duplicate queries hit the DB?',
      options: ['1', '~50', '~200', '~1,000'],
      answer: 3,
      explanation:
        'All requests arriving during the 200 ms refill window miss: 5,000 req/s × 0.2 s ≈ 1,000 identical queries. Single-flight locking or stale-while-revalidate collapses them to one.',
    },
    {
      question: 'When is Memcached a better choice than Redis?',
      options: [
        'You need leaderboards backed by sorted sets',
        'You need a simple volatile blob cache at maximum multi-threaded throughput',
        'You need data to survive a restart',
        'You need built-in replication and failover',
      ],
      answer: 1,
      explanation:
        'Memcached is multi-threaded (≈1M ops/s on a big box) and memory-efficient, but offers no data structures, persistence, or replication. Everything in the other options is a reason to pick Redis.',
    },
    {
      question: 'One Redis shard is melting because a single viral post key receives 300K reads/s. The standard fix is:',
      options: [
        'Increase the TTL on that key',
        'Switch the eviction policy to LFU',
        'Replicate the key under N suffixed copies (or add an in-process L1) so reads spread out',
        'Move the key to the database',
      ],
      answer: 2,
      explanation:
        'A hot key is bound to one shard regardless of cluster size. Writing N copies under suffixed keys and reading a random one multiplies capacity by N; a tiny local L1 cache achieves the same by absorbing reads before Redis.',
    },
  ],
  interviewQuestions: [
    {
      question: 'Walk me through what happens on a cache miss in a cache-aside setup, and what can go wrong.',
      hint: 'Expected flow: check cache → miss → read DB → set cache with TTL → return. Go-wrong list: stampede on popular keys, the delete/repopulate race serving stale data, unbounded objects evicting the working set, and the 3-trip latency cost of misses.',
      difficulty: 'Junior',
    },
    {
      question: 'How would you keep a cache reasonably consistent with the database when product data is updated?',
      hint: 'Layered answer: delete-on-write (not update) to shrink the race window, TTL as a staleness bound, then CDC (Debezium → Kafka → invalidator) for ordered, reliable invalidation. Mention read-your-writes needs (write-through or session pinning) and that perfect coherence is not the goal; bounded staleness is.',
      difficulty: 'Mid',
    },
    {
      question: 'Your site is fronted by a CDN, Redis, and in-process caches. A bad value got cached at every layer. How do you purge it, and how do you prevent recurrence?',
      hint: 'Purge order matters: fix origin → purge CDN (surrogate keys/cache tags beat URL purges) → delete Redis keys → bump a version prefix or wait out the short L1 TTL. Prevention: versioned cache keys (v2:user:123), short L1 TTLs, validation before caching, and canary-checking cached payloads.',
      difficulty: 'Mid',
    },
    {
      question: 'Design the caching layer for a product page serving 200K QPS globally during a flash sale. Address stampedes, hot keys, and invalidation when prices change.',
      hint: 'Multi-level: CDN with stale-while-revalidate for the page shell, regional Redis clusters for fragments, in-process L1 for the hottest SKUs. Stampede: single-flight per instance + a global lock or read-through tier. Hot keys: suffix replication. Price changes: CDC-driven purge with surrogate keys, plus a hard rule that the checkout path reads the DB, never the cache, for the authoritative price.',
      difficulty: 'Senior',
    },
  ],
  commonMistakes: [
    'Caching without a TTL "because we invalidate explicitly." Invalidation paths fail silently; a TTL is the backstop that turns a forever-stale bug into a 5-minute blip.',
    'Updating the cache on write instead of deleting it. Two concurrent writers can interleave so the cache ends up with the older value permanently; delete is idempotent and race-resistant.',
    'Quoting a hit ratio without saying what a miss costs. 95% sounds great until the 5% is a 800 ms scatter-gather query that saturates the DB during any cache restart.',
    'Ignoring the cold-start problem: deploying a cache flush (or a new cluster) at peak traffic sends 100% of reads to a database that has been sized for 5% of them. Warm before you cut over.',
    'Treating Redis as a cache and a database simultaneously without deciding on persistence. With persistence off, a failover loses everything; with AOF on, you have a slower cache. Pick per use case, explicitly.',
  ],
  cloudMappings: [
    { concept: 'Managed Redis-compatible cache', aws: 'ElastiCache (Redis OSS / Valkey)', gcp: 'Memorystore for Redis', azure: 'Azure Cache for Redis' },
    { concept: 'Managed Memcached', aws: 'ElastiCache (Memcached)', gcp: 'Memorystore for Memcached', azure: '– (use Redis Basic tier)' },
    { concept: 'CDN / edge cache', aws: 'CloudFront', gcp: 'Cloud CDN', azure: 'Azure Front Door' },
    { concept: 'Read-through cache for NoSQL', aws: 'DynamoDB Accelerator (DAX)', gcp: '– (Memorystore + app logic)', azure: 'Cosmos DB integrated cache' },
    { concept: 'API response caching', aws: 'API Gateway cache ($0.02/hr/GB)', gcp: 'Apigee response cache', azure: 'API Management built-in cache' },
    { concept: 'Serverless / autoscaling cache', aws: 'ElastiCache Serverless', gcp: 'Memorystore (provisioned only)', azure: 'Azure Cache Enterprise Flash' },
  ],
}

export default caching
