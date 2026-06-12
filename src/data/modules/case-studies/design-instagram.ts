import type { Module } from '../../../lib/types'

const designInstagram: Module = {
  id: 'design-instagram',
  category: 'case-studies',
  title: 'Design Instagram / Twitter Feed',
  description:
    'The classic feed interview, end to end: requirements, capacity math at 500M DAU, the fan-out-on-write vs fan-out-on-read decision, the celebrity problem, and serving 100M photos/day through a CDN.',
  difficulty: 'Mid',
  estMinutes: 160,
  keywords: ['news feed', 'fan-out', 'timeline', 'celebrity problem', 'fan-out on write', 'fan-out on read', 'social graph', 'feed ranking'],
  related: ['caching', 'sharding', 'cdn-edge', 'design-notifications'],
  sections: [
    {
      type: 'text',
      title: 'Step 1: Requirements clarification',
      md: `
Never start drawing boxes. Spend the first 5 minutes scoping — interviewers grade this as heavily as the design.

#### Functional requirements (agree on these)

- **Post a photo** with a caption (and video — but *cut it*: "I'll treat media as opaque blobs; video transcoding is its own interview").
- **Follow** other users (one-directional graph, like Twitter/Instagram).
- **Home feed**: a scrollable list of recent posts from people you follow, newest-ish first.
- **Like / comment** — keep counts, cut threading.

#### Explicit scope cuts (say them out loud)

- ❌ Stories, DMs, Reels, search, ads, recommendations ("Explore")
- ❌ ML feed ranking — design for reverse-chronological, note where a ranker would slot in
- ❌ Notifications (point to it as a separate system)

#### Non-functional requirements (drive the whole design)

- **Scale**: 500M DAU, ~100M photo uploads/day, read-heavy at roughly **100:1** reads to writes.
- **Feed latency**: p99 **< 200 ms** to first screen of the feed — this single number forces precomputation.
- **Availability over consistency**: 99.95%. It's fine if a follower sees your post 30 seconds late (**eventual consistency**); it's not fine if the feed is down.
- **Durability**: uploaded photos are never lost — 11 nines on the blob store.

> The key insight to state early: this is a **read-dominated** system. Everything that follows — caching,
> precomputed feeds, CDN — exists because reads outnumber writes ~100:1.
`,
    },
    {
      type: 'code',
      title: 'Step 2: Capacity estimation (do this math on the whiteboard)',
      language: 'python',
      code: `
# ---- Inputs (state your assumptions, get them blessed) ----
DAU             = 500_000_000
posts_per_day   = 100_000_000      # ~20% of DAU post 1 photo/day
feed_loads_per_user = 10           # sessions x refreshes
peak_factor     = 3

SECONDS_PER_DAY = 86_400           # round to 100K for mental math

# ---- Write path (uploads) ----
upload_qps      = posts_per_day / SECONDS_PER_DAY        # ~1,200 QPS
peak_upload_qps = upload_qps * peak_factor               # ~3,500 QPS

# ---- Read path (feeds) ----
feed_qps        = DAU * feed_loads_per_user / SECONDS_PER_DAY   # ~58,000 QPS
peak_feed_qps   = feed_qps * peak_factor                        # ~175,000 QPS
# Read:write ratio ~ 58K / 1.2K ~ 50:1 on requests;
# counting photo views (each feed load shows ~20 photos) it's >100:1.

# ---- Storage (media dominates everything) ----
avg_original    = 2 * 1024**2            # 2 MB per uploaded photo
variants        = 0.5 * 1024**2          # thumb + feed + full-size renditions
per_photo       = avg_original + variants                 # 2.5 MB
media_per_day   = posts_per_day * per_photo               # ~250 TB/day
media_per_year  = media_per_day * 365                     # ~91 PB/year (!)
# With 3x replication / erasure coding overhead (~1.5x): 135-270 PB/yr.
# Conclusion to say out loud: media goes in object storage + CDN,
# NEVER in the database.

# ---- Metadata (tiny by comparison) ----
row_size        = 500                     # post id, user id, caption, URL, ts
meta_per_year   = posts_per_day * row_size * 365          # ~18 TB/year
# Fits a sharded Postgres/Cassandra easily. Media : metadata ~ 5000 : 1.

# ---- Fan-out write amplification (the hidden cost) ----
avg_followers   = 200
fanout_writes   = posts_per_day * avg_followers           # 20 BILLION/day
fanout_wps      = fanout_writes / SECONDS_PER_DAY         # ~230K writes/sec
# One upload (1.2K QPS) becomes 230K cache writes/sec. This number is
# why the push-vs-pull decision is the heart of this interview.
`,
    },
    {
      type: 'calculator',
      title: 'Try it: size the photo storage yourself',
      calculator: 'storage',
    },
    {
      type: 'diagram',
      title: 'Step 3: High-level architecture',
      caption:
        'Read path: clients hit the CDN for media and the feed service for timelines. Write path: upload to object storage, write metadata, then fan out asynchronously through a queue.',
      diagram: {
        height: 520,
        nodes: [
          { id: 'clients', label: 'Clients', kind: 'client', x: 30, y: 240, detail: '500M DAU on mobile + web. ~175K feed QPS at peak, ~3.5K upload QPS. Clients upload media via pre-signed URLs so 2 MB photos never transit the app servers.' },
          { id: 'cdn', label: 'CDN', kind: 'cdn', x: 215, y: 90, detail: 'Serves ~95% of media bytes from edge caches (CloudFront/Akamai). Edge hit: ~20-50 ms; origin miss: +100-200 ms. Offloads ~250+ TB/day of egress from origin.' },
          { id: 'lb', label: 'Load Balancer', kind: 'lb', x: 215, y: 330, detail: 'Terminates TLS and spreads ~175K peak API QPS across stateless app servers. Health checks eject bad nodes in seconds.' },
          { id: 'app', label: 'App Servers', kind: 'server', x: 410, y: 330, detail: 'Stateless API tier: auth, validation, orchestration. At ~1K QPS/node, peak needs ~175 nodes + 30% headroom → ~230. Autoscaled.' },
          { id: 's3', label: 'Object Storage', kind: 'storage', x: 410, y: 90, detail: 'S3-class blob store: ~91 PB/year of photos at 11 nines durability. Stores original + 3-4 pre-generated renditions (thumb 50 KB, feed 200 KB, full 500 KB-2 MB).' },
          { id: 'queue', label: 'Fan-out Queue', kind: 'queue', x: 615, y: 80, detail: 'Kafka. Each new post becomes one event; workers expand it to followers. Absorbs celebrity spikes: a 100M-follower post queues instead of melting the cache tier.' },
          { id: 'workers', label: 'Fan-out Workers', kind: 'service', x: 830, y: 80, detail: 'Read follower lists from the graph store and push the post ID into each follower\'s Redis timeline. Sustains ~230K timeline writes/sec average, millions/sec burst.' },
          { id: 'feedsvc', label: 'Feed Service', kind: 'service', x: 615, y: 240, detail: 'GET /feed: read precomputed post-ID list from Redis (~1 ms), hydrate post metadata (cache-first), return 20 items. p99 target <200 ms end-to-end.' },
          { id: 'cache', label: 'Feed Cache', kind: 'cache', x: 830, y: 240, detail: 'Redis cluster: per-user timeline = list of ~800 post IDs ≈ 10 KB. 500M users × 10 KB ≈ 5 TB across ~100 nodes. Only active users kept hot; inactives rebuilt on demand.' },
          { id: 'db', label: 'Metadata DB', kind: 'db', x: 615, y: 400, detail: 'Sharded store (Cassandra or Postgres sharded by user_id) for posts, users, and the follow graph. ~18 TB/year of post rows — trivial next to media. Follow graph: ~100B edges.' },
        ],
        edges: [
          { from: 'clients', to: 'cdn', label: 'GET media' },
          { from: 'cdn', to: 's3', label: 'origin pull', dashed: true },
          { from: 'clients', to: 'lb', label: 'API (HTTPS)' },
          { from: 'lb', to: 'app' },
          { from: 'app', to: 's3', label: 'pre-signed PUT' },
          { from: 'app', to: 'db', label: 'write post row' },
          { from: 'app', to: 'queue', label: 'PostCreated' },
          { from: 'queue', to: 'workers' },
          { from: 'workers', to: 'cache', label: 'push post IDs' },
          { from: 'app', to: 'feedsvc', label: 'GET /feed' },
          { from: 'feedsvc', to: 'cache', label: 'read timeline' },
          { from: 'feedsvc', to: 'db', label: 'hydrate', dashed: true },
        ],
      },
    },
    {
      type: 'text',
      title: 'Step 4: The core problem — generating the feed',
      md: `
This is the heart of the interview. When user A loads their feed, where does it come from?

#### Option 1: Fan-out-on-read (pull)

Compute the feed at read time: fetch A's followee list (say 200 accounts), query the latest posts from each shard,
merge-sort, return 20. Writes are cheap — posting is one DB insert. But every feed load is a **scatter-gather across
~200 users' data on dozens of shards**, easily 50–500 ms of tail-latency pain — at 175K QPS peak. The p99 < 200 ms
target is basically unreachable. Early Twitter worked this way and fell over regularly (remember the fail whale).

#### Option 2: Fan-out-on-write (push)

Precompute. When A posts, a background job pushes the post ID into the cached timeline of **every follower**. Reads
become a single Redis list fetch: ~1 ms, trivially meeting the latency budget. The cost moves to write time:
**write amplification** = average followers ≈ 200×, so 100M posts/day → **20B timeline writes/day (~230K/sec)**.
Acceptable — until a celebrity posts.

#### The Justin Bieber problem

When an account with **100M+ followers** posts, push fan-out must perform 100M cache writes *for one post*. At even
1M writes/sec that's ~100 seconds of queue-clogging work, repeated for every celebrity post — and most of those
timelines belong to inactive users who'll never read the entry. Twitter engineers literally talked about
infrastructure "melting" when Bieber tweeted; this single edge case is why nobody runs pure push at scale.

> State the trade explicitly: pull optimizes writes and wrecks read latency; push optimizes reads and wrecks
> celebrity writes. The answer is to refuse to choose — hybrid.
`,
    },
    {
      type: 'comparison',
      title: 'Fan-out strategies compared',
      comparison: {
        columns: ['Criterion', 'Fan-out-on-read (pull)', 'Fan-out-on-write (push)', 'Hybrid'],
        rows: [
          ['Feed read latency', '50-500 ms scatter-gather across shards', '~1-5 ms (one Redis list read)', '~5-20 ms (cached list + merge few celebrities)'],
          ['Cost when a user posts', 'One insert — O(1)', 'O(followers): 200 avg, 100M worst case', 'O(followers) capped — celebrities skip fan-out'],
          ['Write amplification', 'None', '~200× avg → 20B timeline writes/day', '~200× for normal users only'],
          ['Celebrity post (100M followers)', 'No extra write cost (reads pay instead)', '~100M cache writes per post — the melt-down case', 'Zero fan-out; merged at read time by followers'],
          ['Inactive users (80%+ of accounts)', 'No wasted work', 'Timelines written that nobody reads', 'Skip fan-out for dormant users; rebuild on return'],
          ['Freshness', 'Always live', 'Seconds of fan-out lag (eventual)', 'Seconds for normals; instant for celebrity merge'],
          ['Complexity', 'Low concept, brutal read path', 'Moderate: queue + workers + cache fleet', 'Highest: two paths + threshold tuning'],
        ],
        verdict:
          'Hybrid wins at scale: push for the ~99.9% of users with <10K followers, pull-and-merge for celebrities, and no fan-out at all for dormant accounts. This is essentially what Twitter runs.',
      },
    },
    {
      type: 'text',
      title: 'Deep dive: the hybrid approach (what Twitter actually does)',
      md: `
Twitter's home timeline (per their published engineering talks) is the canonical hybrid:

- **Normal users (push).** On tweet, a fan-out service reads the follower list and inserts the tweet ID into each follower's **Redis timeline list** (capped around ~800 entries). Historically ~4,000+ tweets/sec triggered an average fan-out of **~hundreds of thousands of timeline inserts/sec**, with delivery typically completing in a few seconds.
- **Celebrities (pull).** Accounts above a follower threshold (order of **tens of thousands–100K+**) are *excluded* from fan-out. At read time, the feed service fetches your precomputed timeline, then fetches recent posts from the handful of celebrities you follow (a tiny, **heavily cached** set — one cache entry serves millions of followers), and merge-sorts the two lists.
- **Dormant users (neither).** ~80% of registered accounts aren't daily-active. Skip fan-out for anyone inactive for ~30 days; if they return, rebuild their timeline once via the pull path (a few hundred ms, once) and resume pushing.

Why this works: the expensive operation in each regime is the *rare* one. Normal users post often but have few
followers — push is cheap. Celebrities have huge audiences but are few in number (~thousands of accounts) — their
recent posts sit in cache and the read-time merge touches maybe 1–5 of them per user.

Implementation details worth name-dropping:

- The timeline stores only **post IDs + author IDs** (~40 bytes/entry); content is hydrated from a separate post cache, so an edit or delete doesn't require touching 100M timelines.
- Fan-out workers **batch** inserts per Redis shard and are rate-limited so a celebrity-adjacent burst can't starve normal traffic.
- A **ranking layer** can slot in at read time after merge — same architecture, different sort key.
`,
    },
    {
      type: 'text',
      title: 'Step 5: Media storage and delivery',
      md: `
Media is **~99.98% of the bytes** (250 TB/day vs ~50 GB of metadata), so it gets its own path:

#### Upload path

1. Client asks the app server to create a post → server returns a **pre-signed URL** for object storage.
2. Client uploads the 2 MB original **directly to S3** — the app tier never proxies photo bytes (at 3.5K uploads/sec that would be ~7 GB/s of pointless traffic through your servers).
3. An async pipeline (S3 event → queue → resize workers) generates renditions: **thumbnail ~50 KB, feed-width ~200 KB, full ~500 KB**, in modern formats (WebP/AVIF — ~30–50% smaller than JPEG at the same quality).
4. Only when renditions exist does the post become visible — clients should never see a broken image.

#### Delivery path

- Every rendition URL points at the **CDN**, keyed by an immutable content hash → cache forever (\`Cache-Control: max-age=31536000, immutable\`). Edits create new objects, never overwrite.
- Expect a **90–95%+ edge hit ratio** for feed traffic (feeds are dominated by recent, popular content). Edge hits cost ~20–50 ms; misses pull from origin at +100–200 ms.
- Cost intuition: CDN egress at ~$0.02–0.05/GB on hundreds of TB/day is a **millions-per-month** line item — which is why aggressive rendition sizing and AVIF adoption are real engineering projects.
- Clients request the rendition that matches the viewport — sending a 2 MB original to a 400px-wide feed cell is the most common bandwidth bug in naive designs.
`,
    },
    {
      type: 'beforeAfter',
      title: 'Case: moving from pull to hybrid fan-out',
      scenario: {
        beforeTitle: 'Pure fan-out-on-read (compute feed per request)',
        beforeDescription:
          'Every feed load scatter-gathers the latest posts from ~200 followees across 50+ DB shards, then merge-sorts. At 175K peak QPS the metadata DB takes ~35M shard queries/sec equivalent load; p99 feed latency is 850 ms and the DB fleet is the cost center.',
        afterTitle: 'Hybrid: push to Redis timelines + read-time celebrity merge',
        afterDescription:
          'Fan-out workers precompute timelines for active users (~230K Redis writes/sec); celebrity posts skip fan-out and are merged from a tiny hot cache at read time. Feed reads become one Redis fetch + hydration. Costs: a 5 TB Redis fleet, a Kafka pipeline, and seconds of eventual consistency on delivery.',
        metrics: [
          { label: 'Feed p99 latency', before: '850 ms', after: '120 ms', improved: true },
          { label: 'Metadata DB read load', before: '~35M shard-queries/sec at peak', after: '~2M/sec (hydration misses only)', improved: true },
          { label: 'Celebrity post handling', before: 'Free at write, melts reads', after: 'Zero fan-out; merged from cache', improved: true },
          { label: 'Write path complexity', before: 'One insert', after: 'Queue + worker fleet + 5 TB Redis', improved: false },
          { label: 'Feed freshness', before: 'Live', after: '~5 s fan-out lag (eventual)', improved: false },
        ],
      },
    },
    {
      type: 'text',
      title: 'Step 6: Bottlenecks and scaling the long tail',
      md: `
Close the interview by attacking your own design — this is where Senior signal lives.

- **Hot users / hot shards.** Shard the follow graph and posts by \`user_id\` and one celebrity's data concentrates on one shard, which then takes every read for that celebrity. Fixes: cache celebrity posts in a dedicated hot tier (one entry serves 100M followers), and consider splitting follower lists of mega-accounts across shards.
- **Cache stampede on viral posts.** A post goes viral, its cache entry expires, and 50K concurrent requests hit the DB for the same row (dog-piling). Fixes: **request coalescing** (only one request recomputes, others wait), short TTL jitter, and serving slightly-stale data while refreshing in the background.
- **Thundering herd after a Redis node dies.** Losing a timeline node means millions of users rebuild via the pull path simultaneously. Fixes: replicate timeline shards, rebuild lazily with rate limits, and degrade gracefully (serve a popular-content feed for the seconds a rebuild takes).
- **Fan-out queue lag during global events.** New Year's Eve multiplies post rate ~3–5×; the queue absorbs the burst but delivery lag grows from seconds to minutes. Decide explicitly: lag is acceptable; dropped posts are not. Monitor **fan-out delivery p99** as a first-class SLO.
- **The follow graph itself** (~100B edges) needs sharding by follower for "who do I follow?" *and* an index by followee for "who follows me?" — effectively storing the edge twice. Acknowledge the write amplification on follow/unfollow.

> Strong closing move: state what you'd build first (push-only MVP, no celebrity path) and what metric — celebrity
> fan-out time — tells you when to add the hybrid.
`,
    },
    {
      type: 'keyNumbers',
      title: 'Numbers to anchor the interview',
      numbers: [
        { metric: 'Instagram photo uploads', value: '~100M/day', context: '≈1,200 QPS average, ~3,500 at peak. Writes are the easy part.' },
        { metric: 'Read:write ratio', value: '~100:1', context: 'The single fact that justifies precomputed feeds, caching, and the CDN.' },
        { metric: 'Feed latency target', value: 'p99 < 200 ms', context: 'Unreachable with scatter-gather pull; trivial with a Redis timeline read.' },
        { metric: 'Fan-out write amplification', value: '~200×', context: '100M posts × 200 avg followers = 20B timeline writes/day (~230K/sec).' },
        { metric: 'Celebrity worst case', value: '100M+ writes/post', context: 'The Justin Bieber problem — why pure push fails and hybrids exist.' },
        { metric: 'Media storage growth', value: '~250 TB/day', context: '2.5 MB/photo incl. renditions; ~91 PB/year before replication. Object storage + CDN, never the DB.' },
      ],
    },
  ],
  quiz: [
    {
      question: 'Why does a feed system prefer fan-out-on-write for typical users?',
      options: [
        'It guarantees strong consistency for new posts',
        'It reduces storage costs versus fan-out-on-read',
        'It eliminates the need for a message queue',
        'It turns the hot read path into a single cache fetch, meeting tight latency targets',
      ],
      answer: 3,
      explanation:
        'With ~100:1 reads to writes, you pay the fan-out cost once at write time so 175K QPS of reads become ~1 ms Redis list fetches. Pull would scatter-gather across shards on every single read.',
    },
    {
      question: 'A celebrity with 80M followers posts a photo. In a well-designed hybrid system, what happens?',
      options: [
        'The post skips fan-out and is merged into followers\' feeds from a hot cache at read time',
        '80M Redis writes are enqueued and processed over several minutes',
        'The post is written synchronously to all follower timelines before the API returns',
        'Followers see the post only after they post something themselves',
      ],
      answer: 0,
      explanation:
        'Accounts above a follower threshold are excluded from fan-out. Their recent posts live in a heavily cached set that the feed service merges at read time — one cache entry serves all 80M followers.',
    },
    {
      question: 'Why do uploads go directly from the client to object storage via pre-signed URLs?',
      options: [
        'It encrypts photos end to end',
        'It keeps ~7 GB/s of photo bytes from pointlessly transiting the stateless app tier',
        'Object storage is the only place renditions can be generated',
        'It makes uploads strongly consistent',
      ],
      answer: 1,
      explanation:
        'At ~3.5K uploads/sec × 2 MB, proxying media through app servers wastes enormous bandwidth and capacity. Pre-signed URLs let the app tier authorize the upload while S3 handles the bytes.',
    },
    {
      question: 'A post goes viral and its cache entry expires; 50K concurrent requests hit the database for the same row. The standard fix is…',
      options: [
        'Shard the database by post ID',
        'Increase the cache TTL to 24 hours',
        'Request coalescing: one request recomputes while the rest wait or get slightly-stale data',
        'Move the post to object storage',
      ],
      answer: 2,
      explanation:
        'This is a cache stampede (dog-pile). Coalescing collapses the 50K misses into one origin fetch; TTL jitter and serve-stale-while-revalidate are complementary mitigations.',
    },
    {
      question: 'The timeline cache stores post IDs rather than full post content because…',
      options: [
        'Redis cannot store values larger than 1 KB',
        'IDs compress better than JSON',
        'It makes the feed strongly consistent',
        'Edits and deletes then touch one post cache entry instead of millions of fanned-out copies',
      ],
      answer: 3,
      explanation:
        'Normalize-then-hydrate: timelines hold ~40-byte ID entries and content is fetched from a post cache at read time. A delete updates one place — not every follower timeline it was fanned out to.',
    },
  ],
  interviewQuestions: [
    {
      question: 'How would you add feed ranking (ML-scored ordering) to your reverse-chronological design?',
      hint: 'Keep the same candidate-generation architecture: timeline cache returns ~500 candidate IDs, a ranking service scores them at read time (feature store + model inference, ~50 ms budget), then return the top 20. Note the latency budget split and a fallback to chrono order if the ranker times out.',
      difficulty: 'Mid',
    },
    {
      question: 'Your fan-out queue is 20 minutes behind after a World Cup goal. What do you do, and what do you change later?',
      hint: 'Immediate: scale workers, shed load by deferring dormant-user fan-out, let celebrity-path reads stay fresh (they bypass the queue). Later: partition queues by priority (active users first), autoscale on lag not CPU, and make fan-out delivery-lag a paged SLO.',
      difficulty: 'Senior',
    },
    {
      question: 'How do you decide the follower threshold above which an account switches from push to pull?',
      hint: 'It is a cost curve, not a magic number: fan-out cost grows with followers, read-merge cost grows with how many celebrities an average user follows. Model both, pick the crossover (typically 10K-100K), and make it a dynamic flag so ops can move accounts during incidents.',
      difficulty: 'Senior',
    },
    {
      question: 'A user deletes a post. Walk me through what has to happen, given the post was fanned out to 5,000 timelines.',
      hint: 'Because timelines store only IDs, mark the post deleted in the post store/cache and filter at hydration time — no need to touch 5,000 lists synchronously. Lazy removal on next timeline rebuild. Mention the CDN: invalidate or rely on hashed immutable URLs becoming unreachable.',
      difficulty: 'Junior',
    },
  ],
  commonMistakes: [
    'Jumping straight to architecture without stating the read:write ratio. Every major decision (fan-out, caching, CDN) is justified by ~100:1 — say the number first.',
    'Storing photos in the database. Media is ~5,000× the metadata volume (250 TB/day vs ~50 GB) — it belongs in object storage with CDN delivery, full stop.',
    'Choosing pure push or pure pull and defending it to the death. The interviewer is fishing for the celebrity problem; the hybrid is the expected answer at Mid+ level.',
    'Fanning out full post content instead of post IDs. Edits/deletes then require rewriting millions of timeline entries; ID-plus-hydration fixes it for free.',
    'Ignoring dormant users: 80% of accounts are not daily-active, and pushing into timelines nobody reads roughly 5×es your fan-out bill. Skip them and rebuild on return.',
  ],
  cloudMappings: [
    { concept: 'Media object storage', aws: 'S3 (+ S3 Event Notifications)', gcp: 'Cloud Storage', azure: 'Blob Storage' },
    { concept: 'CDN for photo delivery', aws: 'CloudFront', gcp: 'Cloud CDN', azure: 'Azure Front Door / CDN' },
    { concept: 'Timeline / feed cache', aws: 'ElastiCache (Redis)', gcp: 'Memorystore', azure: 'Azure Cache for Redis' },
    { concept: 'Fan-out queue', aws: 'MSK (Kafka) / Kinesis / SQS', gcp: 'Pub/Sub', azure: 'Event Hubs' },
    { concept: 'Post & graph metadata store', aws: 'DynamoDB / Aurora (sharded)', gcp: 'Bigtable / Spanner', azure: 'Cosmos DB' },
    { concept: 'Image resize pipeline', aws: 'Lambda + S3 events', gcp: 'Cloud Functions / Cloud Run', azure: 'Azure Functions' },
  ],
}

export default designInstagram
