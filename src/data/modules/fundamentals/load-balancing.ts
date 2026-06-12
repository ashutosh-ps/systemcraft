import type { Module } from '../../../lib/types'

const loadBalancing: Module = {
  id: 'load-balancing',
  category: 'fundamentals',
  title: 'Load Balancing & DNS',
  description:
    'How one hostname fans out to thousands of servers. L4 vs L7 balancing, the algorithms that pick a backend, DNS resolution and GeoDNS, health checks, and failover that actually works.',
  difficulty: 'Junior',
  estMinutes: 110,
  keywords: ['L4 vs L7', 'round robin', 'consistent hashing', 'health checks', 'DNS TTL', 'anycast', 'sticky sessions', 'ALB'],
  related: ['scalability', 'cdn-edge', 'api-design', 'microservices'],
  sections: [
    {
      type: 'text',
      title: 'Why one IP must hide many servers',
      md: `
The moment you have a second app server you have a routing problem: clients know one hostname, but capacity lives on
many machines. The **load balancer (LB)** is the component that owns the public address and spreads requests across a
backend pool. It is doing three jobs at once:

- **Distribution** — pick a backend per request (or per connection) so no node melts while others idle.
- **Health** — probe backends every few seconds and stop sending traffic to dead ones *before* users notice.
- **Indirection** — backends can be added, drained, patched, and replaced without clients ever knowing. This is what makes autoscaling and zero-downtime deploys possible at all.

The economics are absurdly good. An AWS Application Load Balancer costs about **$16/month base (~$0.0225/hour) plus
$0.008 per LCU-hour** — typically **$20–50/month** for a mid-size service — and removes the single point of failure
that one app server represents. A Network Load Balancer handles **millions of requests per second** while adding on
the order of **100 µs** of latency; an ALB adds roughly **1–10 ms** because it terminates TLS and parses HTTP.

> Interview tip: when you draw an LB, immediately say *which layer it operates at* and *which algorithm it uses*.
> "A load balancer" is a hand-wave; "an L7 LB doing least-connections with 10-second health checks" is a design.
`,
    },
    {
      type: 'text',
      title: 'L4 vs L7: what the balancer can see',
      md: `
The single most important classification is which OSI layer the LB understands.

#### Layer 4 (transport)

An L4 balancer sees only **IP addresses and TCP/UDP ports**. It forwards packets — often without terminating the
connection — using NAT or direct server return. Because it never parses the payload, it is brutally fast: AWS NLB and
HAProxy in TCP mode add **~100 µs or less** and a single HAProxy box can hold **~2 million concurrent connections**.
The cost: it cannot route by URL, host header, or cookie, because it literally cannot see them. TLS passes through
encrypted.

#### Layer 7 (application)

An L7 balancer **terminates the TCP connection and usually TLS**, parses the HTTP request, then opens (or reuses) a
connection to a backend. Now it can do the useful stuff:

- Path-based routing: \`/api/*\` to the API pool, \`/static/*\` to nginx.
- Host-based routing: one ALB fronting 50 microservices.
- Cookie-based sticky sessions, header rewrites, gRPC and WebSocket awareness.
- Request-level retries and per-route timeouts.

The price is **1–10 ms added latency**, higher CPU cost (TLS handshakes are expensive — ~1 ms of CPU per full
handshake even with modern ciphers), and the LB becoming a more complex failure domain.

Real systems commonly stack them: **NLB (L4) → Envoy/ALB (L7) → services**. The L4 tier gives you a stable, cheap,
fast entry point; the L7 tier gives you routing intelligence.
`,
    },
    {
      type: 'comparison',
      title: 'Design decision: L4 or L7?',
      comparison: {
        columns: ['Criterion', 'L4 (transport)', 'L7 (application)'],
        rows: [
          ['What it sees', 'IPs, ports, TCP/UDP flags', 'Full HTTP: paths, headers, cookies, gRPC methods'],
          ['Added latency', '~100 µs (NLB, HAProxy TCP mode)', '~1–10 ms (TLS termination + HTTP parsing)'],
          ['Throughput ceiling', 'Millions of QPS, tens of Gbps per node', 'High but CPU-bound; scales out with more nodes'],
          ['Routing rules', 'Per-connection only (5-tuple hash)', 'Per-request: path, host, header, weight, canary'],
          ['TLS', 'Pass-through (backend decrypts)', 'Terminates TLS; can re-encrypt to backend'],
          ['Client IP', 'Preserved natively', 'Lost unless forwarded via X-Forwarded-For / proxy protocol'],
          ['Typical products', 'AWS NLB, HAProxy TCP, IPVS, Maglev', 'AWS ALB, nginx, Envoy, HAProxy HTTP'],
        ],
        verdict:
          'Default to L7 for web/API traffic — the routing features pay for the milliseconds. Use L4 when you need raw TCP/UDP, extreme throughput, or sub-millisecond overhead (databases, game servers, the entry tier in front of an L7 fleet).',
      },
    },
    {
      type: 'text',
      title: 'The algorithms: how a backend gets picked',
      md: `
#### Round-robin (and weighted round-robin)

Backend 1, 2, 3, 1, 2, 3… Dead simple, zero state, and the default everywhere. Weighted variants send a 16-core box
2× the traffic of an 8-core box. Weakness: it assumes requests cost the same. One slow request (a 5-second report)
counts the same as a 5 ms health ping, so a backend can be drowning while still receiving its "fair" share.

#### Least-connections

Send the next request to the backend with the fewest in-flight connections. This self-corrects for uneven request
cost — slow backends accumulate connections and automatically receive less traffic. It is the right default for
APIs with variable latency. The popular refinement is **power of two choices**: pick two backends at random, send to
the less loaded one — nearly as good as global least-connections with none of the coordination cost (this is what
Envoy and NGINX Plus implement).

#### IP hash

\`hash(client_ip) % N\` pins each client to one backend. Crude session affinity with no cookies — but adding or
removing a single backend reshuffles **almost every client**, and NAT'd offices (thousands of users behind one IP)
become hot spots.

#### Consistent hashing

Place backends on a hash ring; a key (user ID, cache key) maps to the next node clockwise. When a node joins or
leaves, only **~K/N of keys move** (K keys, N nodes) instead of nearly all of them. With **100–200 virtual nodes**
per physical node the load spread evens to within a few percent. This is how cache tiers, Cassandra, and DynamoDB
route — and a perennial interview favorite.
`,
    },
    {
      type: 'code',
      title: 'Consistent hashing in ~30 lines',
      language: 'python',
      code: `
import hashlib
import bisect

class ConsistentHashRing:
    """Each physical node gets VNODES points on the ring.
    Adding/removing a node only remaps ~1/N of the keyspace,
    vs ~100% remapped with naive hash(key) % N."""

    VNODES = 150  # 100-200 vnodes keeps load within ~5% of even

    def __init__(self, nodes):
        self.ring = []          # sorted list of (hash, node)
        for node in nodes:
            self.add_node(node)

    def _hash(self, key: str) -> int:
        return int(hashlib.md5(key.encode()).hexdigest(), 16)

    def add_node(self, node: str):
        for i in range(self.VNODES):
            h = self._hash(node + "#" + str(i))
            bisect.insort(self.ring, (h, node))

    def remove_node(self, node: str):
        self.ring = [(h, n) for (h, n) in self.ring if n != node]

    def get_node(self, key: str) -> str:
        h = self._hash(key)
        idx = bisect.bisect(self.ring, (h, ""))   # first point >= h
        if idx == len(self.ring):                  # wrap around
            idx = 0
        return self.ring[idx][1]

# ring = ConsistentHashRing(["cache-1", "cache-2", "cache-3"])
# ring.get_node("user:42")  -> "cache-2" (stable until topology changes)
# ring.add_node("cache-4")  -> only ~25% of keys remap, not ~100%
`,
    },
    {
      type: 'diagram',
      title: 'From hostname to backend: the full request path',
      caption:
        'DNS resolves the hostname to the load balancer; the LB health-checks and distributes across the app pool, with a standby ready to take over.',
      diagram: {
        height: 420,
        nodes: [
          { id: 'client', label: 'Client', kind: 'client', x: 20, y: 210, detail: 'Resolves api.example.com once per TTL, then connects straight to the LB IP. A warm client skips DNS entirely — resolution only costs 20–120 ms on a cold cache.' },
          { id: 'resolver', label: 'DNS Resolver', kind: 'external', x: 220, y: 60, detail: 'The ISP or public resolver (1.1.1.1, 8.8.8.8). Caches answers for the record TTL. Anycast routing means the "one" IP is actually hundreds of sites worldwide, answering in ~10–20 ms.' },
          { id: 'geodns', label: 'Route 53 GeoDNS', kind: 'external', x: 440, y: 60, detail: 'Authoritative nameserver. Returns different LB IPs by client geography and health — latency-based routing typically saves 50–150 ms for cross-continent users. Route 53 offers a 100% availability SLA at $0.40 per million queries.' },
          { id: 'lb-a', label: 'ALB (active)', kind: 'lb', x: 440, y: 210, detail: 'L7 balancer: terminates TLS, routes by path/host, runs least-connections. Adds ~1–10 ms. Internally AWS runs a fleet of LB nodes per AZ behind the DNS name and scales them with your traffic.' },
          { id: 'lb-b', label: 'ALB (standby)', kind: 'lb', x: 440, y: 330, detail: 'Failover pair in another AZ. With managed ELB this is implicit — nodes in every enabled AZ share the work. Self-hosted HAProxy pairs use a floating VIP via keepalived/VRRP; failover takes ~1–3 seconds.' },
          { id: 'app1', label: 'App Server 1', kind: 'server', x: 700, y: 100, detail: 'Health-checked every 10 s on /healthz; 2 consecutive failures ejects it from the pool, so detection takes 20–30 s. Handles ~1,000 QPS of business logic on 8 cores.' },
          { id: 'app2', label: 'App Server 2', kind: 'server', x: 700, y: 210, detail: 'Identical stateless clone. During deploys the LB drains it: stop new requests, wait up to 300 s for in-flight ones, then swap the binary. Users see nothing.' },
          { id: 'app3', label: 'App Server N', kind: 'server', x: 700, y: 320, detail: 'Autoscaling adds clones at ~70% CPU. Because the LB discovers targets dynamically, a new node takes traffic within one health-check cycle (~30 s of launch).' },
        ],
        edges: [
          { from: 'client', to: 'resolver', label: '1. resolve' },
          { from: 'resolver', to: 'geodns', label: '2. authoritative' },
          { from: 'client', to: 'lb-a', label: '3. HTTPS' },
          { from: 'geodns', to: 'lb-a', label: 'health check', dashed: true },
          { from: 'lb-a', to: 'lb-b', label: 'failover', dashed: true },
          { from: 'lb-a', to: 'app1', label: 'least-conn' },
          { from: 'lb-a', to: 'app2' },
          { from: 'lb-a', to: 'app3' },
        ],
      },
    },
    {
      type: 'text',
      title: 'DNS: the load balancer before the load balancer',
      md: `
Before any packet reaches your LB, DNS already made a routing decision. The cold-cache resolution walk —
root servers → \`.com\` TLD servers → your authoritative nameserver — costs **20–120 ms**, which is why every layer
caches aggressively, governed by the record's **TTL**.

#### The TTL trade-off

- **Long TTL (24 h)**: cheap (fewer queries to pay for) and fast (always cached) — but a failover requires the world's resolvers to expire their cache. A 24 h TTL can mean *a day* of traffic going to a dead IP.
- **Short TTL (30–60 s)**: failover propagates in about a minute, at the cost of more lookups. This is the standard for anything fronting production traffic. Caveat: some resolvers and OSes ignore very low TTLs and clamp them upward, so DNS failover is never *instant* — treat it as a minutes-scale tool, not a seconds-scale one.

#### GeoDNS and latency-based routing

Authoritative servers like Route 53 answer **differently per client location**: EU users get the Frankfurt LB, US
users get Virginia. Combined with health checks, this gives you region-level failover — if Frankfurt's health check
fails, EU users transparently resolve to Virginia and pay ~90 ms extra instead of getting connection refused.

#### Anycast

The heavier-duty alternative: advertise the **same IP from many sites via BGP**, and internet routing delivers each
packet to the topologically nearest one. No TTL problem at all — when a site dies, routes withdraw in seconds and
traffic shifts automatically. This is how Cloudflare's 1.1.1.1, Google's 8.8.8.8, and every serious CDN edge work.
The catch: long-lived TCP connections can break when routes shift, so anycast suits DNS/CDN front doors better than
stateful APIs.
`,
    },
    {
      type: 'text',
      title: 'Health checks, sticky sessions, and failover',
      md: `
#### Health checks: the LB's eyes

A typical config: probe \`GET /healthz\` every **10 s**, mark unhealthy after **2–3 consecutive failures**, healthy
again after 2–3 successes. That means worst-case **20–30 s of errors** before a dead node is ejected — tighten the
interval for faster detection, but beware flapping: a GC pause or deploy blip shouldn't eject half your fleet. Make
the endpoint *shallow* (process up, can reach its dependencies) rather than running real queries, or the health check
itself becomes load.

#### Sticky sessions: useful, dangerous

L7 stickiness (e.g. an LB-issued cookie) pins a user to one backend. It papers over in-memory session state — and
that's exactly the problem: load skews toward old nodes, autoscaling barely helps (new nodes only get *new* users),
and when a sticky node dies, every user pinned to it gets logged out at once. The grown-up fix is a **stateless tier
with sessions in Redis or JWTs**; reserve stickiness for things that genuinely need connection affinity, like
WebSockets or server-side caches warmed per user.

#### Who balances the balancer?

The LB must not be the new single point of failure. Self-hosted pattern: an **active-passive HAProxy pair** sharing a
floating virtual IP via VRRP/keepalived — the standby detects missed heartbeats and claims the VIP in **~1–3
seconds**. Managed pattern: AWS ELB is *itself a distributed system* — a fleet of LB nodes across your enabled AZs,
fronted by a DNS name with a **60 s TTL** that always resolves to healthy nodes (this is why AWS tells you to use the
DNS name, never a resolved IP). NLB goes further with a single static IP per AZ implemented on the anycast-style
Hyperplane fabric.
`,
    },
    {
      type: 'keyNumbers',
      title: 'Numbers worth memorizing',
      numbers: [
        { metric: 'NLB added latency', value: '~100 µs', context: 'L4 pass-through; handles millions of QPS without pre-warming.' },
        { metric: 'ALB added latency', value: '~1–10 ms', context: 'TLS termination + HTTP parsing buys you L7 routing.' },
        { metric: 'ALB cost', value: '~$20/mo + LCU', context: '$0.0225/hr base + $0.008/LCU-hr; mid-size services land at $20–50/month.' },
        { metric: 'Cold DNS lookup', value: '20–120 ms', context: 'Root → TLD → authoritative walk. Cached lookups are ~0–10 ms.' },
        { metric: 'Production DNS TTL', value: '60 s', context: 'Short enough for minutes-scale failover; some resolvers clamp lower values.' },
        { metric: 'Health check detection', value: '20–30 s', context: '10 s interval × 2–3 failure threshold — plan deploys and failover around it.' },
        { metric: 'Consistent hashing remap', value: '~K/N keys', context: 'Adding the 10th node moves ~10% of keys; naive modulo moves ~90%.' },
      ],
    },
  ],
  quiz: [
    {
      question: 'You need to balance raw TCP traffic to a fleet of game servers at 2M QPS with minimal added latency. Which option fits best?',
      options: [
        'An L7 ALB with path-based routing',
        'DNS round-robin with a 24-hour TTL',
        'An L4 NLB (or HAProxy in TCP mode)',
        'Sticky sessions on an nginx HTTP proxy',
      ],
      answer: 2,
      explanation:
        'L4 balancers forward at the connection level without parsing payloads — ~100 µs overhead and millions of QPS. L7 features are useless for a non-HTTP protocol and cost milliseconds.',
    },
    {
      question: 'A cache cluster grows from 4 to 5 nodes. With consistent hashing (vs naive modulo), roughly what fraction of keys remap?',
      options: ['~20% instead of ~80%', '~50% either way', '0% — keys never move', '~80% instead of ~20%'],
      answer: 0,
      explanation:
        'Consistent hashing moves ~K/N keys (1/5 = 20% here). Naive hash(key) % N reshuffles almost everything — 4/5 of keys land on a different node — which would stampede the database behind the cache.',
    },
    {
      question: 'What is the main operational downside of cookie-based sticky sessions?',
      options: [
        'They require TLS pass-through, so the LB cannot terminate HTTPS',
        'Load skews and a node failure logs out every user pinned to it',
        'They only work with UDP traffic',
        'They double DNS query volume',
      ],
      answer: 1,
      explanation:
        'Stickiness concentrates users on long-lived nodes (new nodes only receive new sessions) and turns one node\'s death into a mass logout. Externalizing session state to Redis/JWTs removes the need entirely.',
    },
    {
      question: 'Why not set every DNS record\'s TTL to 5 seconds for instant failover?',
      options: [
        'DNS protocol forbids TTLs under 60 seconds',
        'Low TTLs break GeoDNS routing',
        'It would make anycast stop working',
        'Query volume/cost rises and many resolvers clamp tiny TTLs anyway, so failover still is not instant',
      ],
      answer: 3,
      explanation:
        'Short TTLs multiply authoritative query load (and bills), and resolvers/OS caches often enforce minimums — so you pay the cost without getting true seconds-level failover. 30–60 s is the practical floor.',
    },
    {
      question: 'Which routing decision can ONLY an L7 load balancer make?',
      options: [
        'Send /api/* requests to the API pool and /static/* to the asset pool',
        'Distribute TCP connections round-robin across backends',
        'Hash the client IP to pick a backend',
        'Eject a backend that fails TCP health checks',
      ],
      answer: 0,
      explanation:
        'Path-based routing requires parsing the HTTP request line, which only exists after the LB terminates the connection at layer 7. The other three work with nothing but IPs and ports.',
    },
  ],
  interviewQuestions: [
    {
      question: 'A client types api.example.com and hits one of 50 app servers. Walk through every step in between.',
      hint: 'Expected flow: browser/OS DNS cache → recursive resolver → root/TLD/authoritative (mention TTL caching) → GeoDNS picks a region → TCP + TLS to the LB → L7 routing + least-connections picks a healthy backend (health-check mechanics) → response. Bonus points for latency at each hop.',
      difficulty: 'Junior',
    },
    {
      question: 'Your single HAProxy node is now the single point of failure. Design LB redundancy, self-hosted and in AWS.',
      hint: 'Self-hosted: active-passive pair, floating VIP with keepalived/VRRP, ~1–3 s takeover, plus the split-brain risk. AWS: explain that ELB is already a multi-AZ fleet behind a DNS name — use the DNS name, enable cross-zone balancing, and add Route 53 health checks for region-level failover.',
      difficulty: 'Mid',
    },
    {
      question: 'When would you choose consistent hashing over least-connections, and what problem do virtual nodes solve?',
      hint: 'Consistent hashing when requests must land on the node holding their data (cache tiers, stateful shards) — affinity beats even load. Least-connections when backends are interchangeable. Vnodes (100–200 per node) fix the lumpy key distribution of few ring points and let heterogeneous nodes take proportional load.',
      difficulty: 'Mid',
    },
    {
      question: 'Design global traffic routing for a service in 3 regions: normal operation, one region failing, and a full region evacuation.',
      hint: 'Layered answer: GeoDNS/latency-based routing with 60 s TTLs and health checks for steady state; anycast front door (or Global Accelerator) for faster failover than DNS allows; weighted records to drain a region gradually; discuss the capacity question — surviving regions need headroom for ~50% more traffic (N+1 across regions).',
      difficulty: 'Senior',
    },
  ],
  commonMistakes: [
    'Drawing a load balancer as a magic box without saying L4 or L7. The layer determines what routing is even possible — and interviewers ask precisely that follow-up.',
    'Using sticky sessions to avoid externalizing session state. You inherit skewed load, useless autoscaling, and mass logouts on node failure — Redis-backed sessions cost an afternoon and remove the whole class of problems.',
    'Forgetting the LB itself can fail. One nginx box in front of ten app servers has just moved the single point of failure, not removed it.',
    'Treating DNS failover as instant. Between TTL caching and resolvers clamping low TTLs, DNS-level changes take minutes to propagate — design failover at the LB/anycast layer when seconds matter.',
    'Hashing by client IP for session affinity and then wondering why one backend melts — corporate NATs put thousands of users behind a single IP.',
  ],
  cloudMappings: [
    { concept: 'L7 load balancer', aws: 'Application Load Balancer (ALB)', gcp: 'Global External Application LB', azure: 'Application Gateway' },
    { concept: 'L4 load balancer', aws: 'Network Load Balancer (NLB)', gcp: 'External Network LB', azure: 'Azure Load Balancer' },
    { concept: 'Managed DNS + GeoDNS', aws: 'Route 53 (geo/latency policies)', gcp: 'Cloud DNS + routing policies', azure: 'Azure DNS + Traffic Manager' },
    { concept: 'Anycast front door', aws: 'Global Accelerator', gcp: 'Built into global LB (anycast VIPs)', azure: 'Azure Front Door' },
    { concept: 'Service-to-service (mesh) LB', aws: 'App Mesh / VPC Lattice', gcp: 'Traffic Director', azure: 'Service Fabric / Open Service Mesh' },
    { concept: 'Health-check-driven failover', aws: 'Route 53 health checks', gcp: 'Cloud DNS + LB health checks', azure: 'Traffic Manager endpoint monitoring' },
  ],
}

export default loadBalancing
