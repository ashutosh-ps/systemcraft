import type { Module } from '../../../lib/types'

const databases: Module = {
  id: 'databases',
  category: 'fundamentals',
  title: 'Databases: SQL vs NoSQL Trade-offs',
  description:
    'The most consequential choice in any design. ACID and the relational model, B-trees vs LSM-trees, the four NoSQL families, and when denormalization is the right kind of wrong.',
  difficulty: 'Mid',
  estMinutes: 150,
  keywords: ['ACID', 'B-tree', 'LSM-tree', 'DynamoDB', 'Cassandra', 'denormalization', 'polyglot persistence', 'indexes'],
  related: ['sharding', 'replication', 'caching', 'search-analytics'],
  sections: [
    {
      type: 'text',
      title: 'The relational model and ACID',
      md: `
Relational databases store data in normalized tables and let you recombine it at query time with joins. The killer
feature isn't SQL syntax; it's **ACID transactions**, which let you treat a multi-step change as one atomic unit:

- **Atomicity:** a transfer debits account A and credits account B, or does neither. No half-transfers, even if
  the server dies between the two updates.
- **Consistency:** constraints hold before and after: \`balance >= 0\`, foreign keys resolve, uniqueness is
  enforced *by the database*, not by hopeful application code.
- **Isolation:** two users buying the last concert ticket don't both succeed. Postgres defaults to
  \`READ COMMITTED\`; bumping to \`SERIALIZABLE\` closes subtle anomalies at a ~10–30% throughput cost.
- **Durability:** once committed, the write survives a crash, because it was fsynced to the WAL
  (write-ahead log) before the client got its OK.

What this buys you in practice: a single Postgres node on decent hardware (16–32 vCPU, NVMe) sustains roughly
**5,000–50,000 transactions/second** depending on transaction complexity: pgbench-style simple transactions land
near the top, multi-table writes with index updates near the bottom. That is *plenty* for the vast majority of
businesses; Stack Overflow famously ran on a handful of SQL Server boxes while serving ~1.3B pageviews/month.

> Interview rule: start with a relational database **by default**. You should need a *reason* to leave ACID,
> joins, and 50 years of tooling. "We might be big someday" is not one.
`,
    },
    {
      type: 'text',
      title: 'Storage engines: B-tree vs LSM-tree',
      md: `
Under every database is one of two storage engine families, and the choice dictates the read/write trade-off.

#### B-trees (Postgres, MySQL/InnoDB, SQL Server)

Data lives in fixed-size pages (8–16 KB) in a balanced tree. Reading a row in a billion-row table touches
**3–4 pages**, and with the upper levels cached in RAM, that's often a single disk read. But writes update pages
**in place**: a single row change rewrites a whole page, and a write that touches 5 indexes dirties 6+ pages.
Random in-place writes are exactly what disks (even SSDs) like least.

- **Read amplification: low** (one tree descent). **Write amplification: moderate-to-high** (page rewrites + WAL).
- Optimized for: read-heavy and mixed OLTP, range scans, predictable latency.

#### LSM-trees (Cassandra, RocksDB, LevelDB, HBase, ScyllaDB)

Writes go to an in-memory memtable and a sequential commit log (**append-only, no random I/O**), then flush to
immutable sorted files (SSTables). Background **compaction** merges files and discards overwritten values. This is
why Cassandra sustains **10,000–15,000 writes/s per node** and clusters scale linearly; Netflix has run
benchmarks past **1M writes/s** on large clusters.

The bill arrives on reads: a key may live in the memtable or any of several SSTables, so a read can check multiple
files (bloom filters cut most of these to ~1 disk read). And compaction re-writes data repeatedly, giving
**write amplification of 10–30×** at the disk level, paid in background I/O instead of foreground latency.

> Mnemonic: **B-tree = pay at write time, read fast. LSM = write fast, pay at read + compaction time.** Choose by
> your read:write ratio.
`,
    },
    {
      type: 'text',
      title: 'NoSQL families I: key-value and document',
      md: `
"NoSQL" is four different data models that happen to share a marketing label. Each one gives up part of the
relational toolkit to win something specific.

#### Key-value stores: Redis, DynamoDB, etcd

The simplest contract: \`GET(key)\`, \`PUT(key, value)\`. No joins, no secondary queries (or limited ones), and in
exchange you get predictable, low, *flat* latency at any scale. **DynamoDB delivers single-digit-millisecond reads
and writes whether you store 1 GB or 100 TB**, because every operation is a hash-partition lookup. Pricing is
per-request: about **$1.25 per million write request units and $0.25 per million reads** (on-demand), which makes
costs linear and predictable, and makes scan-heavy access patterns ruinously expensive.

- **Use when:** sessions, carts, feature flags, user profiles fetched by ID, anything shaped like "lookup by key."
- **Avoid when:** you need ad-hoc queries, aggregations, or access by anything other than the key you designed for.

#### Document stores: MongoDB, Firestore, Couchbase

Values become structured JSON/BSON documents you can index and query *inside*. The natural fit is data that's
read and written as one aggregate: a product with its variants, an order with its line items. One document read
replaces a 4-way join. Schema is flexible: great for fast-moving product teams, dangerous without discipline
(you *will* end up with five spellings of the same field unless you validate at the application boundary).

- **Use when:** aggregate-shaped data, heterogeneous records, rapid iteration.
- **Avoid when:** data is highly relational (many-to-many everywhere) or you need multi-document transactions as
  a core pattern. It is possible in MongoDB since 4.0, but it's swimming upstream.
`,
    },
    {
      type: 'text',
      title: 'NoSQL families II: wide-column and graph',
      md: `
#### Wide-column stores: Cassandra, ScyllaDB, HBase, Bigtable

Think "two-level key-value": a partition key locates the node, a clustering key sorts rows *within* the partition.
You model **queries, not entities**: each table is pre-built to answer one access pattern, and data is duplicated
across tables as needed. LSM storage plus leaderless replication gives Cassandra linear write scaling and no
single point of failure; Apple has publicly described clusters of **thousands of nodes storing petabytes**.

- **Use when:** write-heavy time-series, event logs, messaging history, IoT telemetry, all append-mostly data
  queried by a known key + time range.
- **Avoid when:** you need ad-hoc queries, transactions, or you can't enumerate your access patterns up front.

#### Graph databases: Neo4j, Amazon Neptune

Nodes and edges are first-class, and traversals follow direct pointers instead of join algorithms. The win is
**multi-hop queries**: "friends-of-friends who like X" is a 3-hop traversal that runs in milliseconds, while the
SQL equivalent is a triple self-join whose cost explodes with depth. The trade: graph DBs shard poorly (cutting a
graph across machines makes traversals network-bound), so most deployments stay vertically scaled.

- **Use when:** the *relationships* are the product: social graphs, fraud rings, recommendations, dependency
  analysis.
- **Avoid when:** you have a graph-shaped query twice a day. A recursive CTE in Postgres handles shallow
  traversals fine; don't add a database for one query.
`,
    },
    {
      type: 'text',
      title: 'Denormalization and the true cost of indexes',
      md: `
#### Denormalization: buying reads with writes

Normalization removes duplication so every fact lives in one place. **Denormalization deliberately re-introduces
duplication so reads don't have to assemble facts at query time.** Storing \`author_name\` on every post means the
feed query skips a join, and means renaming an author touches a million rows. You're converting one expensive
read pattern into a write-time obligation plus a consistency liability.

Do it when (a) the read:write ratio is heavily skewed (100:1 feeds, catalogs), (b) the duplicated field changes
rarely, and (c) you have a mechanism (async backfill job, CDC consumer) to repair drift. In NoSQL, denormalization
isn't an optimization; it's the *required modeling style*, because there are no joins to skip.

#### Indexes are not free

An index is a second, sorted copy of part of your table that the database must update **synchronously on every
write**. Rules of thumb:

- Each secondary B-tree index adds roughly **5–15% write overhead**; a table with 8 indexes can see inserts run
  2× slower than with 2.
- Indexes consume RAM that would otherwise cache data: a 50 GB table with 30 GB of indexes fights itself for
  buffer pool.
- The flip side is dramatic: a missing index turns a 2 ms lookup into a 4-second sequential scan on a 10M-row
  table.

> Habit to demonstrate in interviews: design indexes *from the query list*, not the schema, and say out loud
> which writes each index taxes.
`,
    },
    {
      type: 'comparison',
      title: 'Design decision: SQL vs NoSQL',
      comparison: {
        columns: ['Criterion', 'Relational (Postgres, MySQL)', 'NoSQL (DynamoDB, Cassandra, MongoDB)'],
        rows: [
          ['Data model', 'Normalized tables, joins at query time', 'Aggregates / query-shaped tables, duplication by design'],
          ['Transactions', 'Full multi-row ACID by default', 'Single-item atomic ops; multi-item is limited or costly'],
          ['Schema', 'Enforced up front; migrations are a ritual', 'Flexible; discipline moves into application code'],
          ['Query flexibility', 'Ad-hoc SQL, aggregations, window functions', 'Pre-designed access patterns; ad-hoc = scan = pain'],
          ['Scaling model', 'Vertical first, read replicas, sharding is manual surgery', 'Horizontal by design; partition key does the sharding'],
          ['Single-node throughput', '~5–50K TPS (workload-dependent)', 'Cassandra ~10–15K writes/s/node, linear with nodes'],
          ['Latency profile', '1–10 ms typical, degrades with contention/joins', 'DynamoDB: single-digit ms at any table size'],
          ['Cost shape', 'Instance-based (db.r6g.2xlarge ≈ $1,050/mo)', 'Request-based (DynamoDB $1.25/M writes, $0.25/M reads)'],
          ['Consistency', 'Strong on the primary, tunable on replicas', 'Tunable (Cassandra ONE/QUORUM/ALL; DynamoDB eventual/strong reads)'],
        ],
        verdict:
          'Default to Postgres until a specific axis breaks: write volume beyond one node (wide-column), key-lookup latency at huge scale (key-value), or relationship-heavy queries (graph). Migrating from SQL to NoSQL later is far easier than recovering joins and transactions you gave away on day one.',
      },
    },
    {
      type: 'code',
      title: 'Schema design in practice: DDL plus a query autopsy',
      language: 'sql',
      code: `
-- E-commerce core: normalized where it matters, denormalized where it pays.

CREATE TABLE users (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,            -- UNIQUE => implicit index (taxes every insert)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  status      TEXT NOT NULL CHECK (status IN ('pending','paid','shipped','cancelled')),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),  -- money as integers, never floats
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  order_id    BIGINT NOT NULL REFERENCES orders(id),
  product_id  BIGINT NOT NULL,
  qty         INTEGER NOT NULL CHECK (qty > 0),
  -- DENORMALIZED on purpose: price at purchase time. Catalog price changes
  -- must not rewrite history; an "update anomaly" here is actually a feature.
  unit_price_cents INTEGER NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

-- Built from the query list, not the schema:
-- "show a user's recent orders" runs 500x/s, so it gets a composite index.
CREATE INDEX idx_orders_user_recent ON orders (user_id, created_at DESC);

-- The hot query:
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, total_cents, created_at
FROM orders
WHERE user_id = 4242
ORDER BY created_at DESC
LIMIT 10;

-- Good plan (with the index):
--   Index Scan using idx_orders_user_recent on orders
--     (cost=0.43..12.1 rows=10) (actual time=0.04..0.09 rows=10)
--   Buffers: shared hit=5
-- => walks the index already sorted, stops after 10 rows. ~0.1 ms, 5 pages, all from RAM.
--
-- Without the index, the same query on 50M orders:
--   Sort (cost=812k..813k) -> Parallel Seq Scan on orders
--     (actual time=2900..3100 rows=10)
-- => scans the whole table, sorts millions of rows, returns 10. ~3 s and an I/O storm.
--
-- The price: idx_orders_user_recent adds ~10% to every INSERT INTO orders.
-- 500 reads/s saved vs ~50 writes/s taxed -- easily worth it. Always do this math.
`,
    },
    {
      type: 'diagram',
      title: 'Polyglot persistence: one product, five stores',
      caption:
        'Mature systems pick a store per data shape. The ACID core stays small; everything else is chosen for its access pattern, with CDC keeping derived stores in sync.',
      diagram: {
        height: 480,
        nodes: [
          {
            id: 'client',
            label: 'Clients',
            kind: 'client',
            x: 20,
            y: 210,
            detail: 'Web and mobile apps. A single page view may fan out to 3–5 different storage systems behind the API without knowing it.',
          },
          {
            id: 'api',
            label: 'API Service',
            kind: 'service',
            x: 210,
            y: 210,
            detail: 'Routes each access pattern to the right store: transactional writes to Postgres, key lookups to Redis, event appends to Cassandra, full-text to Elasticsearch.',
          },
          {
            id: 'pg',
            label: 'PostgreSQL',
            kind: 'db',
            x: 450,
            y: 40,
            detail: 'Source of truth for orders, payments, inventory, anything needing ACID. One primary (~10–30K TPS) plus replicas. Deliberately kept small and boring.',
          },
          {
            id: 'redis',
            label: 'Redis',
            kind: 'cache',
            x: 450,
            y: 150,
            detail: 'Sessions, carts, rate-limit counters, hot entity cache. ~100K ops/s/node at sub-millisecond latency; data is rebuildable, so loss is tolerable.',
          },
          {
            id: 'cass',
            label: 'Cassandra',
            kind: 'db',
            x: 450,
            y: 270,
            detail: 'Clickstream and order-event history: append-heavy, queried by (user, time range). 12-node cluster absorbing ~120K writes/s that would crush the Postgres primary.',
          },
          {
            id: 's3',
            label: 'S3 / Blob',
            kind: 'storage',
            x: 450,
            y: 390,
            detail: 'Product images, invoices, ML training exports. $0.023/GB-month, 11 nines durability: three orders of magnitude cheaper per GB than any database above.',
          },
          {
            id: 'kafka',
            label: 'Kafka CDC',
            kind: 'queue',
            x: 660,
            y: 40,
            detail: 'Debezium tails the Postgres WAL and publishes row changes as ordered events. Derived stores subscribe instead of being dual-written: one source of truth, no write skew.',
          },
          {
            id: 'es',
            label: 'Elasticsearch',
            kind: 'search',
            x: 850,
            y: 40,
            detail: 'Full-text product search with typo tolerance and facets, queries Postgres is terrible at. Indexes lag the source by ~1–2 s via the CDC pipeline, which search tolerates fine.',
          },
        ],
        edges: [
          { from: 'client', to: 'api', label: 'HTTPS' },
          { from: 'api', to: 'pg', label: 'orders (ACID)' },
          { from: 'api', to: 'redis', label: 'sessions, cache' },
          { from: 'api', to: 'cass', label: 'event appends' },
          { from: 'api', to: 's3', label: 'media' },
          { from: 'pg', to: 'kafka', label: 'WAL → CDC' },
          { from: 'kafka', to: 'es', label: 'index updates' },
          { from: 'api', to: 'es', label: 'search queries', dashed: true },
        ],
      },
    },
    {
      type: 'keyNumbers',
      title: 'Database numbers worth memorizing',
      numbers: [
        { metric: 'Postgres single node', value: '5–50K TPS', context: 'Simple transactions on 16–32 vCPU; complex multi-index writes sit at the low end.' },
        { metric: 'Indexed point query', value: '0.1–2 ms', context: 'B-tree descent with hot pages in RAM. The baseline for "the database is fast."' },
        { metric: 'DynamoDB latency', value: '<10 ms p99', context: 'Single-digit milliseconds at 1 GB or 100 TB; flat latency is the whole pitch.' },
        { metric: 'DynamoDB on-demand price', value: '$1.25/M writes', context: 'Reads $0.25/M. Linear and predictable, and why table scans are a budget incident.' },
        { metric: 'Cassandra per node', value: '~10–15K writes/s', context: 'LSM + leaderless replication; add nodes for linear scaling into the millions.' },
        { metric: 'Secondary index cost', value: '+5–15% per write', context: 'Each index is a synchronously-maintained copy. Eight indexes can double insert time.' },
        { metric: 'LSM write amplification', value: '10–30×', context: 'Compaction rewrites data repeatedly in the background; budget disk I/O for it.' },
      ],
    },
  ],
  quiz: [
    {
      question: 'Which storage engine choice best fits an ingest service absorbing 200K sensor writes/second with occasional range reads by device and time?',
      options: [
        'B-tree engine (Postgres): strongest consistency',
        'LSM-tree engine (Cassandra/ScyllaDB): sequential appends, linear write scaling',
        'Graph database: sensors are connected to each other',
        'Document store: flexible sensor schemas',
      ],
      answer: 1,
      explanation:
        'LSM-trees turn writes into sequential appends plus background compaction, which is why wide-column LSM stores sustain 10–15K writes/s/node and scale linearly. B-trees pay random in-place page writes on every insert.',
    },
    {
      question: 'A transfer must debit one account and credit another, surviving crashes mid-operation. Which property guarantees no half-transfer is ever visible?',
      options: ['Durability', 'Isolation', 'Consistency', 'Atomicity'],
      answer: 3,
      explanation:
        'Atomicity makes the two updates one all-or-nothing unit, so a crash between them rolls both back. Isolation handles concurrent transactions; durability handles surviving the crash after commit.',
    },
    {
      question: 'Your team adds a 7th secondary index to a hot orders table. The most likely consequence is:',
      options: [
        'Insert/update throughput drops noticeably, since every write now maintains 7 sorted structures',
        'Reads get slower because the planner is confused',
        'Nothing; indexes only cost disk space',
        'Deadlocks disappear',
      ],
      answer: 0,
      explanation:
        'Every index is updated synchronously on every write, costing roughly 5–15% each. Indexes also compete with table data for buffer-pool RAM. Add them from the query list, and audit unused ones.',
    },
    {
      question: 'Storing author_name on every post row (instead of joining to users) is an example of:',
      options: [
        'Normalization: it follows third normal form',
        'A schema migration',
        'Denormalization: trading write-time duplication for read-time speed',
        'An ACID violation',
      ],
      answer: 2,
      explanation:
        'Denormalization duplicates a fact so reads skip a join, at the cost of updating many rows when the fact changes. Right call for 100:1 read:write ratios on rarely-changing fields, with a repair mechanism for drift.',
    },
    {
      question: 'Why does DynamoDB stay at single-digit-millisecond latency even at 100 TB, while a single Postgres node would not?',
      options: [
        'DynamoDB runs on faster hardware',
        'Every operation is a hash-partition key lookup routed to one partition, so work per request stays constant as data grows',
        'DynamoDB caches everything in RAM',
        'It skips durability, so writes are faster',
      ],
      answer: 1,
      explanation:
        'DynamoDB shards by partition key automatically, so each request touches a constant-size slice regardless of total table size. The price: you must access data by that key, and ad-hoc queries become scans.',
    },
  ],
  interviewQuestions: [
    {
      question: 'When would you choose a NoSQL database over a relational one? Give a concrete scenario for each direction.',
      hint: 'Structure: default to relational (ACID, joins, ad-hoc queries) and name the breaking points: write volume beyond one node, key-lookup scale, enumerable access patterns. NoSQL example: session store or event firehose on DynamoDB/Cassandra. SQL example: payments/inventory needing multi-row transactions. Strong answers mention that the choice is per-dataset, not per-company.',
      difficulty: 'Junior',
    },
    {
      question: 'Explain B-tree vs LSM-tree storage to a teammate, and tell me which you would pick for a chat app storing message history.',
      hint: 'Expected: B-tree = in-place pages, cheap reads, random-write cost; LSM = append-only memtable/SSTables + compaction, cheap writes, read and compaction amplification (bloom filters as mitigation). Chat history is append-heavy and read by (conversation, time range), so a wide-column LSM store partitioned by conversation ID fits; cite Discord moving messages from MongoDB to Cassandra then ScyllaDB.',
      difficulty: 'Mid',
    },
    {
      question: 'Your product search runs LIKE queries on Postgres and takes 4 seconds. Walk me through the fix without breaking order processing.',
      hint: 'Diagnose: leading-wildcard LIKE cannot use a B-tree index, so it sequential-scans. Options ladder: pg_trgm/GIN or tsvector full-text inside Postgres first; if relevance/facets/typo-tolerance are needed, add Elasticsearch/OpenSearch fed by CDC (Debezium → Kafka), never dual writes. Address lag (~1–2 s), reindexing strategy, and keeping Postgres as the source of truth.',
      difficulty: 'Mid',
    },
    {
      question: 'Design the data layer for an e-commerce platform at 50M users: catalog, carts, orders, search, and analytics. Justify every store you add.',
      hint: 'Looking for polyglot persistence with restraint: Postgres (sharded or Aurora) for orders/inventory with ACID; Redis for carts/sessions; search via OpenSearch fed by CDC; events to Kafka with a warehouse (BigQuery/Snowflake) for analytics; S3 for media. Each store must be justified by an access pattern, with a stated sync mechanism and consistency story, plus a pushback on any store that doesn’t earn its operational cost.',
      difficulty: 'Senior',
    },
  ],
  commonMistakes: [
    'Choosing NoSQL "for scale" at 200 QPS. A single Postgres node handles thousands of TPS; what you actually gave up is joins, constraints, and transactions, things you needed on day one.',
    'Modeling DynamoDB or Cassandra like a relational schema, then "querying" with scans. Wide-column and key-value stores require designing tables from the access-pattern list; if you can\'t enumerate the queries, you\'ve chosen the wrong store.',
    'Dual-writing to keep two stores in sync (e.g., Postgres + Elasticsearch from application code). One write will fail eventually and the stores drift forever. Use CDC from the source of truth instead.',
    'Indexing every column "to be safe." Each index taxes every write 5–15% and steals buffer-pool RAM. Build indexes from the slow-query log and the query list, and drop unused ones (pg_stat_user_indexes shows zero-scan indexes).',
    'Storing money as floats. 0.1 + 0.2 != 0.3 in IEEE 754; use integer cents or DECIMAL, and make the interviewer hear you say it.',
  ],
  cloudMappings: [
    { concept: 'Managed relational (OLTP)', aws: 'RDS / Aurora PostgreSQL', gcp: 'Cloud SQL / AlloyDB', azure: 'Azure Database for PostgreSQL' },
    { concept: 'Serverless key-value / wide-column', aws: 'DynamoDB', gcp: 'Bigtable / Firestore', azure: 'Cosmos DB (NoSQL / Cassandra API)' },
    { concept: 'Document database', aws: 'DocumentDB (MongoDB-compatible)', gcp: 'Firestore', azure: 'Cosmos DB (MongoDB API)' },
    { concept: 'Graph database', aws: 'Neptune', gcp: '– (Neo4j Aura from Marketplace)', azure: 'Cosmos DB (Gremlin API)' },
    { concept: 'Full-text search', aws: 'OpenSearch Service', gcp: 'Elastic Cloud (partner) / Vertex AI Search', azure: 'Azure AI Search' },
    { concept: 'Change data capture / sync', aws: 'DMS / MSK + Debezium', gcp: 'Datastream', azure: 'Azure Data Factory CDC' },
  ],
}

export default databases
