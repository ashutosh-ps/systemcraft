import type { Module } from '../../../lib/types'

const designGoogleSearch: Module = {
  id: 'design-google-search',
  category: 'case-studies',
  title: 'Design Google Search',
  description:
    'Crawl hundreds of billions of pages, build a ~100 PB inverted index, and answer 100K+ queries per second in under 300 ms. The core problems: a polite distributed crawler, document-sharded indexing, and scatter-gather serving.',
  difficulty: 'Senior',
  estMinutes: 160,
  keywords: ['web crawler', 'inverted index', 'scatter-gather', 'simhash', 'URL frontier', 'index sharding', 'ranking'],
  related: ['search-analytics', 'sharding', 'caching', 'distributed-systems'],
  sections: [
    {
      type: 'text',
      title: 'Step 1: Requirements. Three systems, one product',
      md: `
"Design Google Search" is really three loosely-coupled systems, each at absurd scale:

1. **Crawl**: continuously discover and fetch the web. Hundreds of billions of candidate URLs, refetched on
   schedules that match how often pages change.
2. **Index**: turn fetched pages into an **inverted index** (term → list of documents) that fits the serving
   fleet's RAM and SSDs.
3. **Serve**: answer a query against that index in **well under 300 ms end-to-end**, at **100K+ QPS**.

**Explicitly out of scope**. Say it before the interviewer asks: ads (a separate auction system), personalization
and query history, image/video/news verticals, and the fine detail of ranking ML. You'll sketch ranking in one
section, not design it.

**Non-functional requirements**

- **Freshness is tiered, not uniform**: news sites get recrawled in minutes, a 2009 blog post monthly. A single
  "crawl everything every day" policy is neither possible nor useful.
- **The index is rebuilt/updated continuously but is never transactional**. Eventual consistency between web
  reality and index contents is inherent; nobody expects a page edit to be searchable in the same second.
- **Serving must degrade gracefully**: returning very good results from 98% of shards in 250 ms beats perfect
  results in 2 s. Search is the canonical "latency over completeness" system.
- **Read-only serving**: queries never write to the index. This one property unlocks aggressive replication and
  caching. Every replica is equally authoritative.

> Framing tip: crawl is a throughput problem, indexing is a batch-compute problem, serving is a latency problem.
> Naming the three regimes up front shows you see the whole machine.
`,
    },
    {
      type: 'code',
      title: 'Step 2: Scale estimation',
      language: 'python',
      code: `
# --- The corpus ---
urls_known = 400e9            # URLs Google has seen/considered (public: "hundreds of billions")
docs_indexed = 50e9           # actually kept in the serving index (~50-100B)
avg_html_kb = 100             # average fetched HTML (page *weight* is ~2MB; HTML alone ~100KB)

raw_corpus = docs_indexed * avg_html_kb * 1e3      # ~5 PB of raw HTML
# Inverted index ~= 20-40% of raw text after compression (postings + positions),
# plus doc store, link graph, and per-doc signals:
index_size = raw_corpus * 4                        # ~20 PB serving-critical
# Google's public number: "over 100,000,000 GB" => ~100 PB with all artifacts.

# --- Crawl throughput ---
refresh_avg_days = 30          # blended refresh interval across tiers
fetches_per_sec = docs_indexed / (refresh_avg_days * 86_400)
# = ~19,000 fetches/sec sustained, ~2 Gbps just for HTML
# Politeness caps per-host rate (~1 req/s/host) => you need millions of
# hosts in flight concurrently, not faster fetching of one host.

# --- Query load ---
searches_per_day = 8.5e9       # ~8.5B/day (2024 public estimates)
avg_qps = searches_per_day / 86_400     # ~100K QPS average, ~2x at peak

# --- Per-query fan-out ---
shards = 1_000                 # document-sharded leaves (illustrative)
replicas = 30                  # per shard, sized for QPS + tail latency
leaf_lookups_per_sec = avg_qps * shards / 1   # every query touches every shard group
# => ~100M leaf-shard lookups/sec across the fleet. Caching ~40% of queries
# at the root cuts this nearly in half -- cache first, fan out second.
`,
    },
    {
      type: 'text',
      title: 'Step 3: Crawler design, where politeness is the bottleneck',
      md: `
A crawler is conceptually a loop. Take URL, fetch, parse, extract links, repeat. But at web scale every step has
a hard sub-problem:

- **URL frontier (the heart).** A priority queue of billions of URLs. Two-level design: a **prioritizer** scores
  URLs (PageRank-ish importance, observed change frequency, sitemap hints), and **per-host politeness queues**
  ensure you never hammer one server. Industry norm is **~1 request/second/host** unless the site signals
  otherwise. Politeness, not bandwidth, is the real throughput cap: 19K fetches/sec means **tens of thousands of
  hosts in flight simultaneously**, so the frontier must be sharded by host.
- **robots.txt** is fetched and cached per host (~24 h TTL) and checked before *every* fetch. Getting this wrong
  gets your crawler IP-banned at scale.
- **Fetchers** are stateless async workers. Thousands of connections each, DNS aggressively cached (DNS resolution
  is a classic hidden bottleneck at 19K lookups/sec).
- **Parsing + extraction** pulls text, links, and metadata; discovered links are normalized (canonical URL rules)
  and fed back to the frontier.
- **Deduplication.** ~30% of the web is near-duplicate content (mirrors, tracking-param URLs, scraped copies).
  Exact dupes are caught by content checksum; near-dupes by **SimHash**: a 64-bit fingerprint where similar
  documents differ in ≤3 bits. Google's published approach (Manku et al., 2007). Skipping dedup means wasting a
  third of your index on copies.
- **Refresh scheduling.** Track per-page change history; pages that change often get short revisit intervals
  (minutes for news homepages), static pages back off exponentially toward monthly. This converts a "crawl
  everything" problem into a priority/budget problem.
`,
    },
    {
      type: 'diagram',
      title: 'Crawl → dedup → index pipeline',
      caption:
        'The frontier feeds polite fetchers; parsed content is deduped before storage; the indexer consumes the doc store in batches and ships immutable shards to serving.',
      diagram: {
        height: 400,
        nodes: [
          { id: 'sched', label: 'Refresh Sched', kind: 'service', x: 20, y: 20, detail: 'Tracks per-page change history and re-enqueues URLs on adaptive intervals. Minutes for news homepages, ~monthly for static pages. Converts infinite crawl demand into a prioritized budget.' },
          { id: 'frontier', label: 'URL Frontier', kind: 'queue', x: 20, y: 170, detail: 'Billions of URLs in a two-level structure: priority scoring (importance × change frequency) on top, per-host politeness queues below (~1 req/s/host). Sharded by host hash across hundreds of nodes.' },
          { id: 'web', label: 'The Web', kind: 'external', x: 205, y: 20, detail: 'Hundreds of billions of reachable URLs across ~1B hosts. Hostile terrain: spider traps, infinite calendars, 30% near-duplicate content, and servers that ban impolite crawlers.' },
          { id: 'fetchers', label: 'Fetchers', kind: 'server', x: 205, y: 170, detail: 'Stateless async workers sustaining ~19K fetches/sec fleet-wide (~2 Gbps of HTML). Check cached robots.txt before every fetch; DNS responses cached aggressively. Resolution is a hidden bottleneck at this rate.' },
          { id: 'parser', label: 'Parser', kind: 'service', x: 400, y: 60, detail: 'Extracts text, title, language, and outlinks; normalizes URLs to canonical form (strips tracking params, resolves redirects). Discovered links, billions per day, flow back to the frontier.' },
          { id: 'dedup', label: 'Dedup SimHash', kind: 'service', x: 400, y: 280, detail: 'Checksum kills exact copies; SimHash (64-bit fingerprint, Hamming distance ≤ 3 = near-duplicate) kills mirrors and scraped copies (~30% of fetched content), saving a third of the index.' },
          { id: 'docstore', label: 'Doc Store', kind: 'storage', x: 595, y: 280, detail: 'Compressed repository of fetched pages (~5 PB of raw HTML for 50B docs) in a Bigtable/Colossus-style store, keyed by doc ID, versioned by fetch time. The input for every index rebuild.' },
          { id: 'indexer', label: 'Batch Indexer', kind: 'service', x: 595, y: 60, detail: 'MapReduce-style jobs: map emits (term, docID, positions), shuffle groups by term, reduce writes compressed posting lists. Modern systems (Caffeine/Percolator) update incrementally in minutes, not weekly rebuilds.' },
          { id: 'shards', label: 'Index Shards', kind: 'db', x: 800, y: 60, detail: 'Immutable document-sharded index files: each of ~1,000 leaf shards owns the full mini-index for its ~50M docs, replicated ~30× for QPS and tail latency. Shipped to serving like a deploy artifact, with instant rollback.' },
        ],
        edges: [
          { from: 'sched', to: 'frontier', label: 'recrawl URLs' },
          { from: 'frontier', to: 'fetchers', label: 'next URL' },
          { from: 'fetchers', to: 'web', label: 'HTTP GET', bidirectional: true },
          { from: 'fetchers', to: 'parser', label: 'HTML' },
          { from: 'parser', to: 'frontier', label: 'new links', dashed: true },
          { from: 'parser', to: 'dedup', label: 'content' },
          { from: 'dedup', to: 'docstore', label: 'unique docs' },
          { from: 'docstore', to: 'indexer', label: 'batch read' },
          { from: 'indexer', to: 'shards', label: 'posting lists' },
        ],
      },
    },
    {
      type: 'text',
      title: 'Step 4: Indexing. Building and sharding the inverted index',
      md: `
The **inverted index** maps each term to a **posting list**: the documents containing it, with positions and
per-document scoring features, delta-encoded and compressed (a posting costs a few bytes, not a few dozen). The
classic build is a MapReduce-style batch job. *map* over documents emitting \`(term, docID, positions)\`, *shuffle*
groups by term, *reduce* writes compressed posting lists. Google ran exactly this until 2010, when **Caffeine**
(built on Percolator) replaced weekly batch rebuilds with incremental per-document updates, cutting indexing
latency from days to minutes. In an interview: design the batch version, then mention the incremental evolution.

A 20–100 PB index doesn't fit on one machine, so it must be partitioned. Two options:

#### Shard by term
Each shard owns a slice of the vocabulary ("aardvark–apple" on shard 1). A single-term query touches one shard. Seductive. But a multi-term query like \`"distributed systems"\` needs posting lists from different shards
*intersected*, which means shipping a posting list with **hundreds of millions of entries across the network** per
query. Hot terms ("news", "weather") create permanently hot shards. Adding a document touches every shard whose
terms it contains.

#### Shard by document (what Google does)
Each shard owns a complete mini-index over its subset of documents (~50M docs/shard). Every query fans out to all
shards, but each shard does its term intersection **locally**. Only its top-k results (doc IDs + scores, a few KB)
cross the network. Load balances naturally because documents are assigned randomly; a new document touches exactly
one shard; a dead shard means a slightly smaller web, not missing terms.

The trade is total fan-out work on every query. Which Google happily pays, because intra-shard work parallelizes
perfectly and the merge step is cheap.
`,
    },
    {
      type: 'comparison',
      title: 'Index partitioning: by document vs by term',
      comparison: {
        columns: ['Criterion', 'Shard by document (Google)', 'Shard by term'],
        rows: [
          ['Query fan-out', 'Every query → every shard group (scatter-gather)', 'Only shards owning the query terms'],
          ['Multi-term AND/phrase', 'Intersected locally inside each shard. Cheap', 'Posting lists (potentially 100M+ entries) shipped across the network to intersect'],
          ['Network per query', 'Top-k per shard: a few KB', 'Full posting lists: MBs-GBs for common terms'],
          ['Load balance', 'Natural. Docs assigned randomly', '"the"/"news" shards run hot forever'],
          ['Document updates', 'Touch exactly 1 shard', 'Touch every shard containing any of the doc’s terms'],
          ['Failure blast radius', 'Lose 1/N of the web; results slightly degrade', 'Lose entire terms; queries containing them break'],
          ['Best for', 'Web search: short queries, intersections dominate, results need global ranking', 'Rare: single-term lookups over stable corpora'],
        ],
        verdict:
          'Google shards by document: intersections stay local, network carries only top-k results, load and failures spread evenly. The fan-out cost is bought back with replication, caching, and early termination.',
      },
    },
    {
      type: 'text',
      title: 'Step 5: Serving. Scatter-gather in 300 ms',
      md: `
The serving path is a tree, and the latency budget is brutal: ~300 ms end-to-end leaves the backend roughly
**100–150 ms** after network and rendering.

1. **Query frontend**: spell-correct, expand synonyms, rewrite (\`how do i...\` → terms), and check the **result
   cache** first. Query frequency is extremely Zipfian. **30–60% of queries are repeats** within hours. So a
   cache keyed on normalized query serves a third to a half of traffic in ~1 ms, never touching the index. TTL of
   minutes; invalidate on index swaps. (The flip side: **~15% of daily queries have never been seen before**, so
   the cache can never save you from having a fast backend.)
2. **Root/mixer**: fans the query out to all ~1,000 leaf-shard groups in parallel, each request going to the
   least-loaded of ~30 replicas.
3. **Leaf shards**: each walks its posting lists, intersects terms, scores candidates, and returns its **top-k**
   (say 10–50 doc IDs + scores). Two tricks keep leaves fast:
   - **Impact-ordered postings + early termination**: posting lists are sorted so the highest-quality documents
     come first; once the top-k is stable, stop scanning. You rarely read a long posting list to the end.
   - **Tiered indexes**: a small tier-1 index of the best few billion documents answers most queries; tier-2 is
     consulted only when tier-1 returns too few results.
4. **Merge + tail-taming**: the root merges ~1,000 sorted top-k lists (cheap). But p99 latency is set by the
   *slowest* shard. Standard fixes: **hedged requests** (send a backup request to another replica after ~p95 wait)
   and returning at, say, 98% shard coverage rather than waiting for stragglers.

> The deep pattern: scatter-gather turns one 100 ms problem into a thousand 10 ms problems plus a merge. And then
> all your engineering goes into the tail.
`,
    },
    {
      type: 'text',
      title: 'Step 6: Ranking in one section. Enough to be dangerous',
      md: `
Keep ranking brief in a systems interview. Name the layers, show where they run, and move on:

- **Stage 1. Cheap retrieval scoring (in the leaf, microseconds/doc).** Classic lexical relevance:
  **BM25/TF-IDF**-family scoring over the candidates surfaced by posting-list traversal. Terms matching in the title
  beat terms in the footer, and rare terms count more than common ones.
- **Stage 2. Link-based authority (precomputed offline).** **PageRank**: a page is important if important pages
  link to it. Computed periodically over the ~trillion-edge link graph and stored as a per-document prior; at query
  time it's just a number multiplied in, costing nothing.
- **Stage 3. Full re-ranking (in the mixer, on ~1,000 survivors).** Hundreds of signals: freshness, language,
  mobile-friendliness, click feedback, spam scores, and (since ~2015-2019) neural models (RankBrain, BERT-based
  rerankers) that actually understand query semantics. This is expensive per document, which is exactly why it only
  runs on the merged top candidates, never on millions of matches.

The architectural takeaway matters more than the ML: **ranking is a funnel**. Each stage is ~100× more expensive
per document and runs on ~100× fewer documents. Cheap-and-broad in the leaves, expensive-and-narrow at the root. The same funnel shape appears in ads, recommendations, and every retrieval system you'll ever design.
`,
    },
    {
      type: 'keyNumbers',
      title: 'Numbers to anchor the design',
      numbers: [
        { metric: 'Index size', value: '~100 PB (100M GB)', context: 'Google’s public figure including doc store and signals; the serving-critical inverted index is tens of PB compressed.' },
        { metric: 'Pages known vs indexed', value: '400B+ seen, ~50-100B served', context: 'Dedup (~30% of the web is near-duplicate) and quality filtering shrink the corpus before it costs serving RAM.' },
        { metric: 'Query volume', value: '~8.5B/day ≈ 100K QPS', context: 'Average; peaks ~2×. Each query fans out to ~1,000 leaf shard groups.' },
        { metric: 'End-to-end latency', value: 'p99 < 300 ms', context: 'Backend budget ~100-150 ms; the p99 is set by the slowest of 1,000 shards. Hence hedged requests and partial coverage.' },
        { metric: 'Never-seen queries', value: '~15% per day', context: 'Google’s long-standing stat. Result caching helps (30-60% repeats) but can never replace a fast index.' },
        { metric: 'Politeness limit', value: '~1 req/s/host', context: 'The real crawl throughput cap. 19K fetches/sec requires tens of thousands of hosts in flight, not faster fetching.' },
        { metric: 'SimHash near-dup threshold', value: '≤ 3 of 64 bits differ', context: 'Manku et al. (Google, 2007): billions of documents deduped via fingerprint Hamming distance.' },
      ],
    },
    {
      type: 'beforeAfter',
      title: 'Case: one big index node vs document-sharded serving tree',
      scenario: {
        beforeTitle: 'Single machine holding the whole inverted index',
        beforeDescription:
          'A 20+ PB index cannot even fit. But scale it down to a 2 TB index on one beefy node: every query walks long posting lists serially, one hot term saturates the CPU, p99 swings wildly, and any restart means total search downtime while the index reloads.',
        afterTitle: '~1,000 doc-shards × ~30 replicas, scatter-gather root',
        afterDescription:
          'Each leaf intersects terms over its ~50M docs locally and returns top-k; the root merges and re-ranks. Capacity scales with replicas, latency with shard count; a dead shard degrades coverage by 0.1% instead of taking search down.',
        metrics: [
          { label: 'Index capacity ceiling', before: '~2 TB (one machine’s RAM+SSD)', after: 'Tens of PB across the fleet', improved: true },
          { label: 'Query p99', before: '2-10 s on long posting lists', after: '< 300 ms end-to-end', improved: true },
          { label: 'Throughput path', before: 'Vertical only. Bigger box', after: 'Add replicas per shard group', improved: true },
          { label: 'Single shard/node failure', before: '100% search outage', after: '~0.1% coverage loss, results barely change', improved: true },
        ],
      },
    },
  ],
  quiz: [
    {
      question: 'Why does Google shard its index by document rather than by term?',
      options: [
        'Document sharding means each query touches only one shard',
        'Term sharding cannot be implemented on commodity hardware',
        'Document sharding makes the index smaller overall',
        'Multi-term intersections happen locally inside each shard, so only a few KB of top-k results cross the network. Versus shipping 100M-entry posting lists between term shards',
      ],
      answer: 3,
      explanation:
        'The decisive cost is the network. With document shards, the expensive operation (posting-list intersection) stays local and parallelizes across all shards; term sharding moves giant posting lists across the network and creates hot shards for common terms.',
    },
    {
      question: 'What actually limits a web crawler’s throughput at scale?',
      options: [
        'Datacenter bandwidth for fetching HTML',
        'Per-host politeness (~1 req/s/host). Sustaining 19K fetches/sec requires tens of thousands of hosts in flight concurrently',
        'CPU cost of parsing HTML',
        'Disk space for storing fetched pages',
      ],
      answer: 1,
      explanation:
        '19K fetches/sec is only ~2 Gbps. Trivial bandwidth. The constraint is that you may only take ~1 page/sec from any single host, so the frontier must keep enormous host-level parallelism, which is why it is sharded by host with per-host queues.',
    },
    {
      question: 'What does SimHash provide that a content checksum (MD5/SHA) does not?',
      options: [
        'Cryptographic protection against malicious pages',
        'Faster hashing of large documents',
        'Near-duplicate detection: similar documents produce fingerprints within a small Hamming distance (≤3 of 64 bits), catching mirrors and scraped copies that differ slightly',
        'Smaller fingerprints for storage efficiency',
      ],
      answer: 2,
      explanation:
        'A checksum changes completely if one byte differs, so it only catches exact copies. SimHash is locality-sensitive: ~30% of the web is near-duplicate content, and catching it saves a third of the index.',
    },
    {
      question: 'Result caching serves 30-60% of queries. Why can it never substitute for a fast index backend?',
      options: [
        'Caches cannot store ranked result lists',
        'Cache invalidation on index updates is impossible',
        '~15% of each day’s queries have never been seen before, and the long tail of rare queries always misses. The uncached path must still meet the latency SLO',
        'Result caching violates user privacy',
      ],
      answer: 2,
      explanation:
        'Query frequency is Zipfian: a hot head caches beautifully, but a fat tail of unique and never-seen queries (Google’s long-standing ~15%/day stat) guarantees permanent miss traffic at full latency requirements.',
    },
    {
      question: 'In scatter-gather serving over 1,000 shards, what determines the query’s p99 latency, and what is the standard mitigation?',
      options: [
        'The fastest shard; mitigation is faster networking',
        'The root merge step; mitigation is a bigger root server',
        'The cache hit ratio; mitigation is a larger cache',
        'The slowest shard response; mitigations are hedged requests to backup replicas and returning at ~98% shard coverage instead of waiting for stragglers',
      ],
      answer: 3,
      explanation:
        'Fan out to N shards and your latency is the max of N samples. Tail amplification. Hedging (resend to another replica after ~p95 wait) and partial-coverage returns are the classic fixes, trading tiny result completeness for bounded latency.',
    },
  ],
  interviewQuestions: [
    {
      question: 'Walk me through the life of a query from keystroke to results page, with a latency budget per stage.',
      hint: 'Frontend rewrite/spellcheck (~5 ms) → result cache check (~1 ms; 30-60% end here) → root fan-out to ~1,000 leaf groups → leaf posting-list intersection + scoring with early termination (~10-30 ms) → merge + neural re-rank of top candidates (~20-40 ms) → snippets fetch from doc store. Show the p99 is governed by the slowest leaf.',
      difficulty: 'Junior',
    },
    {
      question: 'How does your design change if results must reflect page edits within ~1 minute (news/freshness) instead of daily batch rebuilds?',
      hint: 'Batch MapReduce rebuilds are out. Discuss incremental indexing (Caffeine/Percolator-style per-document updates), a small fresh in-memory delta index queried alongside the main index with results merged, accelerated recrawl tiers driven by change-frequency models, and result-cache TTLs/invalidations tightening.',
      difficulty: 'Senior',
    },
    {
      question: 'Your crawler is suddenly fetching millions of junk URLs from a spider trap (infinite calendar pages). How do you detect and contain it?',
      hint: 'Per-host crawl budgets, URL pattern analysis (depth/parameter count limits), diminishing-returns detection (content similarity via SimHash across a host), frontier prioritization that demotes hosts yielding low-value or duplicate content, and canonical URL normalization to collapse parameter explosions.',
      difficulty: 'Mid',
    },
    {
      question: 'A leaf shard group starts answering with p99 of 800 ms instead of 30 ms. What is the blast radius on overall search, and how does the system self-protect?',
      hint: 'Naively, every query waits on the slowest shard. One bad group poisons the global p99. Defenses: hedged/backup requests after ~p95, per-shard timeouts with partial coverage (return at 98-99% of shards), load-aware replica selection pulling traffic from the sick replicas, and the merge layer flagging degraded coverage for monitoring.',
      difficulty: 'Senior',
    },
  ],
  commonMistakes: [
    'Designing the crawler around bandwidth instead of politeness. The hard part is sustaining tens of thousands of hosts in flight at ~1 req/s each with per-host queues and robots.txt caching, not downloading bytes faster.',
    'Choosing term sharding because "a query only needs its terms". Multi-term intersections then ship 100M-entry posting lists across the network and hot terms melt their shards. Walk through one phrase query and the design falls apart.',
    'Skipping deduplication. ~30% of the web is near-duplicate; without SimHash-style fingerprinting you pay to crawl, store, index, and serve the same content three times, and result pages fill with mirrors.',
    'Treating the index like a transactional database. It is an immutable, periodically-swapped (or incrementally-updated) artifact; queries are read-only. Proposing row-level updates with locks signals you haven’t built a search system.',
    'Ignoring tail latency in scatter-gather. Quoting average leaf latency is meaningless when every query waits on the max of 1,000 samples. Interviewers specifically probe for hedged requests and partial-coverage returns.',
  ],
  cloudMappings: [
    { concept: 'Crawl frontier / work queues', aws: 'SQS + DynamoDB (per-host state)', gcp: 'Pub/Sub + Cloud Tasks', azure: 'Service Bus + Storage Queues' },
    { concept: 'Fetched-document store', aws: 'S3 + DynamoDB metadata', gcp: 'Bigtable / GCS (Colossus-style)', azure: 'Blob Storage + Cosmos DB' },
    { concept: 'Batch index building', aws: 'EMR (Spark/Hadoop)', gcp: 'Dataproc / Dataflow', azure: 'HDInsight / Synapse Spark' },
    { concept: 'Managed inverted-index search', aws: 'OpenSearch Service', gcp: 'Vertex AI Search / Elastic on GCE', azure: 'Azure AI Search' },
    { concept: 'Result cache', aws: 'ElastiCache (Redis)', gcp: 'Memorystore', azure: 'Azure Cache for Redis' },
    { concept: 'Link-graph analytics (PageRank-style)', aws: 'Neptune Analytics / EMR Graph', gcp: 'BigQuery + Dataflow', azure: 'Cosmos DB Gremlin + Synapse' },
  ],
}

export default designGoogleSearch
