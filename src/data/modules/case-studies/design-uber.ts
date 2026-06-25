import type { Module } from '../../../lib/types'

const designUber: Module = {
  id: 'design-uber',
  category: 'case-studies',
  title: 'Design Uber / Ride-Hailing',
  description:
    'Match millions of riders to drivers in seconds. The core problems: ingesting 1M+ GPS pings per second, geospatial indexing (geohash vs quadtree vs H3), and a dispatch flow that locks exactly one driver per trip.',
  difficulty: 'Senior',
  estMinutes: 170,
  keywords: ['geospatial index', 'H3', 'geohash', 'quadtree', 'dispatch', 'ride matching', 'Redis GEO', 'location tracking'],
  related: ['realtime-systems', 'message-queues', 'sharding', 'distributed-systems'],
  sections: [
    {
      type: 'text',
      title: 'Step 1: Requirements, scope it like an interview',
      md: `
Start by carving the problem down to the parts that are actually hard. For ride-hailing:

**Functional requirements**

- **Rider requests a trip** (pickup + destination) and gets matched to a nearby driver.
- **Live location tracking**: riders see their driver moving on the map; ops sees the whole fleet.
- **ETA**: estimated pickup and trip time, used both in the UI and in matching decisions.
- **Pricing**: upfront fare quote, including surge multipliers when demand outstrips supply.
- **Trip lifecycle**: requested → matched → driver en route → in progress → completed → paid. Each transition must be durable, because money depends on it.

**Explicitly out of scope** (say this out loud): payments processing internals, fraud, driver onboarding, maps/routing engine internals (treat ETA as a service you call).

**Non-functional requirements (these drive the whole design)**

- **Matching latency < 30 s** end-to-end from request to driver acceptance; the k-nearest-driver query itself must run in **tens of milliseconds**.
- **Location updates every 4–5 s** from every active driver. At ~5M concurrently active drivers worldwide that's **>1M writes/second**, so your write path is the beast, not the read path.
- Location reads can be slightly stale (2–4 s is invisible on a map), but **trip state must be strongly consistent**: a driver can never be assigned two trips.
- Availability over consistency for the *location* plane; the opposite for the *trip/money* plane.

> Interview tip: stating "location data is AP, trip state is CP" in the first five minutes signals you already know where the bodies are buried.
`,
    },
    {
      type: 'code',
      title: 'Step 2: Capacity estimation',
      language: 'python',
      code: `
# --- Location ingest (the dominant load) ---
active_drivers = 5_000_000        # concurrently online worldwide, peak
update_interval_s = 4             # GPS ping every 4 seconds

location_writes_qps = active_drivers / update_interval_s
# = 1,250,000 writes/sec  <-- this number shapes the whole design

ping_size_bytes = 60              # driver_id, lat, lng, heading, ts, accuracy
ingest_bandwidth = location_writes_qps * ping_size_bytes
# = ~75 MB/s sustained, ~600 Mbps -- network is fine, storage churn is not

# --- Trips ---
trips_per_day = 25_000_000        # Uber did ~26M/day in 2024
avg_trip_qps = trips_per_day / 86_400          # ~290 trips/sec
peak_trip_qps = avg_trip_qps * 3               # ~870 matches/sec at peak

# --- Storage if you (wrongly) kept every ping forever ---
pings_per_day = location_writes_qps * 86_400   # ~108B pings/day
raw_per_day = pings_per_day * ping_size_bytes  # ~6.5 TB/day raw
# x3 replication x 365 days = ~7 PB/year of mostly-worthless coordinates.
# Conclusion: keep ~30 days of trip-associated traces, downsample the rest.

# --- Matching read load ---
# Each match runs ~1 k-NN query + 1-3 re-offers => ~3,000 geo-queries/sec peak.
# 3K reads/sec vs 1.25M writes/sec: optimize the WRITE path first.
`,
    },
    {
      type: 'calculator',
      title: 'Try it: location ingest QPS at different fleet sizes',
      calculator: 'qps',
    },
    {
      type: 'text',
      title: 'Step 3: The core problem of geospatial indexing',
      md: `
"Find the 10 nearest available drivers" is a k-nearest-neighbor query. A B-tree can index latitude *or* longitude,
not both: a range scan on one dimension returns a useless horizontal stripe of the planet. You need a spatial
index. Three families dominate:

#### Geohash
Interleave the bits of lat/lng and base32-encode them. Nearby points *usually* share prefixes, so a 6-character
geohash (~**1.2 km × 0.6 km** cell) becomes a plain string key. This is exactly what Redis GEO does internally with
a 52-bit geohash in a sorted set. Weaknesses: cells are rectangles that distort with latitude, and **edge cases lie**.
Two points 10 m apart across a cell boundary share no prefix, so every query must also check the 8 neighbor cells.

#### Quadtree
Recursively split the map into 4 quadrants until each leaf holds ≤ N points. Adapts beautifully to density: one
leaf covers downtown San Francisco, another covers half of Nevada. But it's an in-memory pointer structure that's
awkward to shard, and rebalancing under 1M writes/sec is painful.

#### S2 (Google) and H3 (Uber)
Project the globe onto a polyhedron and tile it hierarchically. **Uber built H3 specifically because hexagons have
one killer property: all 6 neighbors are equidistant from the center.** Squares have two neighbor distances (edge vs
diagonal), which biases distance approximations, surge zone smoothing, and ETA bucketing. H3 has 16 resolutions.
Uber's workhorses are **res 7 (~5.2 km²)** for surge zones and **res 9 (~0.1 km², ~174 m edge)** for driver
bucketing. A k-ring lookup (cell + k rings of neighbors) replaces radius math with integer set membership.
`,
    },
    {
      type: 'comparison',
      title: 'Geohash vs Quadtree vs H3/S2',
      comparison: {
        columns: ['Criterion', 'Geohash', 'Quadtree', 'H3 / S2 (cell grid)'],
        rows: [
          ['Cell shape', 'Rectangles (distort toward poles)', 'Adaptive squares', 'Hexagons (H3) / squares on a sphere (S2)'],
          ['Neighbor lookup', 'Compute 8 neighbors; prefix tricks break at boundaries', 'Tree traversal', 'O(1) k-ring; all 6 hex neighbors equidistant'],
          ['Density adaptation', 'None (fixed precision per query)', 'Excellent (splits where points cluster)', 'Pick resolution per use case (res 7 surge, res 9 dispatch)'],
          ['Shardability', 'Great (cells are plain string keys)', 'Poor (pointer structure, hard to partition)', 'Great (64-bit cell IDs as shard/partition keys)'],
          ['Write cost at 1M+ QPS', 'O(log n) sorted-set insert (Redis GEO)', 'Rebalancing hot spots under churn', 'Hash-bucket update, O(1)'],
          ['Off-the-shelf support', 'Redis GEO, many DBs', 'PostGIS-style R-tree/quadtree indexes', 'H3/S2 libraries; you own the storage layer'],
        ],
        verdict:
          'Interview-safe answer: Redis GEO (geohash) gets a working v1 in one sentence; then explain you would evolve to H3 cell IDs as keys for equidistant neighbors, per-resolution zones, and clean sharding, which is the path Uber actually took.',
      },
    },
    {
      type: 'diagram',
      title: 'Step 4: High-level architecture',
      caption:
        'Write path (driver pings) and match path (rider requests) are separate planes. Kafka decouples real-time serving from pricing, ETA, and cold storage.',
      diagram: {
        height: 440,
        nodes: [
          { id: 'driver', label: 'Driver App', kind: 'client', x: 20, y: 50, detail: 'Sends a GPS ping every 4 s over a persistent connection: ~60 bytes of driver_id, lat/lng, heading, status. 5M concurrent drivers = 1.25M pings/sec globally.' },
          { id: 'rider', label: 'Rider App', kind: 'client', x: 20, y: 300, detail: 'Requests trips and subscribes to driver location updates for the active trip. Receives pushed positions every 4 s, no polling.' },
          { id: 'gw', label: 'WS Gateway', kind: 'lb', x: 215, y: 175, detail: 'Terminates millions of WebSocket/QUIC connections; ~50-100K connections per node, so a fleet of 100+ gateways. Routes pings to the location service and pushes match offers and driver positions back down.' },
          { id: 'loc', label: 'Location Svc', kind: 'service', x: 415, y: 50, detail: 'Stateless ingest tier. Validates and snaps pings, computes the H3 res-9 cell, updates the hot index, and publishes every ping to Kafka. Sharded by city/region so one region’s load spike stays local.' },
          { id: 'redis', label: 'Redis Geo Index', kind: 'cache', x: 620, y: 50, detail: 'Hot driver index: cell-bucketed driver positions with TTL ~15 s (3 missed pings = driver invisible). A 64-shard cluster absorbs 1.25M writes/sec at ~20K ops/sec/shard with room to spare; k-NN reads answer in 1-5 ms.' },
          { id: 'match', label: 'Matching Svc', kind: 'service', x: 415, y: 300, detail: 'On a trip request: query the rider’s H3 cell + 2 k-rings for candidate drivers, rank by ETA (not straight-line distance), then run the offer/lock/timeout loop. Budget: <100 ms to produce a ranked candidate list.' },
          { id: 'trip', label: 'Trip Svc', kind: 'service', x: 620, y: 300, detail: 'Owns the trip state machine (requested -> matched -> en route -> in progress -> completed). Transitions are transactional; this is the CP part of the system.' },
          { id: 'pg', label: 'PostgreSQL', kind: 'db', x: 830, y: 300, detail: 'Source of truth for trips, sharded by city_id. ~870 trip creations/sec peak plus ~6 state transitions per trip is comfortably within a sharded Postgres’s envelope.' },
          { id: 'kafka', label: 'Kafka', kind: 'queue', x: 620, y: 175, detail: 'Every ping and trip event lands here; Uber runs Kafka at trillions of messages/day. Consumers: surge pricing, ETA model features, Cassandra archiver, fraud, analytics. Real-time serving never blocks on any of them.' },
          { id: 'pricing', label: 'Pricing / ETA', kind: 'service', x: 830, y: 175, detail: 'Consumes ping and demand streams, computes per-H3-res-7-cell surge multipliers every ~30-60 s, and serves ETA predictions. Feeds the multiplier back to matching and fare quotes.' },
        ],
        edges: [
          { from: 'driver', to: 'gw', label: 'GPS / 4 s' },
          { from: 'rider', to: 'gw', label: 'request trip', bidirectional: true },
          { from: 'gw', to: 'loc', label: 'pings' },
          { from: 'loc', to: 'redis', label: 'cell update' },
          { from: 'gw', to: 'match', label: 'trip request' },
          { from: 'match', to: 'redis', label: 'k-NN query' },
          { from: 'match', to: 'trip', label: 'create trip' },
          { from: 'trip', to: 'pg', label: 'SQL txn' },
          { from: 'loc', to: 'kafka', label: 'publish' },
          { from: 'kafka', to: 'pricing', label: 'streams' },
          { from: 'pricing', to: 'match', label: 'surge factor', dashed: true },
        ],
      },
    },
    {
      type: 'text',
      title: 'Step 5: Matching and dispatch, locking exactly one driver',
      md: `
The matching flow is where candidates become a committed trip, and it's a distributed-locking problem in disguise:

1. **Candidate generation.** Query the rider's H3 cell plus 2 k-rings (~7–19 cells) for available drivers. In a
   dense city this returns 20–200 candidates in a few milliseconds.
2. **Ranking.** Straight-line distance lies: a driver 300 m away across a river might be 10 minutes out. Rank by
   **predicted ETA** from the routing service, blended with driver acceptance rate and fairness (don't starve
   drivers who just went online).
3. **Offer with a lock.** Pick the top driver and acquire a short lease: \`SET driver:123:lock trip-456 NX PX 15000\`
   (atomic, expires in 15 s). The driver's phone shows the offer with a ~10–15 s countdown.
4. **Accept or move on.** Accept → transactionally transition the trip to \`matched\`, mark the driver busy, release
   the lock. Decline/timeout → release and offer to candidate #2. Three or four rounds still lands well inside the
   30 s budget.

**Why a lock and not "first to accept wins"?** Broadcasting to 10 drivers feels faster but creates a thundering
herd: 9 drivers tap *accept* and 8 get an error, training drivers to ignore offers. Sequential offers with short
timeouts keep acceptance meaningful. (Batching *is* used for efficiency-critical products like UberPool, where the
matcher solves a small assignment problem over a few seconds' window instead.)

> Edge case interviewers love: the driver accepts at second 14.9 and the lock has just expired. The accept must be a
> compare-and-swap on the trip row (\`WHERE state = 'offered' AND offered_to = 123\`), not a blind update. The DB
> transition, not the Redis lock, is the source of truth.
`,
    },
    {
      type: 'text',
      title: 'Step 6: Location data lifecycle (hot, warm, cold)',
      md: `
The instinct to "store every ping in the database" is how this design dies. Tier it by access pattern:

#### Hot: latest position only (Redis, seconds of retention)
Matching needs exactly one fact per driver: *where are you right now?* Keep the latest position per driver in the
in-memory cell index with a **15 s TTL**: three missed pings and the driver simply vanishes from matching, which is
the correct failure mode for a dead phone. Memory math: 5M drivers × ~100 bytes ≈ **500 MB**, so the entire world's
hot state fits in one Redis node's RAM; you shard for write throughput, not capacity.

#### Warm: trip traces (Cassandra, ~30 days)
During a trip, pings are appended to a trace keyed by \`(trip_id, ts)\`, needed for fare calculation, the
"share my trip" map, support disputes, and safety review. This is a perfect Cassandra/LSM workload: write-heavy,
append-only, time-ordered reads by partition key. At ~10–15K writes/sec per node, a few hundred nodes absorb the
trip-associated slice of the firehose. TTL the raw traces at ~30 days.

#### Cold: downsampled history (object storage / data lake)
After 30 days, keep 1-in-15 points (one per minute) compressed in Parquet on S3/GCS for ML training (ETA models,
demand forecasting) and compliance. That turns ~7 PB/year of raw pings into a few hundred TB: at S3 archive
prices, thousands not millions of dollars.

> The pattern generalizes: **retention should follow query value, not collection volume.** Nobody will ever ask
> "where exactly was driver 4711 at 14:32:07 nine months ago", so don't pay to be able to answer it.
`,
    },
    {
      type: 'text',
      title: 'Step 7: Surge pricing in brief',
      md: `
Surge is a control loop, not a money grab, and interviewers mostly want the systems view, so keep it tight:

- **Signal.** Per H3 res-7 cell (~5 km²), a streaming job over Kafka computes demand (open requests + app opens on
  the price screen) vs supply (idle drivers) over a sliding window, refreshing every **30–60 s**.
- **Multiplier.** Demand/supply ratio maps to a multiplier (1.0–3.0×, occasionally higher), **smoothed across
  neighboring cells** (hexagons shine here because all 6 neighbors are equidistant, so diffusion has no
  diagonal bias) and smoothed over time so prices don't flap every refresh.
- **Honoring the quote.** The multiplier is stamped into the fare quote and held for ~2 minutes (quote ID stored
  with its multiplier). The rider pays what they were shown even if surge ticks up before they confirm, because pricing
  surprises are a trust-killer.
- **Why it exists.** It's a feedback controller: higher prices suppress marginal demand and pull drivers toward hot
  cells, pushing the ratio back toward 1. Uber's data shows supply responding within ~10 minutes of a surge
  appearing.

Failure mode to mention: surge computed on stale supply data (a lagging consumer) overshoots, riders see 2.5× on a
calm Tuesday, and trust burns. Bound staleness: if the pipeline lags more than a couple of minutes, fail toward
1.0×, never toward higher multipliers.
`,
    },
    {
      type: 'beforeAfter',
      title: 'Case: naive lat/lng table vs geo-indexed lookup',
      scenario: {
        beforeTitle: 'Drivers table with lat/lng columns, distance scan',
        beforeDescription:
          'UPDATE drivers SET lat=?, lng=? per ping into Postgres, and matching runs a Haversine ORDER BY over every driver in the city. At 50K drivers each match scans the table in 2-4 s, write contention pins the DB at 100%, and the autovacuum daemon never catches up with 1M+ updates/sec of dead tuples.',
        afterTitle: 'H3-bucketed in-memory index + tiered storage',
        afterDescription:
          'Pings update a sharded in-memory cell index (latest position only, 15 s TTL) and stream to Kafka for trip traces in Cassandra. Matching reads ~7-19 cells and ranks ~100 candidates by ETA. Postgres only ever sees trip state transitions.',
        metrics: [
          { label: 'k-NN query latency', before: '2,000-4,000 ms (full scan)', after: '1-5 ms (cell lookup)', improved: true },
          { label: 'Sustainable write rate', before: '~20K updates/sec (one beefy Postgres)', after: '1.25M+ pings/sec (64 Redis shards)', improved: true },
          { label: 'Match completion p99', before: '45 s+, timeouts in dense cities', after: '< 15 s including driver accept', improved: true },
          { label: 'Location storage cost/year', before: '~7 PB in the primary DB', after: '~30 days Cassandra + ~300 TB Parquet', improved: true },
        ],
      },
    },
    {
      type: 'keyNumbers',
      title: 'Numbers to anchor the design',
      numbers: [
        { metric: 'Location write volume', value: '~1.25M pings/sec', context: '5M concurrent drivers ÷ 4 s update interval. The single number that shapes the architecture.' },
        { metric: 'H3 res 9 cell', value: '~0.1 km² (174 m edge)', context: 'Uber’s driver-bucketing resolution; res 7 (~5.2 km²) for surge zones. 16 resolutions total.' },
        { metric: 'Geohash precision 6', value: '~1.2 km × 0.6 km', context: 'What a 6-char geohash cell covers; Redis GEO uses a 52-bit geohash in a sorted set.' },
        { metric: 'Matching latency target', value: '< 30 s end-to-end', context: 'Candidate query in 1-5 ms; budget is dominated by the human: 10-15 s offer countdown × up to 3 re-offers.' },
        { metric: 'Cassandra write throughput', value: '~10-15K writes/sec/node', context: 'Why an append-only LSM store, not Postgres, absorbs trip traces.' },
        { metric: 'Hot state footprint', value: '~500 MB for 5M drivers', context: 'Latest-position-only at ~100 B/driver. Shard Redis for write QPS, not for memory.' },
        { metric: 'Trips per day (Uber, 2024)', value: '~26M', context: 'Only ~870 matches/sec at peak; trips are tiny load compared to location ingest.' },
      ],
    },
  ],
  quiz: [
    {
      question: 'At 5M concurrently active drivers sending a GPS ping every 4 seconds, what is the location write load?',
      options: ['~125K writes/sec', '~500K writes/sec', '~1.25M writes/sec', '~5M writes/sec'],
      answer: 2,
      explanation:
        '5,000,000 ÷ 4 = 1,250,000 writes/sec. This dwarfs the matching read load (~thousands of queries/sec), which is why the write path drives the design.',
    },
    {
      question: 'Why did Uber build H3 with hexagonal cells instead of using square-cell schemes?',
      options: [
        'Hexagons compress GPS coordinates into fewer bytes',
        'All 6 hexagon neighbors are equidistant from the center, removing the edge-vs-diagonal distance bias of squares',
        'Hexagons are the only shape that tiles a sphere without distortion',
        'Square grids cannot be sharded across machines',
      ],
      answer: 1,
      explanation:
        'A square cell has two neighbor distances (edge-adjacent vs diagonal), which biases neighbor-based smoothing and distance approximations. Hexagons have exactly one neighbor distance, which Uber wanted for surge smoothing and dispatch. (H3 still needs 12 pentagons to close the sphere; no tiling is distortion-free.)',
    },
    {
      question: 'A driver taps "accept" just as their 15-second Redis offer lock expires. How should the system decide the outcome?',
      options: [
        'Trust the Redis lock: the offer expired, so reject the accept',
        'Trust the phone: the driver tapped in time, so assign the trip',
        'Perform a conditional update on the trip row (state = offered AND offered_to = this driver); the database transition is the source of truth',
        'Re-run matching from scratch to be safe',
      ],
      answer: 2,
      explanation:
        'The lock is an optimization to prevent concurrent offers, not the source of truth. A compare-and-swap on the trip state resolves the race atomically: whoever transitions the row wins, and everyone else gets a clean failure.',
    },
    {
      question: 'What is the right retention strategy for raw driver GPS pings?',
      options: [
        'Latest position only in memory with a short TTL; trip traces in an LSM store for ~30 days; downsampled Parquet in object storage long-term',
        'Store all pings indefinitely in the trip database for auditability',
        'Keep everything in Kafka with infinite retention',
        'Discard all pings after the trip completes',
      ],
      answer: 0,
      explanation:
        'Retention should follow query value: matching needs only the latest position, support/fare disputes need ~30 days of traces, and ML needs downsampled history. Storing the raw firehose forever costs petabytes per year for queries nobody runs.',
    },
    {
      question: 'Why does the matching service rank candidates by predicted ETA rather than straight-line distance?',
      options: [
        'ETA is cheaper to compute than Haversine distance',
        'Straight-line distance ignores road topology: a driver 300 m away across a river or highway may be 10+ minutes from the pickup',
        'Distance ranking would require a quadtree, which cannot be sharded',
        'GPS coordinates are too inaccurate for distance calculations',
      ],
      answer: 1,
      explanation:
        'Geometry isn’t routing. The geo index produces a small candidate set cheaply; the routing/ETA service then ranks those ~100 candidates by actual drive time, which is what the rider experiences.',
    },
  ],
  interviewQuestions: [
    {
      question: 'Walk me through what happens, component by component, in the 30 seconds after a rider taps "Request ride".',
      hint: 'Gateway → matching → k-NN over H3 cells (1-5 ms) → ETA ranking → sequential offer/lock/timeout loop (10-15 s each) → transactional trip transition → push notifications to both apps. Show you know where the time actually goes: the human accept step, not the queries.',
      difficulty: 'Junior',
    },
    {
      question: 'How does your design change for UberPool, where one trip serves multiple riders with overlapping routes?',
      hint: 'Sequential greedy matching stops working, so you need windowed batch matching: hold requests for a few seconds, then solve a small assignment problem over candidate route overlaps. Discuss the latency-vs-efficiency trade and how trip state machines get more complex (multiple pickups, re-routing mid-trip).',
      difficulty: 'Senior',
    },
    {
      question: 'A whole region’s Redis geo cluster dies during evening peak. What happens to matching, and how do you degrade gracefully?',
      hint: 'TTL means the index can be rebuilt from the live ping stream in ~10-15 s. That’s the beauty of treating it as a cache, not a database. Cover: replaying from Kafka, refusing matches vs serving from a stale replica, and why drivers reappear automatically as pings flow.',
      difficulty: 'Senior',
    },
    {
      question: 'Your surge pricing pipeline lags 5 minutes behind real time during a concert letout. What goes wrong, and what guardrails do you add?',
      hint: 'Stale supply data → overshooting multipliers → rider trust damage, or undershooting → no driver incentive. Guardrails: staleness bounds on inputs (fail toward 1.0×), rate-of-change caps on multipliers, honoring quoted prices for ~2 minutes regardless of recomputation.',
      difficulty: 'Mid',
    },
  ],
  commonMistakes: [
    'Designing the read path first. Candidate lookup is ~3K QPS; ping ingest is 1.25M QPS. Interviewers watch whether you identify the write path as the bottleneck within the first ten minutes.',
    'Storing every GPS ping in the primary database "for history". That’s ~7 PB/year of dead weight and an autovacuum nightmare. Tier it: latest-only in memory, 30-day traces in Cassandra, downsampled Parquet after.',
    'Broadcasting ride offers to 10 drivers and taking the first accept. It feels lower-latency but trains drivers to ignore offers (most accepts get rejected). Sequential offer + short lock + timeout is the industry pattern.',
    'Treating the Redis driver lock as the source of truth for assignment. Locks expire and clocks skew; the transactional compare-and-swap on the trip row is what actually decides who got the trip.',
    'Ranking drivers by Haversine distance. Rivers, highways, and one-way streets make straight-line distance a bad proxy: geo index for candidates, routing-engine ETA for ranking.',
  ],
  cloudMappings: [
    { concept: 'Hot geo index (latest driver positions)', aws: 'ElastiCache for Redis (GEO commands)', gcp: 'Memorystore for Redis', azure: 'Azure Cache for Redis' },
    { concept: 'Ping/event streaming backbone', aws: 'MSK (Kafka) / Kinesis', gcp: 'Pub/Sub', azure: 'Event Hubs' },
    { concept: 'Trip state store (transactional)', aws: 'Aurora PostgreSQL', gcp: 'Cloud SQL / Spanner', azure: 'Azure Database for PostgreSQL' },
    { concept: 'Trip trace store (write-heavy, TTL)', aws: 'Keyspaces (Cassandra) / DynamoDB + TTL', gcp: 'Bigtable', azure: 'Cosmos DB (Cassandra API)' },
    { concept: 'Persistent connections at scale', aws: 'API Gateway WebSockets / NLB + self-managed', gcp: 'Cloud Run WebSockets / self-managed on GKE', azure: 'Azure SignalR Service / Web PubSub' },
    { concept: 'Cold location archive + ML training data', aws: 'S3 + Athena', gcp: 'GCS + BigQuery', azure: 'Blob Storage + Synapse' },
  ],
}

export default designUber
