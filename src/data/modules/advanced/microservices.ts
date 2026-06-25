import type { Module } from '../../../lib/types'

const microservices: Module = {
  id: 'microservices',
  category: 'advanced',
  title: 'Microservices Patterns',
  description:
    'When to split a monolith, where to draw service boundaries, and the patterns (sagas, circuit breakers, service mesh, strangler fig) that keep a distributed system from eating you alive.',
  difficulty: 'Senior',
  estMinutes: 150,
  keywords: ['saga', 'circuit breaker', 'service mesh', 'domain-driven design', 'strangler fig', 'bulkhead', 'sidecar', 'API gateway'],
  related: ['api-design', 'message-queues', 'distributed-systems', 'load-balancing'],
  sections: [
    {
      type: 'text',
      title: 'Start with a monolith (seriously)',
      md: `
The most senior thing you can say in a microservices interview is: **"I'd start with a monolith."**

Microservices solve an *organizational* scaling problem, not a performance one. A well-built monolith on modern
hardware serves tens of thousands of QPS. Shopify handles **Black Friday peaks of ~1M requests/minute** on a
(modular) Rails monolith, and Stack Overflow served its entire global traffic from **9 web servers**. Function calls
are ~1,000× faster than network calls: an in-process call costs nanoseconds; a same-DC RPC costs **0.5–2 ms** plus
serialization.

What actually breaks at scale is the **organization**:

- **50+ engineers in one deploy pipeline.** Every release trains together; one team's flaky test blocks everyone. Deploy frequency collapses to weekly "release windows."
- **Coupled scaling.** Image processing needs 64 GB RAM boxes; the checkout path needs 200 of something cheap. A monolith forces one shape on both.
- **Coupled risk.** A memory leak in the recommendations code OOM-kills checkout.

Microservices buy you **independent deploys, independent scaling, and independent failure domains**, at the price of
distributed transactions, network failure modes, and an observability bill. Segment famously split into ~140 services,
drowned in operational overhead, and **merged back into a monolith** in 2017. Netflix runs **~1,000 microservices**
successfully, with hundreds of platform engineers making that possible.

> Rule of thumb: below ~20 engineers, a modular monolith with clean internal boundaries beats microservices on almost
> every axis. Split when team coordination, not CPU, is your bottleneck.
`,
    },
    {
      type: 'comparison',
      title: 'Monolith vs microservices, honestly',
      comparison: {
        columns: ['Criterion', 'Monolith', 'Microservices'],
        rows: [
          ['Deploy frequency', 'Whole app per release; teams queue behind one pipeline', 'Per-service; elite DORA teams deploy on demand, multiple times/day'],
          ['Latency between modules', 'In-process call: ~nanoseconds', 'Network hop: 0.5–2 ms + serialization, per hop'],
          ['Data consistency', 'One DB, ACID transactions, joins for free', 'Distributed: sagas, eventual consistency, no cross-service joins'],
          ['Failure blast radius', 'One bug can take down everything', 'Isolated, if you add circuit breakers and bulkheads'],
          ['Scaling granularity', 'Scale the whole app even if 1 module is hot', 'Scale only the hot service (e.g., 200 checkout pods, 4 admin pods)'],
          ['Operational cost', 'One pipeline, one runbook, one on-call', 'N pipelines, service mesh, tracing, platform team (Netflix: hundreds of platform engineers)'],
          ['Team autonomy', 'Shared codebase, merge conflicts at 50+ engineers', 'Team owns service end-to-end ("you build it, you run it")'],
        ],
        verdict:
          'Monolith until org pain (not perf pain) forces the split. Then extract the highest-churn, most independent domains first.',
      },
    },
    {
      type: 'text',
      title: 'Service boundaries (DDD) and how services talk',
      md: `
The #1 cause of microservice misery is **wrong boundaries**: split along the wrong line and every user action fans out
across 5 services that must change in lockstep: a *distributed monolith*, all of the network costs with none of the
autonomy. **Domain-driven design** gives you the knife: the unit of decomposition is the **bounded context**, a part
of the business where a term means exactly one thing. "Order" means different things to checkout (a cart being paid),
fulfillment (boxes to pack), and accounting (a ledger entry): three contexts, three services, three models.

Boundary heuristics:

- **One service = one team** (Amazon's two-pizza rule, ≤8 people). A service co-owned by three teams isn't a boundary.
- **Data ownership is exclusive.** Each service owns its database; shared tables couple schemas and deploys invisibly.
- **High cohesion inside, low chatter across.** If one request needs 6 cross-service calls, the boundary is wrong.

Once split, every interaction picks one of two styles:

- **Synchronous (REST/gRPC).** Caller blocks for the answer. Right when a human is waiting (checkout needs the payment result *now*). Costs compound: each hop adds **0.5–2 ms** plus failure probability, and 5 chained services at 99.9% each yield at best **99.5%**, so deep sync chains are how p99s die.
- **Asynchronous (events via Kafka/RabbitMQ).** The producer emits \`OrderPlaced\` and moves on. You get temporal decoupling (a consumer can be down 5 minutes and loses nothing), spike buffering, and free fan-out; you pay in **eventual consistency** and harder debugging.

> Default that holds up in interviews: sync for queries and user-facing commands, async for everything else, such as
> side effects, notifications, replicating data into other services' read models.
`,
    },
    {
      type: 'text',
      title: 'The distributed transaction problem and sagas',
      md: `
Place an order: reserve inventory, charge the card, create a shipment. In a monolith that's one ACID transaction:
\`BEGIN ... COMMIT\`, done. Across three services with three databases, **there is no transaction**. Two-phase commit
(2PC) technically exists, but it holds locks across the network while waiting on the slowest participant and turns the
coordinator into an availability bottleneck. Virtually no high-scale shop uses it for inter-service flows.

The standard answer is the **saga**: break the operation into a sequence of *local* transactions, each committed
independently, and define a **compensating action** for each step. If step 3 fails, you run the compensations for
steps 2 and 1 in reverse: \`refund_payment\`, then \`release_inventory\`. Not a rollback (those committed states were
briefly real and visible), but an *undo*.

Two ways to coordinate a saga:

- **Choreography**: no central brain. Each service reacts to events: payment hears \`OrderPlaced\` and emits \`PaymentCompleted\`; inventory hears that and emits \`InventoryReserved\`. Minimal coupling, but the workflow exists only implicitly, smeared across services.
- **Orchestration**: a coordinator (the order service, or a workflow engine like Temporal/AWS Step Functions) explicitly commands each step and tracks state. The flow is readable in one place; the orchestrator is one more thing to operate.

Design rule that saves real money: order the steps so the **hardest-to-compensate step goes last**. Charging a card is
easy to refund; shipping a package is not, so ship last.
`,
    },
    {
      type: 'comparison',
      title: 'Saga coordination: choreography vs orchestration',
      comparison: {
        columns: ['Criterion', 'Choreography (events)', 'Orchestration (coordinator)'],
        rows: [
          ['Coupling', 'Loose: services only know event schemas', 'Services coupled to the orchestrator\'s commands'],
          ['Visibility of the flow', 'Implicit: reconstruct it from 5 consumers\' code', 'Explicit: one state machine you can read and diagram'],
          ['Failure handling', 'Each service handles compensation triggers itself; easy to miss an edge', 'Centralized retries, timeouts, compensation logic'],
          ['Single point of failure', 'None (broker aside)', 'Orchestrator; mitigate with durable state (Temporal persists every step)'],
          ['Sweet spot', '2–4 steps, simple linear flows', '4+ steps, branching, human approval steps, money'],
          ['Debugging "where is my order?"', 'Trace events across topics, painful without tracing', 'Query the orchestrator\'s state table directly'],
        ],
        verdict:
          'Choreography for short, simple sagas; orchestration once the flow has 4+ steps or carries money. Many teams start choreographed and migrate the painful flows to Temporal.',
      },
    },
    {
      type: 'text',
      title: 'Resilience: circuit breakers, retries, timeouts, bulkheads',
      md: `
In a microservices system, **partial failure is the steady state**. With 100 services each at 99.9%, something is
degraded essentially always. Four patterns keep local failures local:

- **Timeouts, always, everywhere.** A missing timeout is an unbounded resource leak: threads pile up waiting on a dead dependency until *your* service falls over too. Set them from the callee's p99 (e.g., p99 = 80 ms gives a 250 ms timeout), not from hope.
- **Retries, with budgets and jitter.** Retry only idempotent operations, cap at 2–3 attempts, use exponential backoff with jitter, and cap total retry traffic (a "retry budget", e.g. ≤10% extra load). Naive retries are how a 10% brownout becomes a 300% **retry storm** that finishes the victim off.
- **Circuit breakers.** After N consecutive failures (or an error rate over ~50% in a window), stop calling the dependency entirely and fail fast for a cooldown (10–30 s), then probe with a few trial requests. Failing in 1 ms beats timing out in 250 ms: your threads stay free and the sick service gets room to recover.
- **Bulkheads.** Partition resources per dependency, with separate connection pools and concurrency limits, so a slow recommendations service can exhaust *its* 20 connections without touching the 50 reserved for payments.

These compose: bulkheads bound the damage, timeouts bound the wait, breakers stop the bleeding, and careful retries
handle the transient blips. Netflix's Hystrix popularized the stack; today it usually lives in Resilience4j or in the
service mesh.
`,
    },
    {
      type: 'code',
      title: 'Circuit breaker, in 40 lines of pseudocode',
      language: 'python',
      code: `
# States: CLOSED (normal) -> OPEN (failing fast) -> HALF_OPEN (probing)
class CircuitBreaker:
    def __init__(self):
        self.state = "CLOSED"
        self.failures = 0
        self.FAILURE_THRESHOLD = 5      # consecutive failures to trip
        self.COOLDOWN_SECONDS = 30      # how long to stay OPEN
        self.opened_at = None

    def call(self, request):
        if self.state == "OPEN":
            if now() - self.opened_at < self.COOLDOWN_SECONDS:
                raise CircuitOpenError()        # fail in ~1ms, no network call
            self.state = "HALF_OPEN"            # cooldown over: allow a probe

        try:
            response = downstream.send(request, timeout=0.25)  # ALWAYS a timeout
        except (Timeout, ConnectionError):
            self.record_failure()
            raise
        self.record_success()
        return response

    def record_failure(self):
        self.failures += 1
        # In HALF_OPEN, one failed probe re-opens immediately
        if self.state == "HALF_OPEN" or self.failures >= self.FAILURE_THRESHOLD:
            self.state = "OPEN"
            self.opened_at = now()

    def record_success(self):
        self.failures = 0
        if self.state == "HALF_OPEN":
            self.state = "CLOSED"               # dependency recovered

# Production notes:
# - Trip on error RATE over a sliding window (e.g. >50% of last 20 calls),
#   not just consecutive failures.
# - Pair with a fallback: cached data, default value, or graceful degradation
#   ("recommendations unavailable" beats a 500 on the whole page).
# - One breaker PER dependency (bulkhead) - not one global breaker.
`,
    },
    {
      type: 'text',
      title: 'Service discovery and the service mesh',
      md: `
With 50 services × 20 autoscaling pods each, "what's the IP of payments?" needs a real answer. **Service discovery**
is a registry (Consul, etcd, or Kubernetes' built-in DNS + Endpoints) that healthy instances register with and callers
query. In Kubernetes you just dial \`payments.checkout.svc.cluster.local\` and kube-proxy load-balances across live
pods.

Then there's the cross-cutting stuff *every* service needs: mTLS, retries, timeouts, circuit breaking, traffic
splitting for canaries, metrics. Implementing that in 6 languages × 50 services is a disaster, so the **service
mesh** moves it into infrastructure via the **sidecar pattern**: an **Envoy** proxy container sits next to every
service instance, and all traffic in and out flows through it. A control plane (**Istio**, Linkerd) pushes config to
all sidecars: "payments gets a 250 ms timeout, 2 retries, mTLS everywhere, send 5% of traffic to v2."

The price is real and you should quote it: each hop now traverses two proxies, adding roughly **0.5–2 ms of latency
per hop** (Istio's published benchmarks: ~0.2–0.6 ms per proxy at p50, worse at p99) plus ~**0.3 vCPU and 50 MB RAM
per sidecar** at ~1,000 RPS. At 10 hops that's potentially 10–20 ms of pure mesh tax on your p99.

> Honest take for interviews: a mesh pays off at ~30+ services with polyglot stacks and compliance-grade mTLS needs.
> Below that, a shared client library or plain Kubernetes services is cheaper and simpler. Sidecar-less meshes
> (Istio ambient, Cilium/eBPF) are shrinking this overhead.
`,
    },
    {
      type: 'diagram',
      title: 'E-commerce microservices architecture',
      caption:
        'Synchronous edge (gateway → services) with an async saga behind it: the order service emits events, and a saga coordinator drives payment and inventory with compensations.',
      diagram: {
        height: 480,
        nodes: [
          { id: 'clients', label: 'Clients', kind: 'client', x: 30, y: 220, detail: 'Web and mobile apps. 5M DAU placing 300K orders/day; checkout peaks at ~50 orders/sec during sales events.' },
          { id: 'gateway', label: 'API Gateway', kind: 'lb', x: 215, y: 220, detail: 'Single entry point: TLS termination, JWT auth, per-client rate limiting (e.g. 100 req/min), and routing to services. Kong/Envoy handles 10K+ QPS per node at <1 ms added latency.' },
          { id: 'orders', label: 'Order Service', kind: 'service', x: 410, y: 70, detail: 'Owns the order lifecycle and the orders DB. Writes the order in PENDING state and emits OrderPlaced to Kafka in one local transaction (outbox pattern), then returns 202 to the client in ~50 ms.' },
          { id: 'catalog', label: 'Catalog Service', kind: 'service', x: 410, y: 220, detail: 'Product data, read-heavy (100:1). Serves ~5K QPS from its own Postgres + Redis cache at p99 ~15 ms. Scaled independently: 30 pods vs orders\' 8.' },
          { id: 'users', label: 'User Service', kind: 'service', x: 410, y: 370, detail: 'Profiles, addresses, auth. Owns its own DB; payments never reads user tables directly; it calls this API. Exclusive data ownership is what keeps boundaries real.' },
          { id: 'kafka', label: 'Kafka', kind: 'queue', x: 610, y: 70, detail: 'Event backbone: OrderPlaced, PaymentCompleted, InventoryReserved topics. 3-broker cluster handles 100K+ events/sec; 7-day retention lets consumers replay after bugs.' },
          { id: 'saga', label: 'Saga Coordinator', kind: 'service', x: 610, y: 220, detail: 'Orchestrates the order saga: reserve inventory → charge payment → confirm order. Persists state per step (Temporal-style), so a crash mid-saga resumes instead of losing orders. On failure it runs compensations in reverse.' },
          { id: 'payments', label: 'Payment Service', kind: 'service', x: 840, y: 70, detail: 'Wraps Stripe/Adyen. Idempotency keys on every charge so saga retries never double-bill. p99 ~800 ms (dominated by the external PSP), so it is called async, never on the synchronous checkout path.' },
          { id: 'inventory', label: 'Inventory Svc', kind: 'service', x: 840, y: 220, detail: 'Reserves stock with a 15-minute TTL hold. Compensating action: release_reservation. Hardest-to-undo step (shipping) is sequenced last in the saga.' },
          { id: 'ordersdb', label: 'Orders DB', kind: 'db', x: 610, y: 370, detail: 'Postgres owned exclusively by the order service: database-per-service. Other teams get data via events or the orders API, never via shared tables.' },
        ],
        edges: [
          { from: 'clients', to: 'gateway', label: 'HTTPS' },
          { from: 'gateway', to: 'orders', label: 'POST /orders' },
          { from: 'gateway', to: 'catalog', label: 'GET /products' },
          { from: 'gateway', to: 'users' },
          { from: 'orders', to: 'ordersdb', label: 'outbox' },
          { from: 'orders', to: 'kafka', label: 'OrderPlaced' },
          { from: 'kafka', to: 'saga', label: 'consume' },
          { from: 'saga', to: 'inventory', label: '1. reserve' },
          { from: 'saga', to: 'payments', label: '2. charge' },
          { from: 'saga', to: 'kafka', label: 'OrderConfirmed', dashed: true },
        ],
      },
    },
    {
      type: 'text',
      title: 'Observability and the strangler fig migration',
      md: `
#### "Which service broke?"

A user reports a slow checkout. The request touched 8 services. Which one was it? Without distributed tracing this
is a multi-team archaeology project. The fix is three pillars, wired in from day one:

- **Distributed tracing** (OpenTelemetry → Jaeger/Tempo/Datadog): a trace ID is generated at the gateway and propagated through every hop, including Kafka messages. One waterfall view shows checkout spent 1,840 ms of its 2,000 ms inside inventory's DB query. Sample (1–10% of traffic); tracing everything at 100K QPS is its own scaling problem.
- **Metrics**: RED per service (**R**ate, **E**rrors, **D**uration (p50/p99)) on standard dashboards, with SLO-based alerts, not CPU-based ones.
- **Structured logs** with the trace ID in every line, so you can jump from a trace to the exact logs.

#### Strangler fig: how you actually migrate

Nobody rewrites a monolith big-bang; those projects run 2 years and get cancelled. The **strangler fig** pattern
(named for the vine that envelops a tree): put a routing layer (the API gateway) in front of the monolith, extract
**one** capability at a time into a service, flip its routes (1%, 10%, 100%, with instant rollback), and repeat.
The monolith shrinks until it's gone, or until what remains is fine as-is. Shopify, GitHub, and Airbnb all ran
multi-year strangler migrations while shipping features the whole time. Extract first whatever changes most often or
needs independent scaling; leave the stable core for last, or forever.
`,
    },
    {
      type: 'beforeAfter',
      title: 'Case: 60-engineer monolith → 12 services',
      scenario: {
        beforeTitle: 'One Rails monolith, one release train',
        beforeDescription:
          'Sixty engineers share one pipeline: a 45-minute test suite, weekly release windows, and full-app rollbacks. A memory leak in image processing OOM-kills checkout. Deploys: ~2/week, and every incident pages everyone.',
        afterTitle: '12 services along team boundaries (18-month strangler migration)',
        afterDescription:
          'Each team deploys its own service independently behind an API gateway; an order saga replaced the cross-domain transaction. Honest costs: infra spend up ~40% (mesh sidecars, per-service DBs, tracing), p99 up ~25 ms from network hops, and a 4-person platform team now exists just to run the paved road.',
        metrics: [
          { label: 'Deploy frequency', before: '~2/week (whole app)', after: '~25/day across teams', improved: true },
          { label: 'Lead time for a change', before: '4 days', after: '2 hours', improved: true },
          { label: 'Checkout blast radius', before: 'Any module can take it down', after: 'Isolated via bulkheads + breakers', improved: true },
          { label: 'p99 added latency', before: '0 ms (in-process calls)', after: '+25 ms (network + mesh hops)', improved: false },
          { label: 'Infra + platform cost', before: 'Baseline', after: '+40%, plus 4-eng platform team', improved: false },
        ],
      },
    },
  ],
  quiz: [
    {
      question: 'What problem are microservices primarily the right tool for?',
      options: [
        'Making individual requests faster than a monolith',
        'Reducing total infrastructure cost',
        'Letting many teams build, deploy, and scale independently',
        'Avoiding the need for database transactions',
      ],
      answer: 2,
      explanation:
        'Microservices trade per-request performance (network hops) and infra cost for organizational scalability: independent deploys, scaling, and failure domains. If you have 8 engineers and no perf problem, they solve nothing.',
    },
    {
      question: 'A saga step fails after inventory was reserved and the card was charged. What happens?',
      options: [
        'Compensating transactions run in reverse: refund the payment, then release the inventory',
        'The database rolls back all three steps atomically',
        'A 2PC coordinator aborts the global transaction',
        'The events are replayed from Kafka until the step succeeds',
      ],
      answer: 0,
      explanation:
        'Saga steps are locally committed transactions, so there is nothing to roll back. Each step defines a compensating action (refund, release), executed in reverse order. That is why hard-to-compensate steps like shipping go last.',
    },
    {
      question: 'Your service calls a dependency whose error rate just hit 80%. A circuit breaker in the OPEN state will…',
      options: [
        'Queue requests until the dependency recovers',
        'Fail requests immediately without calling the dependency, then probe again after a cooldown',
        'Retry each request 3 times with exponential backoff',
        'Route requests to a replica of the dependency',
      ],
      answer: 1,
      explanation:
        'OPEN means fail fast: ~1 ms local errors instead of 250 ms timeouts, which frees your threads and gives the sick dependency room to recover. After a cooldown it goes HALF_OPEN and lets a few probes through.',
    },
    {
      question: 'Five services in a synchronous chain are each 99.9% available. The chain\'s availability is roughly…',
      options: ['99.9%', '99.99%', '98%', '99.5%'],
      answer: 3,
      explanation:
        'Serial dependencies multiply: 0.999^5 ≈ 0.995. This compounding is the core argument for shallow call graphs, async decoupling, and fallbacks instead of deep sync chains.',
    },
    {
      question: 'Which is the textbook strangler fig approach to retiring a monolith?',
      options: [
        'Freeze the monolith, rewrite everything in parallel, cut over in one weekend',
        'Extract all services at once along database table boundaries',
        'Run the monolith and services forever with a shared database between them',
        'Route through a gateway, extract one capability at a time, shift traffic gradually with rollback',
      ],
      answer: 3,
      explanation:
        'Strangler fig migrates incrementally behind a routing layer: each extraction ships value and can be rolled back. Big-bang rewrites and shared databases are the two classic ways these migrations die.',
    },
  ],
  interviewQuestions: [
    {
      question: 'Your startup has 12 engineers and a Django monolith at 300 QPS. The CTO wants microservices. What do you advise?',
      hint: 'Push back with numbers: 12 engineers is below the team-coordination threshold, 300 QPS is trivial for a monolith, and microservices add mesh/tracing/saga costs. Propose a modular monolith with enforced internal boundaries so a future split stays possible.',
      difficulty: 'Junior',
    },
    {
      question: 'Design the order-placement flow across order, payment, and inventory services. What happens when the payment service is down?',
      hint: 'Saga with compensations; outbox pattern so the OrderPlaced event commits atomically with the order row; idempotency keys so retries never double-charge; order in PENDING state while the saga retries with backoff; sequence shipping last.',
      difficulty: 'Mid',
    },
    {
      question: 'p99 checkout latency doubled after adopting Istio. How do you investigate, and what are your options?',
      hint: 'Use distributed tracing to attribute latency per hop; quantify sidecar overhead (~0.5–2 ms/hop × hop count, worse at p99 under CPU throttling). Options: collapse chatty call chains, raise sidecar CPU limits, move hot paths off the mesh, or evaluate ambient/eBPF mode.',
      difficulty: 'Senior',
    },
    {
      question: 'How would you split a monolith\'s single shared database as you extract services?',
      hint: 'Database-per-service as the end state. Steps: identify table ownership per bounded context, break cross-context joins (replace with API calls or replicated read models via events/CDC), use the strangler pattern with dual-writes or change-data-capture during transition, and accept eventual consistency across contexts.',
      difficulty: 'Senior',
    },
  ],
  commonMistakes: [
    'Proposing microservices for a performance problem. Network calls are ~1,000× slower than function calls, so splitting a slow monolith usually makes it slower. Profile first.',
    'Building a distributed monolith: services that share a database or must deploy in lockstep. You pay all the costs of distribution and keep all the coupling.',
    'Sizing services by lines of code ("nano-services") instead of bounded contexts. 140 services for 40 engineers is how Segment ended up merging back into a monolith.',
    'Retries without timeouts, jitter, or budgets, turning a 10% brownout into a self-inflicted retry storm that takes the dependency from degraded to dead.',
    'Adopting a service mesh at 5 services "for the future." That is ~0.5–2 ms per hop and a sidecar fleet to operate, purchased years before the mTLS/polyglot problems it solves exist.',
  ],
  cloudMappings: [
    { concept: 'API gateway', aws: 'API Gateway / ALB', gcp: 'API Gateway / Apigee', azure: 'API Management' },
    { concept: 'Container orchestration', aws: 'EKS / ECS', gcp: 'GKE', azure: 'AKS' },
    { concept: 'Service mesh', aws: 'App Mesh / VPC Lattice', gcp: 'Anthos Service Mesh (Istio)', azure: 'Open Service Mesh add-on' },
    { concept: 'Saga / workflow orchestration', aws: 'Step Functions', gcp: 'Workflows', azure: 'Durable Functions / Logic Apps' },
    { concept: 'Event backbone', aws: 'MSK (Kafka) / EventBridge / SQS', gcp: 'Pub/Sub', azure: 'Event Hubs / Service Bus' },
    { concept: 'Distributed tracing', aws: 'X-Ray', gcp: 'Cloud Trace', azure: 'Application Insights' },
  ],
}

export default microservices
