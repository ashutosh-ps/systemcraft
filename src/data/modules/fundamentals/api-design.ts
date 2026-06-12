import type { Module } from '../../../lib/types'

const apiDesign: Module = {
  id: 'api-design',
  category: 'fundamentals',
  title: 'API Design & Rate Limiting',
  description:
    'Designing APIs that survive contact with real clients: resource modeling, versioning, cursor pagination, idempotency keys, REST vs GraphQL vs gRPC, gateways, and the four rate-limiting algorithms.',
  difficulty: 'Mid',
  estMinutes: 140,
  keywords: [
    'REST',
    'GraphQL',
    'gRPC',
    'rate limiting',
    'token bucket',
    'cursor pagination',
    'idempotency key',
    'API gateway',
  ],
  related: ['load-balancing', 'microservices', 'caching', 'design-notifications'],
  sections: [
    {
      type: 'text',
      title: 'APIs are contracts, and contracts are forever',
      md: `
An internal function you can refactor tomorrow. A public API endpoint, once a single paying customer integrates it,
is effectively immutable — Stripe still serves API versions from **2014**. So API design is the one place where
upfront care pays compounding interest.

REST's core discipline is **resource modeling**: expose *nouns*, manipulate them with HTTP verbs.

- \`GET /orders/4812\` — fetch. Safe, cacheable, idempotent.
- \`POST /orders\` — create. Not idempotent (the dangerous one — more below).
- \`PUT /orders/4812\` — full replace, idempotent. \`PATCH\` for partial update.
- \`DELETE /orders/4812\` — idempotent (deleting twice = deleted).

Anti-pattern: verbs in paths (\`POST /createOrder\`, \`GET /getOrderById\`). It works, but you lose the machinery
HTTP gives you for free — caching on GET, automatic retry safety on idempotent verbs, predictable semantics for
every proxy and SDK between client and server. Genuinely action-shaped operations get a sub-resource:
\`POST /orders/4812/cancel\` beats inventing a fake "cancellation" noun nobody asked for.

Model **relationships as paths** (\`GET /users/42/orders\`) but only one level deep — deeper nesting
(\`/users/42/orders/4812/items/3/discounts\`) couples your URL space to your data model and breaks the moment an
item belongs to two orders.

> Design test: can a competent engineer guess your endpoint for "list a customer's refunds" without reading docs?
> If yes, the API is consistent. Consistency beats cleverness everywhere in API design.
`,
    },
    {
      type: 'text',
      title: 'Versioning and pagination: the two things that age worst',
      md: `
#### Versioning

You will break compatibility eventually; decide *how* on day one. The pragmatic mainstream choice is the URL path
(\`/v2/orders\`) — ugly but unambiguous, visible in logs, trivially routable at the gateway. Header-based versioning
is cleaner in theory; Stripe's date-pinned versions (\`Stripe-Version: 2024-06-20\`, pinned per account) are the
gold standard but cost real engineering: they maintain transform layers between dozens of versions. Whatever you
pick: **additive changes** (new optional fields) should never need a new version, and clients must be told to
ignore unknown fields.

#### Pagination: offset vs cursor

\`GET /orders?offset=100000&limit=20\` has two scale-breaking flaws:

1. **The database does the work anyway.** \`OFFSET 100000\` makes Postgres walk and discard 100,000 rows — page 5,000 costs 200–800 ms while page 1 costs 2 ms. Latency grows linearly with page depth.
2. **It skips or duplicates under writes.** Insert one row while a client paginates and every subsequent page shifts by one — item 101 shows up twice, or never.

**Cursor pagination** fixes both: return an opaque token encoding the last-seen position
(\`?after=eyJpZCI6NDgxMn0\`), and query \`WHERE (created_at, id) < (cursor) ORDER BY created_at DESC, id DESC
LIMIT 20\`. That's an index seek — **~2 ms regardless of depth** — and stable under concurrent inserts. The cost:
no "jump to page 47". Slack, Stripe, and the GitHub GraphQL API all use cursors; offset survives only in admin UIs
over small tables.
`,
    },
    {
      type: 'text',
      title: 'Idempotency keys: making POST safe to retry',
      md: `
A client sends \`POST /payments\`, the response times out. Did the charge happen? The client can't know — the
timeout might have hit before the server saw the request, or after it processed but before the response arrived.
Retrying risks a double charge; not retrying risks a lost payment. This is the **two generals problem** wearing a
business suit, and it cannot be solved with cleverness on the client.

The fix is server-side: the client generates a UUID per *logical operation* and sends it as an
\`Idempotency-Key\` header. The server:

1. **First time it sees the key**: processes normally, then stores \`key → (status code, response body)\`.
2. **Retry with the same key**: skips processing entirely and **replays the stored response**, byte for byte.
3. **Same key, different request body**: rejects with \`422\` — that's a client bug, not a retry.

Stripe retains keys for **24 hours**; that window covers any sane retry policy while bounding storage. The store
needs to be fast and shared (Redis with TTL, or a DB table with a unique index — the unique index is what makes
the "first time" check race-free when two retries arrive concurrently).

Two details people miss in interviews:

- The key must map to the **operation**, not the request: "pay invoice 812" keeps one key across all retries, but a genuinely new payment gets a new key.
- Record the key **in the same transaction** as the side effect where possible. Store-then-process leaves a crash window where the key exists but the work never happened.
`,
    },
    {
      type: 'comparison',
      title: 'REST vs GraphQL vs gRPC',
      comparison: {
        columns: ['Criterion', 'REST', 'GraphQL', 'gRPC'],
        rows: [
          ['Wire format', 'JSON over HTTP/1.1 or 2', 'JSON over HTTP (single /graphql endpoint)', 'Protobuf over HTTP/2'],
          ['Payload size', 'Baseline', 'Smaller responses (client picks fields)', 'Protobuf ~3–10× smaller than JSON'],
          ['Latency', 'Fine; N+1 round trips for nested data', 'One round trip for complex reads', 'Lowest — binary + multiplexed HTTP/2; ~0.2–1 ms less per hop than JSON/REST'],
          ['Caching', 'Excellent — HTTP/CDN caching on GET for free', 'Hard — POST to one endpoint defeats HTTP caches', 'DIY — no HTTP cache semantics'],
          ['Typing & codegen', 'OpenAPI (bolted on, often drifts)', 'Strong schema, introspection', 'Strongest — .proto is the source of truth, codegen for 10+ languages'],
          ['Browser support', 'Universal', 'Universal', 'Needs gRPC-Web proxy'],
          ['Failure modes', 'Predictable, status codes', 'Resolver fan-out, unbounded query cost (needs depth/cost limits)', 'Tight coupling to schema discipline; debugging binary is harder'],
          ['Sweet spot', 'Public APIs, CRUD, anything cacheable', 'Mobile/web BFFs aggregating many sources', 'Internal service-to-service at scale'],
        ],
        verdict:
          'Default: REST for public APIs (caching + ubiquity), gRPC for internal east-west traffic (typed, fast), GraphQL only when diverse clients genuinely need flexible reads — and then budget for query-cost controls.',
      },
    },
    {
      type: 'text',
      title: 'The API gateway: one front door',
      md: `
With 40 microservices, you do not want 40 services each reimplementing auth, rate limits, and TLS. An **API
gateway** is the single entry point that handles **cross-cutting concerns** so services handle business logic:

- **Authentication**: terminate TLS, validate the JWT or API key once, pass identity downstream as trusted headers (e.g. \`X-User-Id\`). Services behind the gateway trust the gateway, not the client.
- **Rate limiting & quotas**: enforce per-key limits before traffic touches a service (next section).
- **Routing**: map \`/orders/*\` to the orders service, \`/v1/*\` to the legacy monolith mid-migration.
- **Shaping**: request/response transformation, compression, response caching for hot GETs.
- **Observability**: one chokepoint that logs every request with a trace ID — invaluable during incidents.

The cost is real but small: a well-run gateway (Envoy, Kong, AWS API Gateway, Cloudflare) adds **~1–10 ms** of
latency. AWS API Gateway charges **$1.00–3.50 per million requests** (HTTP vs REST flavor); at 1B requests/month
that's $1,000–3,500 — usually cheaper than the engineering time of doing auth five slightly-different ways.

Two failure modes to call out in interviews: the gateway becoming a **single point of failure** (run it as a
horizontally scaled, multi-AZ tier — it's stateless), and the gateway becoming a **dumping ground for business
logic** ("just add the discount calculation at the gateway…") — at which point you've rebuilt a monolith with
extra steps.
`,
    },
    {
      type: 'diagram',
      title: 'Request flow through the gateway',
      caption:
        'Authn → rate limit → route. Rejections happen as early and cheaply as possible — a 429 from the gateway costs microseconds of service capacity, not a database query.',
      diagram: {
        height: 440,
        nodes: [
          {
            id: 'clients',
            label: 'Clients',
            kind: 'client',
            x: 20,
            y: 190,
            detail:
              'Mobile, web, and third-party API consumers. Each request carries a bearer token or API key; well-behaved SDKs honor 429 + Retry-After with exponential backoff.',
          },
          {
            id: 'edge',
            label: 'Edge / WAF',
            kind: 'cdn',
            x: 200,
            y: 190,
            detail:
              'CDN edge + WAF absorbs the ugly stuff first: TLS termination ~50 µs, bot filtering, L7 DDoS rules. Cloudflare/CloudFront sit within ~10–50 ms of most users.',
          },
          {
            id: 'gateway',
            label: 'API Gateway',
            kind: 'lb',
            x: 390,
            y: 190,
            detail:
              'Stateless tier (Envoy/Kong/managed). Pipeline per request: validate auth (~0.1–1 ms with cached JWKS), check rate limit (~0.5 ms Redis round trip), then route. Total added latency ~1–10 ms.',
          },
          {
            id: 'auth',
            label: 'Auth Service',
            kind: 'service',
            x: 600,
            y: 50,
            detail:
              'Issues and rotates tokens. The gateway verifies JWT signatures locally against cached public keys, so this service is only on the hot path for opaque-token introspection or key rotation.',
          },
          {
            id: 'redis',
            label: 'Redis Counters',
            kind: 'cache',
            x: 600,
            y: 330,
            detail:
              'Shared token-bucket state keyed by API key. A single Redis node handles 100K+ ops/s at sub-millisecond latency; the bucket check is one atomic Lua script call.',
          },
          {
            id: 'orders',
            label: 'Orders Service',
            kind: 'service',
            x: 820,
            y: 120,
            w: 150,
            detail:
              'Receives only authenticated, rate-limited traffic with identity headers attached. Trusts X-User-Id because the network path from gateway is private (mTLS or VPC-internal).',
          },
          {
            id: 'users',
            label: 'Users Service',
            kind: 'service',
            x: 820,
            y: 280,
            w: 150,
            detail:
              'Same trust model. Per-route config at the gateway can give this service stricter limits (e.g. 10 req/s for expensive profile exports vs 500 req/s for reads).',
          },
        ],
        edges: [
          { from: 'clients', to: 'edge', label: 'HTTPS' },
          { from: 'edge', to: 'gateway', label: 'clean traffic' },
          { from: 'gateway', to: 'auth', label: 'key rotation', dashed: true },
          { from: 'gateway', to: 'redis', label: 'bucket check', dashed: true },
          { from: 'gateway', to: 'orders', label: 'route /orders' },
          { from: 'gateway', to: 'users', label: 'route /users' },
        ],
      },
    },
    {
      type: 'text',
      title: 'Rate limiting: why, and the four algorithms',
      md: `
Rate limiting protects three things: your **infrastructure** (one runaway script shouldn't brown-out the database
for everyone), **fairness** (10,000 free-tier users shouldn't be starved by one whale), and your **business model**
(tiered quotas are a product feature). GitHub allows **5,000 requests/hour** per authenticated user (15,000 for
GitHub Apps on Enterprise Cloud); unauthenticated calls get just 60/hour — a 83× difference that pushes everyone
toward identifiable, revocable credentials.

The four algorithms every interviewer expects:

- **Fixed window**: a counter per key per window ("100 req/min", reset at :00). Trivial — one \`INCR\` + \`EXPIRE\`. Flaw: the **boundary burst** — 100 requests at 0:59 and 100 more at 1:01 means 200 in two seconds, double your intended rate.
- **Sliding window log**: store a timestamp per request in a sorted set, count entries in the last 60 s. Perfectly accurate, but memory is O(requests) per key — at 1,000 req/min per key × 1M keys, you're storing a billion timestamps. Use only for low-volume, high-value limits.
- **Sliding window counter**: weighted blend of the previous and current fixed windows (\`prev × overlap% + curr\`). ~O(1) memory, smooths the boundary problem to within a few percent. Cloudflare's approach — a great default for HTTP APIs.
- **Token bucket**: a bucket holds up to \`burst\` tokens, refilling at \`rate\` tokens/sec; each request spends one. Allows short bursts (great UX for bursty-but-light clients) while capping the sustained rate. AWS API throttling and Stripe both use this model.
- **Leaky bucket** (honorable mention): requests drain at a perfectly constant rate, excess queues or drops. Ideal when the *downstream* needs smooth flow (e.g. calling a partner API with a hard contractual rate); rarely what you want for user-facing limits because it adds queueing delay.
`,
    },
    {
      type: 'comparison',
      title: 'Choosing a rate-limiting algorithm',
      comparison: {
        columns: ['Criterion', 'Fixed window', 'Sliding window counter', 'Sliding window log', 'Token bucket'],
        rows: [
          ['Memory per key', 'O(1) — one counter', 'O(1) — two counters', 'O(N) — timestamp per request', 'O(1) — tokens + timestamp'],
          ['Accuracy', 'Poor at boundaries (2× burst)', 'Within a few % of true rate', 'Exact', 'Exact for its model'],
          ['Allows controlled bursts', 'Accidentally (the flaw)', 'No', 'No', 'Yes — by design (bucket size)'],
          ['Implementation', 'INCR + EXPIRE, 5 lines', 'Two counters + weighting', 'Sorted set ops per request', 'Small Lua script, lazy refill'],
          ['Used by', 'Quick internal guards', 'Cloudflare', 'Precise paid quotas, login throttling', 'Stripe, AWS throttling'],
        ],
        verdict:
          'Token bucket is the best default: O(1) memory, exact sustained-rate enforcement, and burst tolerance is an explicit, tunable parameter instead of a bug.',
      },
    },
    {
      type: 'code',
      title: 'Token bucket on Redis (atomic via Lua)',
      language: 'python',
      code: `
# Token bucket: capacity = burst size, refill_rate = sustained req/sec.
# State per key: (tokens, last_refill_ts). Refill is computed lazily on
# each request — no background timers, no cron.
#
# The whole check-and-spend MUST be atomic, or two gateway nodes racing
# on the same key will both see 1 token and both admit. Redis Lua scripts
# execute atomically, so the race disappears.

TOKEN_BUCKET_LUA = """
local tokens_key = KEYS[1]
local rate     = tonumber(ARGV[1])   -- tokens per second
local capacity = tonumber(ARGV[2])   -- max burst
local now      = tonumber(ARGV[3])   -- current time (seconds, float)

local state  = redis.call('HMGET', tokens_key, 'tokens', 'ts')
local tokens = tonumber(state[1]) or capacity
local ts     = tonumber(state[2]) or now

-- Lazy refill: add rate * elapsed, capped at capacity
tokens = math.min(capacity, tokens + (now - ts) * rate)

local allowed = tokens >= 1
if allowed then tokens = tokens - 1 end

redis.call('HMSET', tokens_key, 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', tokens_key, math.ceil(capacity / rate) * 2)
return { allowed and 1 or 0, tokens }
"""

def check_rate_limit(api_key, rate=100, capacity=200):
    # 100 req/s sustained, bursts up to 200. One Redis round trip: ~0.5 ms.
    allowed, remaining = redis.eval(
        TOKEN_BUCKET_LUA, 1, "rl:" + api_key, rate, capacity, time.time())

    if not allowed:
        # 429 with honest headers — well-behaved clients back off,
        # which actively reduces load instead of just deflecting it.
        raise TooManyRequests(headers={
            "Retry-After": "1",
            "X-RateLimit-Limit": str(rate),
            "X-RateLimit-Remaining": str(int(remaining)),
        })
`,
    },
    {
      type: 'text',
      title: 'Status code discipline (and the 429 contract)',
      md: `
Status codes are an API's body language — clients (and their retry libraries) make automated decisions on them, so
sloppiness here causes real outages.

- **2xx**: success. \`201 Created\` (+ \`Location\` header) for creation, \`202 Accepted\` for async work, \`204 No Content\` for deletes.
- **4xx — the client must change something before retrying**: \`400\` malformed, \`401\` who are you, \`403\` you specifically may not, \`404\` no such resource, \`409\` version/state conflict, \`422\` understood-but-invalid.
- **5xx — the server failed; retrying may help**: \`500\` bug, \`502/504\` upstream dead or slow, \`503\` overloaded.

The cardinal sin is **\`200\` with \`{"error": ...}\` in the body**. Every cache, monitor, retry policy, and load
balancer in the chain now believes the request succeeded. Your error rate dashboard reads 0% during a total outage.

**\`429 Too Many Requests\`** deserves special care because it's a *protocol*, not just a rejection:

- Send \`Retry-After: 30\` (seconds) — compliant clients and SDKs sleep exactly that long instead of hammering you in a tight loop. During an overload event, this header is load-shedding that *cooperates with* the client.
- Send \`X-RateLimit-Limit / -Remaining / -Reset\` on **every** response, not just 429s, so clients can self-throttle before hitting the wall. GitHub and Stripe both do this.
- Never disguise rate limiting as \`503\` — clients treat 503 as "server broken, fail over," which can cascade a local throttle into a client-side incident.

> One more: \`429\` is per-client misbehavior; \`503\` + \`Retry-After\` is global overload. Using the right one tells
> clients whether *they* are the problem.
`,
    },
    {
      type: 'keyNumbers',
      title: 'Numbers to anchor your answers',
      numbers: [
        { metric: 'GitHub API rate limit', value: '5,000 req/h', context: 'Per authenticated user; 60/h unauthenticated. The canonical public-API quota example.' },
        { metric: 'Stripe idempotency-key TTL', value: '24 hours', context: 'Stored response replayed byte-for-byte on retry within the window.' },
        { metric: 'Gateway added latency', value: '~1–10 ms', context: 'Auth check + rate limit + route. Budget for it in your latency math.' },
        { metric: 'Protobuf vs JSON payload', value: '~3–10× smaller', context: 'Binary encoding, no field names on the wire. Parsing is ~2–5× faster too.' },
        { metric: 'Redis rate-limit check', value: '~0.5 ms', context: 'One Lua-script round trip; 100K+ checks/s per node.' },
        { metric: 'Offset pagination at depth', value: '200–800 ms @ page 5000', context: 'vs ~2 ms for cursor at any depth — the reason cursors win at scale.' },
        { metric: 'AWS API Gateway cost', value: '$1.00–3.50/M req', context: 'HTTP API vs REST API tiers; 1B req/month ≈ $1,000–3,500.' },
      ],
    },
  ],
  quiz: [
    {
      question: 'Why does cursor pagination beat offset pagination on a table with heavy concurrent writes?',
      options: [
        'Cursors compress the response payload',
        'Offset requires the client to track page numbers',
        'Cursors let the client jump to an arbitrary page faster',
        'A cursor seeks directly via an index and stays stable when rows are inserted; OFFSET re-scans skipped rows and shifts under writes',
      ],
      answer: 3,
      explanation:
        'OFFSET N walks and discards N rows (latency grows with depth) and any insert shifts subsequent pages, duplicating or skipping items. A keyset cursor is an index seek — constant time, stable ordering. The trade-off: cursors can\'t jump to page 47.',
    },
    {
      question: 'A POST /payments request times out at the client. With idempotency keys implemented correctly, the client should…',
      options: [
        'Retry with the same Idempotency-Key; the server replays the original outcome if it already processed',
        'Retry with a fresh key to avoid a 422 conflict',
        'Switch to GET to check, since GET is safe',
        'Never retry POSTs — they are inherently unsafe',
      ],
      answer: 0,
      explanation:
        'Same logical operation = same key. If the first attempt succeeded server-side, the retry gets the stored response instead of a duplicate charge. A fresh key would make the retry a brand-new payment — the exact bug the mechanism exists to prevent.',
    },
    {
      question: 'Your fixed-window limit is 100 req/min. What worst-case burst can a client legally push in ~2 seconds?',
      options: ['100 requests', '200 requests — 100 at the end of one window, 100 at the start of the next', '150 requests', '120 requests with jitter'],
      answer: 1,
      explanation:
        'Counters reset at the window boundary, so a client can spend a full quota just before reset and another just after. This boundary-burst flaw is what sliding-window and token-bucket algorithms fix.',
    },
    {
      question: 'Which is the strongest reason to use gRPC instead of REST for internal service-to-service calls?',
      options: [
        'gRPC responses are easier to cache at the CDN',
        'gRPC works natively in every browser',
        'Protobuf + HTTP/2 cut payload size ~3–10× and per-hop latency, and the .proto schema gives typed, code-generated clients',
        'gRPC removes the need for retries and timeouts',
      ],
      answer: 2,
      explanation:
        'Internally you control both ends, so binary encoding, multiplexed HTTP/2 connections, and strict schemas pay off on every hop. The browser and caching stories are gRPC\'s weaknesses, not strengths — which is why it stays east-west.',
    },
    {
      question: 'During an overload event your API starts rejecting requests. Which response actively helps reduce the incoming load?',
      options: [
        '503 with an HTML error page',
        '200 with {"status": "throttled"} in the body',
        'Silently dropping connections',
        '429 with a Retry-After header set to the backoff you want',
      ],
      answer: 3,
      explanation:
        'Compliant clients and SDKs sleep for Retry-After seconds, turning your rejection into coordinated client-side backoff. A 200 makes retry logic think everything is fine; dropped connections trigger immediate aggressive retries — the opposite of what you need.',
    },
  ],
  interviewQuestions: [
    {
      question: 'Design the REST API for a ride-sharing app: riders request rides, drivers accept them, both view history.',
      hint: 'Show resource modeling: POST /rides (with Idempotency-Key — double-booking is the disaster case), GET /rides/{id}, POST /rides/{id}/accept as a state transition, GET /riders/{id}/rides with cursor pagination. Discuss status codes (409 when two drivers accept), versioning strategy, and what stays out of the URL (auth identity from the token, not the path).',
      difficulty: 'Junior',
    },
    {
      question: 'Design rate limiting for a public API with free (100 req/h) and paid (10,000 req/h) tiers across 20 gateway nodes.',
      hint: 'Expected structure: token bucket per API key with tier-based rate/capacity; shared Redis (or Redis Cluster) for state with an atomic Lua check; discuss the local-cache-plus-sync optimization for hot keys; 429 + Retry-After + X-RateLimit-* headers; failure mode — if Redis is down, fail open for availability or fail closed for protection, and defend the choice.',
      difficulty: 'Mid',
    },
    {
      question: 'Your mobile app makes 11 REST calls to render the home screen, hurting time-to-interactive on 3G. Options?',
      hint: 'Compare: a BFF (backend-for-frontend) endpoint that aggregates server-side; GraphQL for client-declared queries (mention query-cost limits and the caching loss); response compounding/HTTP/2 multiplexing as a cheaper fix. Strong answers quantify: 11 sequential RTTs at ~200 ms on 3G is >2 s of pure network, so server-side aggregation in one RTT wins regardless of protocol.',
      difficulty: 'Mid',
    },
    {
      question: 'Walk me through deprecating a field in a public API used by 50,000 integrations without breaking them.',
      hint: 'Structure: never remove in-place — additive replacement first, dual-write/dual-read period; deprecation headers (Sunset, Deprecation) and changelog; usage telemetry per API key to find and contact stragglers; version-pinning (Stripe model) so old clients keep old behavior; brownouts (temporary deliberate failures) as a last-mile nudge before the hard cutoff.',
      difficulty: 'Senior',
    },
  ],
  commonMistakes: [
    'Returning 200 with an error in the body. Every retry policy, cache, and uptime monitor between you and the client now believes the request succeeded — your dashboards show green during an outage.',
    'Offset pagination on a large, hot table. Page-depth latency grows linearly and concurrent inserts duplicate or skip rows; switching to cursors later breaks every integrator\'s pagination loop, so start with cursors.',
    'Implementing rate limiting with a non-atomic read-then-write (GET, check, SET). Two gateway nodes race, both admit, and your limit silently enforces ~2× the configured rate under load. Use an atomic Lua script or INCR.',
    'Treating idempotency keys as request hashes. The key must identify the logical operation chosen by the client — hashing the body makes "buy this twice on purpose" impossible and "retry after timeout" unsafe if any field (like a timestamp) changed.',
    'Designing the gateway as a business-logic layer. Discount rules and order validation creep in "because it\'s convenient," and you\'ve rebuilt a monolith that every team deploys through.',
  ],
  cloudMappings: [
    { concept: 'Managed API gateway', aws: 'API Gateway / ALB', gcp: 'API Gateway / Apigee', azure: 'API Management' },
    { concept: 'Rate limiting / quotas', aws: 'API Gateway usage plans + throttling', gcp: 'Apigee quota policies / Cloud Armor', azure: 'APIM rate-limit & quota policies' },
    { concept: 'Shared counter store (token buckets)', aws: 'ElastiCache (Redis)', gcp: 'Memorystore', azure: 'Azure Cache for Redis' },
    { concept: 'Auth / token issuance', aws: 'Cognito / IAM', gcp: 'Identity Platform / Firebase Auth', azure: 'Entra ID (Azure AD B2C)' },
    { concept: 'Managed gRPC load balancing', aws: 'ALB (HTTP/2) / App Mesh', gcp: 'Cloud Load Balancing (native gRPC)', azure: 'Application Gateway (HTTP/2)' },
    { concept: 'Edge WAF / DDoS in front of APIs', aws: 'CloudFront + AWS WAF + Shield', gcp: 'Cloud Armor + Cloud CDN', azure: 'Front Door + Azure WAF' },
  ],
}

export default apiDesign
