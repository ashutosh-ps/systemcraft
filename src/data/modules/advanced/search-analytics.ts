import type { Module } from '../../../lib/types'

const searchAnalytics: Module = {
  id: 'search-analytics',
  category: 'advanced',
  title: 'Search & Analytics: Elasticsearch to Snowflake',
  description:
    'How text search actually works (inverted indexes, BM25), why Elasticsearch is not your primary store, and how columnar warehouses like Snowflake answer analytical queries 100× faster than your OLTP database.',
  difficulty: 'Mid',
  estMinutes: 140,
  keywords: ['inverted index', 'BM25', 'Elasticsearch', 'OLAP', 'columnar storage', 'data warehouse', 'CDC', 'full-text search'],
  related: ['databases', 'design-google-search', 'sharding', 'message-queues'],
  sections: [
    {
      type: 'text',
      title: "Why your database can't do search",
      md: `
Run \`SELECT * FROM products WHERE description LIKE '%wireless%'\` on a 10M-row table and Postgres scans **every row** —
a leading wildcard defeats B-tree indexes entirely. On a typical instance that's a 5–30 second query. Users expect
search results in **under 200 ms**, with typo tolerance, relevance ranking, and "did you mean".

The fix is a different data structure: the **inverted index**. Instead of mapping *row → text*, it maps
*term → list of documents containing that term* (a "postings list"):

- \`wireless\` → [doc 4, doc 87, doc 1042, ...]
- \`headphones\` → [doc 4, doc 19, doc 87, ...]

A query for "wireless headphones" becomes two postings-list lookups plus an intersection — **O(terms)**, not O(rows).
This is the same trick as the index at the back of a textbook, and it's how Google answers queries over hundreds of
billions of pages in ~400 ms.

Before text reaches the index it passes through an **analysis pipeline**:

1. **Tokenization** — split on whitespace/punctuation: "Wireless-Headphones!" → [wireless, headphones]
2. **Lowercasing** — so "iPhone" matches "iphone"
3. **Stop-word removal** (optional) — drop "the", "a", "of"
4. **Stemming** — "running", "runs" → "run", so morphology doesn't break recall

> The #1 source of "search returns nothing" bugs: the query is analyzed differently than the indexed text. Same
> analyzer at index time and query time, always.
`,
    },
    {
      type: 'code',
      title: 'Inverted index construction (pseudocode)',
      language: 'python',
      code: `
# Build an inverted index over a document collection
import re
from collections import defaultdict

STOP = {"the", "a", "of", "and", "to"}

def analyze(text):
    tokens = re.findall(r"[a-z0-9]+", text.lower())   # tokenize + lowercase
    return [stem(t) for t in tokens if t not in STOP] # stop words + stemming

index = defaultdict(list)   # term -> postings list [(doc_id, positions)]

for doc_id, text in docs.items():
    for pos, term in enumerate(analyze(text)):
        index[term].append((doc_id, pos))

# Query: intersect postings lists, shortest first (fewest candidates)
def search(query):
    terms = analyze(query)
    postings = sorted((index[t] for t in terms), key=len)
    result = set(d for d, _ in postings[0])
    for plist in postings[1:]:
        result &= set(d for d, _ in plist)
    return rank_bm25(result, terms)   # score survivors, return top-k

# Real engines store postings compressed (delta + varint encoding):
# a 1B-document index for a common term fits in ~1-2 GB instead of 8 GB.
`,
    },
    {
      type: 'text',
      title: 'Elasticsearch architecture: shards, replicas, refresh',
      md: `
Elasticsearch is a distributed wrapper around **Lucene**, the Java library that implements inverted indexes. The key
units:

- An **index** (think: table) is split into **primary shards** — each shard is a full Lucene index. Shard count is
  fixed at creation; the working rule is **10–50 GB per shard**. A 500 GB catalog → ~15 primaries.
- Each primary has **replicas** (default 1) for HA and extra read throughput. Replicas serve queries too, so 1 replica
  ≈ 2× read capacity.
- A query fans out to one copy of every shard, each returns its top-k, and the coordinating node merges — this is
  **scatter-gather**, which is why oversharding (thousands of tiny shards) murders latency.

#### Near-real-time, not real-time

Writes land in an in-memory buffer plus a durability translog. Documents become *searchable* only when a **refresh**
flushes the buffer into a new Lucene segment — by default every **1 second**. So Elasticsearch is "near-real-time":
index a document, and for up to ~1 s a search won't find it. Bulk-loading pipelines often raise
\`refresh_interval\` to 30 s for 2–5× indexing throughput.

#### Why it's not your primary store

- No multi-document ACID transactions.
- Updates are delete + reinsert; deletes are soft until segment merges reclaim space.
- A history of resilience issues under partitions (documented by the Jepsen tests; much improved since 7.x, but the
  ecosystem habit stands).

The standard pattern: **Postgres is the source of truth, Elasticsearch is a derived, rebuildable view.** If the
cluster melts, you reindex from the database.
`,
    },
    {
      type: 'text',
      title: 'Relevance: from TF-IDF to BM25',
      md: `
Matching documents is the easy half. Search lives or dies on **ranking**. The classic intuition, **TF-IDF**:

- **Term frequency (TF):** a document mentioning "kafka" 10 times is more about Kafka than one mentioning it once.
- **Inverse document frequency (IDF):** a term that appears in *every* document ("the", "click") carries no signal; a
  rare term ("debezium") carries a lot. Score = TF × IDF.

**BM25** — the default in Elasticsearch, OpenSearch, and most modern engines — keeps the idea and fixes two failure
modes, in plain words:

1. **Term-frequency saturation.** In TF-IDF, 100 occurrences score ~10× more than 10 occurrences, which rewards
   keyword stuffing. BM25 applies diminishing returns: after a few occurrences, more mentions barely help (controlled
   by the \`k1\` parameter, default 1.2).
2. **Length normalization.** A 50-word product title that mentions "headphones" is more *about* headphones than a
   5,000-word review that mentions it once. BM25 penalizes long documents proportionally (the \`b\` parameter,
   default 0.75).

In production, BM25 is the *first stage*. Real systems add layers on top:

- **Field boosting** — a match in \`title\` worth 3× a match in \`body\`.
- **Function scores** — blend in recency, popularity, price.
- **Semantic reranking** — embed query and top-200 BM25 candidates with a vector model, rerank by cosine similarity.
  Hybrid BM25 + vectors is the 2025 default for serious search.

> Interview-ready one-liner: "BM25 is TF-IDF with saturation and length normalization — then we rerank the top
> candidates with business signals."
`,
    },
    {
      type: 'comparison',
      title: 'Picking a search engine',
      comparison: {
        columns: ['Criterion', 'Elasticsearch / OpenSearch', 'Postgres full-text', 'Algolia (SaaS)'],
        rows: [
          ['Typical query latency', '10–100 ms p99 at scale', '50–500 ms; degrades past ~10M rows', '1–20 ms (edge-distributed)'],
          ['Operational cost', 'High — cluster sizing, shard management, JVM tuning', 'Zero extra infra — it is your DB', 'Zero ops, but ~$0.50 per 1K searches adds up fast'],
          ['Relevance tooling', 'BM25 + function scores + vectors; fully tunable', 'Basic ts_rank; no BM25, weak typo tolerance', 'Excellent out of the box: typo tolerance, synonyms, A/B'],
          ['Data freshness', '~1 s (refresh interval)', 'Transactional — instant', 'Seconds (push via API)'],
          ['Scale ceiling', 'Petabytes (log analytics at Uber, Netflix)', '~10–50 GB of indexed text before pain', '~100s of GB; priced per record'],
          ['Consistency with source', 'Eventually consistent; needs a sync pipeline', 'Always consistent', 'Eventually consistent; needs a sync pipeline'],
        ],
        verdict:
          'Start with Postgres tsvector + a GIN index — it is free and transactional. Move to Elasticsearch when relevance tuning or scale demands it. Buy Algolia when search UX matters more than cost and your catalog is modest.',
      },
    },
    {
      type: 'code',
      title: 'Elasticsearch query DSL: a real product search',
      language: 'json',
      code: `
// POST /products/_search
{
  "query": {
    "bool": {
      "must": {
        "multi_match": {
          "query": "wireless headphones",
          "fields": ["title^3", "brand^2", "description"],
          "fuzziness": "AUTO"            // typo tolerance: 1-2 edits
        }
      },
      "filter": [                         // filters: no scoring, cacheable
        { "term":  { "in_stock": true } },
        { "range": { "price": { "lte": 200 } } }
      ]
    }
  },
  "aggs": {                               // facets in the same round trip
    "by_brand": { "terms": { "field": "brand", "size": 10 } },
    "price_histogram": {
      "histogram": { "field": "price", "interval": 50 }
    }
  },
  "from": 0, "size": 20,
  "_source": ["title", "price", "thumbnail_url"]
}

// Notes:
// - "must" clauses score (BM25); "filter" clauses only include/exclude
//   and are cached as bitsets -> repeat filters cost ~0.
// - title^3 boosts title matches 3x over description matches.
// - Deep pagination (from: 10000) is O(from+size) per shard -- use
//   search_after for infinite scroll.
`,
    },
    {
      type: 'text',
      title: 'OLTP vs OLAP: rows vs columns',
      md: `
Your application database is **OLTP** (online transaction processing): millions of tiny operations — fetch user 42,
update one order — each touching a handful of rows but *all* of their columns. Row-oriented storage is perfect: a
row's bytes sit together, one disk read fetches the whole record.

Analytics is the opposite shape. **OLAP** queries — "average order value by country for the last 90 days" — touch
**millions of rows but 3 columns out of 60**. On a row store you read all 60 columns off disk to use 3, wasting ~95%
of your I/O. Worse, that scan competes with production traffic; many an outage report begins "an analyst ran a
query…".

**Columnar storage** flips the layout: all values of \`country\` stored together, all of \`order_total\` together.
Two compounding wins:

1. **You read only the columns you need** — 3/60 columns ≈ 20× less I/O before any other trick.
2. **Columns compress absurdly well**, because similar values sit adjacent. A country column with 200 distinct values
   dictionary-encodes to ~1 byte/value; sorted timestamps delta-encode to near nothing. **5–10× compression** is
   routine (Parquet, Snowflake micro-partitions), vs ~2× for row stores.

Add **vectorized execution** (process values in CPU-cache-sized batches) and column min/max metadata for partition
pruning, and the same query runs **100–1000× faster** than on the OLTP copy.

The trade: appends are fine, but single-row updates and point lookups are slow. That's fine — that's what the OLTP
side is for. Every serious architecture runs both and ships data between them.
`,
    },
    {
      type: 'text',
      title: 'The modern analytics stack: CDC → Kafka → warehouse',
      md: `
How does data get from Postgres into the warehouse and search index *without* hammering production?

**Change Data Capture (CDC)** tails the database's write-ahead log — the same stream replicas consume — and emits
every insert/update/delete as an event. **Debezium** (open source, runs on Kafka Connect) does this for
Postgres/MySQL/Mongo with **sub-second lag** and near-zero load on the primary, because reading the WAL is sequential
I/O the database already does.

Those events flow into **Kafka**, which acts as the fan-out point: one consumer group indexes into Elasticsearch,
another micro-batches into the warehouse, a third feeds the fraud model. Each consumer fails and retries
independently; Kafka retains the stream (commonly 7 days) so a consumer that was down catches up by replaying.

#### Snowflake: separating storage from compute

Classic warehouses (early Redshift) coupled storage and compute — to store more you bought more nodes, and one team's
monster query starved everyone. **Snowflake's** architecture decouples them:

- **Storage**: all data lives in object storage (S3/GCS) as compressed, columnar **micro-partitions** (~16 MB each),
  billed at roughly **$23/TB/month** — basically S3 prices.
- **Compute**: stateless "virtual warehouses" (clusters) spin up in seconds, billed **per second** while running.
  An X-Small is 1 credit/hour (~$2–4 depending on edition).
- Isolation for free: the BI team, the data scientists, and the nightly ETL each get their *own* warehouse hitting the
  *same* data. No copies, no contention.

BigQuery reaches the same destination serverlessly: no clusters at all, you pay **$6.25 per TiB scanned** — which is
why partitioning and clustering your tables (scan less) is the #1 BigQuery cost lever.
`,
    },
    {
      type: 'comparison',
      title: 'Warehouse showdown: Snowflake vs BigQuery vs Redshift',
      comparison: {
        columns: ['Criterion', 'Snowflake', 'BigQuery', 'Redshift'],
        rows: [
          ['Pricing model', 'Per-second compute credits + ~$23/TB storage', 'On-demand $6.25/TiB scanned, or flat-rate slots', 'Provisioned nodes (RA3) or Serverless RPUs'],
          ['Ops burden', 'Low — pick warehouse sizes', 'None — fully serverless', 'Moderate — sizing, WLM queues, vacuum (less on RA3)'],
          ['Compute isolation', 'Excellent — per-team virtual warehouses', 'Good — slot reservations', 'Weaker — workloads share the cluster'],
          ['Cost predictability', 'Good (credits are visible)', 'Risky on-demand — one SELECT * over 100 TB = $625', 'Most predictable (fixed cluster)'],
          ['Ecosystem gravity', 'Cloud-neutral (AWS/GCP/Azure)', 'Deep GCP integration, free batch loads', 'Deep AWS integration (S3, Glue, IAM)'],
          ['Sweet spot', 'Multi-team analytics, data sharing', 'Spiky/exploratory workloads, GCP shops', 'Steady 24/7 workloads, AWS-committed orgs'],
        ],
        verdict:
          'All three are excellent; the decision is usually cloud alignment and pricing-model fit. Spiky exploratory usage favors BigQuery on-demand; steady heavy usage favors Redshift or flat-rate; multi-team isolation favors Snowflake.',
      },
    },
    {
      type: 'diagram',
      title: 'A production search + analytics pipeline',
      caption:
        'One source of truth, two derived systems: CDC streams every change through Kafka into Elasticsearch (search) and Snowflake (analytics). Both are rebuildable by replaying.',
      diagram: {
        height: 420,
        nodes: [
          {
            id: 'pg',
            label: 'Postgres (OLTP)',
            kind: 'db',
            x: 20,
            y: 182,
            detail:
              'Source of truth. Handles ~5,000 transactional QPS. Analytics and search never query it directly — the WAL is the only export interface.',
          },
          {
            id: 'cdc',
            label: 'Debezium CDC',
            kind: 'service',
            x: 210,
            y: 182,
            detail:
              'Tails the write-ahead log and emits one event per row change with sub-second lag. Sequential WAL reads add near-zero load to the primary.',
          },
          {
            id: 'kafka',
            label: 'Kafka',
            kind: 'queue',
            x: 400,
            y: 182,
            detail:
              'Durable fan-out point, one topic per table, 7-day retention. Consumers index, load, and aggregate independently; a consumer that crashes replays from its committed offset.',
          },
          {
            id: 'indexer',
            label: 'Index Consumer',
            kind: 'service',
            x: 610,
            y: 50,
            detail:
              'Transforms change events into documents and bulk-indexes them (batches of 1,000–5,000 docs). End-to-end freshness: typically 2–5 seconds including the 1 s refresh.',
          },
          {
            id: 'es',
            label: 'Elasticsearch',
            kind: 'search',
            x: 820,
            y: 50,
            detail:
              '3-node cluster, 15 primary shards of ~30 GB each + 1 replica. Serves product search at p99 ≈ 50 ms. Fully rebuildable from Postgres if lost.',
          },
          {
            id: 'loader',
            label: 'Stream Loader',
            kind: 'service',
            x: 610,
            y: 320,
            detail:
              'Micro-batches events to object storage every 1–5 minutes, then Snowpipe auto-ingests. Warehouse freshness of minutes is fine for dashboards.',
          },
          {
            id: 'wh',
            label: 'Snowflake',
            kind: 'storage',
            x: 820,
            y: 320,
            detail:
              'Columnar micro-partitions on S3 at ~$23/TB/month; compute warehouses bill per second. A 90-day revenue rollup over 2B rows returns in ~3 s.',
          },
        ],
        edges: [
          { from: 'pg', to: 'cdc', label: 'WAL stream' },
          { from: 'cdc', to: 'kafka', label: 'change events' },
          { from: 'kafka', to: 'indexer' },
          { from: 'indexer', to: 'es', label: 'bulk index' },
          { from: 'kafka', to: 'loader' },
          { from: 'loader', to: 'wh', label: 'micro-batch' },
        ],
      },
    },
    {
      type: 'keyNumbers',
      title: 'Numbers to anchor your design',
      numbers: [
        { metric: 'Elasticsearch query latency', value: '10–100 ms p99', context: 'Well-sized cluster; scatter-gather across shards sets the floor.' },
        { metric: 'ES refresh interval', value: '1 s (default)', context: 'New documents are invisible to search until refresh — "near-real-time".' },
        { metric: 'Healthy shard size', value: '10–50 GB', context: 'Bigger shards recover slowly; thousands of tiny shards wreck the coordinator.' },
        { metric: 'Columnar compression', value: '5–10×', context: 'Dictionary + delta encoding on adjacent similar values. Row stores manage ~2×.' },
        { metric: 'BigQuery on-demand price', value: '$6.25/TiB scanned', context: 'A careless SELECT * over 100 TB costs $625. Partition and cluster your tables.' },
        { metric: 'Snowflake storage', value: '~$23/TB/month', context: 'Object-storage prices — storage and compute scale (and bill) independently.' },
        { metric: 'CDC replication lag', value: '<1 s typical', context: 'Debezium tailing the WAL. Search/warehouse stay seconds behind the OLTP truth.' },
      ],
    },
  ],
  quiz: [
    {
      question: 'Why is a leading-wildcard LIKE query (LIKE \'%term%\') slow on a relational database?',
      options: [
        'String comparison is slow in SQL engines',
        'The query planner refuses to parallelize LIKE',
        'A B-tree index requires a known prefix, so the engine must scan every row',
        'LIKE locks the table for the duration of the scan',
      ],
      answer: 2,
      explanation:
        'B-trees sort by leading bytes; with a leading wildcard there is no prefix to seek to, so the index is useless and the engine full-scans. Inverted indexes solve this by mapping term → documents.',
    },
    {
      question: 'You index a document into Elasticsearch and immediately search for it. It does not appear. Most likely cause?',
      options: [
        'The refresh interval has not elapsed, so the document is not yet in a searchable segment',
        'The replica shards are out of sync',
        'BM25 scored the document at zero',
        'The translog dropped the write',
      ],
      answer: 0,
      explanation:
        'Elasticsearch is near-real-time: writes become searchable on the next refresh (default every 1 s). The write is durable in the translog — it just is not visible yet.',
    },
    {
      question: 'BM25 improves on raw TF-IDF primarily by adding…',
      options: [
        'Semantic vector embeddings for synonyms',
        'PageRank-style link analysis',
        'Per-user personalization signals',
        'Term-frequency saturation and document-length normalization',
      ],
      answer: 3,
      explanation:
        'BM25 caps the benefit of repeating a term (saturation, parameter k1) and penalizes long documents (parameter b). Vectors and personalization are layers built on top, not part of BM25.',
    },
    {
      question: 'A query reads 3 columns of a 60-column, 1B-row table. Roughly how much less I/O does a columnar store do vs a row store, before compression?',
      options: ['About the same', '~20× less', '~2× less', '~1000× less'],
      answer: 1,
      explanation:
        'A row store must read all 60 columns to access 3; columnar reads only the 3 needed — 3/60 = 20× less I/O. Compression (5–10×) then multiplies the win.',
    },
    {
      question: 'What is the main architectural idea behind Snowflake that early Redshift lacked?',
      options: [
        'Columnar storage with compression',
        'SQL compatibility with Postgres',
        'Separation of storage (object store) from per-second-billed, independently scaled compute',
        'Automatic indexing of all columns',
      ],
      answer: 2,
      explanation:
        'Columnar storage was already standard. Snowflake put all data in object storage and made compute stateless and elastic — so teams get isolated warehouses over shared data and pay only while querying.',
    },
  ],
  interviewQuestions: [
    {
      question: 'Explain how a search engine answers "wireless headphones" in 50 ms over 100M products.',
      hint: 'Walk through analysis (tokenize, lowercase, stem), inverted index lookups, postings-list intersection (shortest list first), BM25 scoring of survivors, and top-k merge across shards. Mention why this is O(matching docs), not O(total docs).',
      difficulty: 'Junior',
    },
    {
      question: 'Design the search feature for an e-commerce site whose catalog lives in Postgres.',
      hint: 'Strong answers keep Postgres as source of truth and treat ES as a derived view: CDC (Debezium) → Kafka → indexing consumer, bulk indexing, ~seconds of freshness lag and why that is acceptable. Cover mapping/analyzer design, filters vs scored queries, facets via aggregations, and the fallback/reindex story.',
      difficulty: 'Mid',
    },
    {
      question: 'You need to change the analyzer on a 2 TB Elasticsearch index with zero downtime. How?',
      hint: 'Analyzers are fixed per field — you must reindex. Expected structure: create new index with the new mapping, dual-write (or replay CDC stream) while backfilling via _reindex, verify counts/sampled relevance, then atomically flip an index alias. Discuss handling writes during backfill and rollback.',
      difficulty: 'Senior',
    },
    {
      question: 'The analytics team is running dashboards against your production Postgres and causing latency spikes. Fix the architecture.',
      hint: 'Short term: a dedicated read replica. Right answer: CDC → Kafka → columnar warehouse (Snowflake/BigQuery), explaining row vs columnar I/O, compression, and compute isolation. Bonus: discuss freshness SLAs (minutes), cost controls (partitioning, scan pricing), and why pre-aggregation helps BI tools.',
      difficulty: 'Mid',
    },
  ],
  commonMistakes: [
    'Using Elasticsearch as the primary datastore. No transactions, near-real-time visibility, and historically rough partition behavior — keep the source of truth in a database and treat ES as a rebuildable derived view.',
    'Dual-writing to Postgres and Elasticsearch from application code. The two stores silently diverge on partial failures; CDC from the WAL gives you ordering and replay for free.',
    'Oversharding. 5,000 shards of 200 MB each turns every query into a 5,000-way scatter-gather. Target 10–50 GB per shard and count shards per node in the low hundreds at most.',
    'Running analytics on the OLTP database "because the data is already there". One analyst scan evicts your buffer cache and your p99 doubles. Ship data to a columnar store; freshness of minutes is almost always acceptable.',
    'Ignoring scan-based pricing. SELECT * in BigQuery bills every column of every partition touched — $6.25/TiB. Select needed columns, partition by date, cluster by common filters.',
  ],
  cloudMappings: [
    { concept: 'Managed search engine', aws: 'OpenSearch Service', gcp: 'Elastic Cloud (Marketplace) / Vertex AI Search', azure: 'Azure AI Search' },
    { concept: 'Columnar data warehouse', aws: 'Redshift', gcp: 'BigQuery', azure: 'Synapse Analytics / Fabric' },
    { concept: 'Change data capture', aws: 'DMS / MSK Connect (Debezium)', gcp: 'Datastream', azure: 'Data Factory CDC' },
    { concept: 'Event streaming backbone', aws: 'MSK / Kinesis', gcp: 'Pub/Sub', azure: 'Event Hubs' },
    { concept: 'Data lake object storage', aws: 'S3 (+ Glue catalog)', gcp: 'GCS (+ Dataproc/BigLake)', azure: 'ADLS Gen2' },
    { concept: 'Streaming ingest to warehouse', aws: 'Kinesis Firehose → Redshift', gcp: 'Pub/Sub → BigQuery subscriptions', azure: 'Event Hubs → Synapse' },
  ],
}

export default searchAnalytics
