import type { Module } from '../../../lib/types'

const messageQueues: Module = {
  id: 'message-queues',
  category: 'fundamentals',
  title: 'Message Queues & Pub-Sub',
  description:
    'Why async messaging is the backbone of resilient systems: decoupling, spike buffering, delivery guarantees, dead-letter queues, and when to reach for Kafka vs RabbitMQ vs SQS.',
  difficulty: 'Mid',
  estMinutes: 130,
  keywords: [
    'Kafka',
    'RabbitMQ',
    'SQS',
    'at-least-once',
    'idempotency',
    'dead-letter queue',
    'consumer groups',
    'backpressure',
  ],
  related: ['realtime-systems', 'microservices', 'design-notifications', 'distributed-systems'],
  sections: [
    {
      type: 'text',
      title: 'Why go async at all',
      md: `
A synchronous call chain is a chain of *shared fate*: if checkout calls payments calls the email service, and the
email service has a bad day, your checkout has a bad day. Queues break that fate-sharing. Three concrete wins:

- **Decoupling.** Producer and consumer only agree on a message format, not on uptime, language, or deploy schedule. The email service can be down for 20 minutes and nobody who placed an order notices.
- **Buffering spikes.** A flash sale pushes 12,000 orders/min at a payment processor that sustains 3,000/min. Synchronously, 75% of requests fail. With a queue in between, the backlog grows for a few minutes and drains, and every order eventually processes.
- **Retry without re-asking the user.** A failed message goes back on the queue and is retried automatically. Without a queue, "retry" means an error page and a user mashing the buy button (often producing duplicate orders).

The price is **eventual** processing: the caller gets a \`202 Accepted\` and an order ID, not a final result. That
forces you to design notification paths (webhooks, polling, push) and to think about what "pending" means in your UI.

> Rule of thumb: anything the user must see *in the response* stays synchronous (auth, inventory check). Anything
> that can happen "within a few seconds to minutes" (emails, invoices, fulfillment, analytics) belongs behind a queue.

Latency cost is small: enqueueing to Kafka or SQS adds **2–10 ms p99** to the request path, far cheaper than the
300–800 ms a synchronous payment-gateway call would add.
`,
    },
    {
      type: 'text',
      title: 'Queue vs pub-sub: who gets the message?',
      md: `
Two delivery semantics cover almost everything:

#### Point-to-point queue (competing consumers)

One message → **exactly one** consumer in a pool. Consumers *compete*; adding workers increases throughput.
This is for **work distribution**: resize this image, charge this card. SQS and a RabbitMQ work queue behave this way.

#### Publish-subscribe (fan-out)

One message → **every** subscriber group gets its own copy. This is for **event broadcast**: an \`order_placed\`
event independently consumed by fulfillment, analytics, fraud detection, and email, each at its own pace, each
with its own offset/backlog. Kafka topics, SNS, and RabbitMQ fan-out exchanges behave this way.

Kafka elegantly unifies both: within a **consumer group**, partitions are divided among members (queue semantics);
across groups, every group reads the full topic (pub-sub semantics). That's why a single \`orders\` topic can feed
five teams without coordination.

A useful design smell: if adding a new consumer requires *changing the producer*, you've built a queue where you
needed pub-sub. Producers should publish facts ("order 4812 placed"), not commands to specific services. That's
what keeps a 50-service company from becoming a fully-connected call graph.
`,
    },
    {
      type: 'diagram',
      title: 'Order processing: a queue absorbing a flash-sale spike',
      caption:
        'The checkout API enqueues and returns in ~10 ms. Workers drain at their own sustainable rate; poison messages divert to the DLQ after repeated failures.',
      diagram: {
        height: 420,
        nodes: [
          {
            id: 'clients',
            label: 'Clients',
            kind: 'client',
            x: 20,
            y: 180,
            detail:
              'Flash sale: traffic spikes from 800 to 12,000 orders/min for ~10 minutes. Users get an immediate 202 with an order ID and a "processing" status.',
          },
          {
            id: 'api',
            label: 'Checkout API',
            kind: 'server',
            x: 220,
            y: 180,
            detail:
              'Validates the cart, reserves inventory synchronously, then enqueues an order_placed message. Total response time ~120 ms p99; the 600 ms payment call is no longer on the request path.',
          },
          {
            id: 'queue',
            label: 'Orders Queue',
            kind: 'queue',
            x: 430,
            y: 180,
            detail:
              'Backlog peaks at ~90,000 messages during the spike and drains in ~12 minutes. Kafka or SQS both handle this trivially: SQS scales transparently; one Kafka partition alone can absorb 10s of MB/s.',
          },
          {
            id: 'worker1',
            label: 'Order Worker 1',
            kind: 'service',
            x: 660,
            y: 60,
            detail:
              'Pulls messages, charges the card, writes the order. Each worker sustains ~25 orders/s. Autoscaling on queue depth adds workers when backlog age exceeds 60 s.',
          },
          {
            id: 'worker2',
            label: 'Order Worker N',
            kind: 'service',
            x: 660,
            y: 180,
            detail:
              'Identical competing consumer. With Kafka, the consumer group assigns each worker a subset of partitions; max useful workers = partition count (e.g. 32).',
          },
          {
            id: 'dlq',
            label: 'Dead-letter Q',
            kind: 'queue',
            x: 430,
            y: 330,
            detail:
              'Messages that fail 5 delivery attempts land here instead of blocking the main queue forever. Alert when depth > 0; typical DLQ rate in a healthy system is <0.01% of traffic.',
          },
          {
            id: 'payments',
            label: 'Payment Gateway',
            kind: 'external',
            x: 850,
            y: 60,
            h: 56,
            w: 140,
            detail:
              'Third-party processor rate-limited to ~3,000 charges/min. The queue is what lets you accept 12,000 orders/min upstream without dropping any.',
          },
          {
            id: 'db',
            label: 'Orders DB',
            kind: 'db',
            x: 850,
            y: 240,
            w: 140,
            detail:
              'Workers write final order state and record processed message IDs for idempotency (a unique index on idempotency_key makes duplicate deliveries harmless).',
          },
        ],
        edges: [
          { from: 'clients', to: 'api', label: 'POST /checkout' },
          { from: 'api', to: 'queue', label: 'enqueue ~5 ms' },
          { from: 'queue', to: 'worker1', label: 'pull' },
          { from: 'queue', to: 'worker2', label: 'pull' },
          { from: 'worker1', to: 'payments', label: 'charge' },
          { from: 'worker2', to: 'db', label: 'write order' },
          { from: 'worker2', to: 'dlq', label: 'after 5 fails', dashed: true },
        ],
      },
    },
    {
      type: 'text',
      title: 'Delivery guarantees, and why exactly-once is mostly a lie',
      md: `
Every messaging system promises one of three things:

- **At-most-once**: fire and forget. The broker may drop messages on failure, but never duplicates. Acceptable for metrics and logs where losing 0.01% is fine.
- **At-least-once**: the broker redelivers until a consumer *acknowledges*. Nothing is lost, but crashes between "processed" and "acked" produce **duplicates**. This is the default for SQS, RabbitMQ, and Kafka, and it's what you should design for.
- **Exactly-once**: every message processed precisely once. Inside a single system's boundaries this is achievable: Kafka's transactional producer + read-committed consumer gives exactly-once *within Kafka-to-Kafka pipelines*. But the moment your consumer calls an external API or writes to a non-transactional store, the guarantee evaporates: the broker cannot atomically commit your side effect and the offset.

So in practice: **the broker gives you at-least-once; you build "effectively once" yourself with idempotency.**

The standard tool is an **idempotency key**: a unique ID per logical operation (order ID, payment intent ID, or a
producer-generated UUID) stored alongside the side effect. Before processing, check whether the key was already
handled; if so, skip. Stripe's entire API works this way: clients send an \`Idempotency-Key\` header and Stripe
stores results for **24 hours**, replaying the original response on retries.

> Interview gold: "I'll assume at-least-once delivery and make every consumer idempotent" answers half the follow-up
> questions about crashes, retries, and redeliveries before they're asked.
`,
    },
    {
      type: 'code',
      title: 'An idempotent consumer (the pattern to memorize)',
      language: 'python',
      code: `
# At-least-once delivery means: this handler WILL eventually run twice
# for some message. Make that harmless.

def handle_order_placed(message):
    key = message["idempotency_key"]     # e.g. order UUID from the producer

    # 1. Claim the key atomically. Unique index makes the race safe:
    #    if two workers grab the same redelivered message, one INSERT loses.
    try:
        db.execute(
            "INSERT INTO processed_messages (idempotency_key, status) "
            "VALUES (?, 'in_progress')", key)
    except UniqueViolation:
        return ack(message)              # duplicate, already handled, just ack

    # 2. Do the side effect. Pass the SAME key downstream so the payment
    #    gateway dedupes too (Stripe keeps idempotency keys for 24 h).
    charge = payments.charge(
        amount=message["total"],
        idempotency_key=key)

    # 3. Record completion and ack. If we crash before this line, the
    #    message redelivers, step 1 sees 'in_progress', and a janitor
    #    process resolves it by querying the gateway with the same key.
    db.execute(
        "UPDATE processed_messages SET status='done' WHERE idempotency_key=?",
        key)
    ack(message)

# Anti-pattern: ack BEFORE processing => at-most-once (crash loses the order).
# Anti-pattern: no key, retry blindly  => duplicate charges. This is the #1
# real-world messaging bug.
`,
    },
    {
      type: 'text',
      title: 'Ordering, dead-letter queues, and backpressure',
      md: `
#### Ordering

Global ordering across a distributed queue is a unicorn: providing it means a single serial bottleneck. What real
systems give you is **per-key ordering**: Kafka guarantees order *within a partition*, so route all events for one
entity (user ID, order ID) to the same partition via key hashing. Events for *different* orders interleave freely,
and nobody cares. SQS standard queues offer best-effort ordering only; SQS FIFO gives per-message-group ordering
but caps at **300 msg/s per group** (3,000 with batching).

#### Dead-letter queues

A malformed message that always crashes its consumer (a **poison message**) will otherwise redeliver forever,
burning a worker and stalling a FIFO partition. Configure max delivery attempts (5 is a common default) and shunt
failures to a **DLQ**. Then *actually monitor it*: a DLQ nobody alerts on is a silent data-loss bin. Triage flow:
inspect, fix the bug, redrive messages back to the main queue (SQS has one-click redrive).

#### Backpressure

When producers outrun consumers, the backlog grows. Watch **queue depth** and, better, **oldest-message age**: a
backlog of 1M messages draining in 60 s is fine; 10K messages aging past your SLA is not. Responses, in order of
preference: autoscale consumers on backlog age, throttle producers (shed low-priority work), and bound the queue with
a retention/TTL so an unbounded backlog can't take down the broker. Kafka sidesteps broker pressure with retention-based
storage (it's a log, not a queue), but a slow consumer still falls behind, so monitor **consumer lag** per group.
`,
    },
    {
      type: 'text',
      title: 'Kafka in five minutes: partitions, consumer groups, offsets',
      md: `
Kafka is not a queue; it's a **replicated, partitioned commit log**. Three ideas explain almost all of its behavior:

- **Partitions.** A topic is split into N partitions (often 16–128). Each partition is an append-only, ordered file on a broker, replicated to 2 other brokers (replication factor 3). Partitions are the unit of parallelism *and* of ordering. A single partition sustains roughly **10–50 MB/s**; a modest 6-broker cluster moves **1+ GB/s aggregate**, and big deployments (LinkedIn runs Kafka at **7+ trillion messages/day**) reach hundreds of brokers.
- **Consumer groups.** Consumers with the same \`group.id\` divide the partitions among themselves: 32 partitions and 8 consumers means 4 partitions each. Add a 9th consumer and Kafka rebalances. A 33rd consumer **sits idle**: partition count is your max parallelism, which is why you over-partition up front (repartitioning later breaks key ordering).
- **Offsets.** Consumers track position as a per-partition integer offset, committed back to Kafka. Messages are *not deleted on consumption*; retention is time/size-based (default 7 days). This means you can replay: reset offsets to rewind a buggy consumer over yesterday's data, or attach a brand-new consumer group to historical events. Queues (SQS, RabbitMQ) destroy messages on ack; logs let you re-read.

End-to-end latency is low for the throughput: **~5 ms p50, 10–30 ms p99** is typical with sane batching
(\`linger.ms\` of a few ms). Tail latency degrades if you under-provision partitions or run consumers near saturation.
`,
    },
    {
      type: 'comparison',
      title: 'Kafka vs RabbitMQ vs SQS',
      comparison: {
        columns: ['Criterion', 'Kafka', 'RabbitMQ', 'SQS'],
        rows: [
          ['Model', 'Partitioned, replayable log', 'Smart broker, flexible routing (exchanges)', 'Fully managed queue'],
          ['Throughput', '100s of MB/s–GB/s per cluster; millions msg/s', '~10–50K msg/s per node', 'Effectively unlimited (auto-scales)'],
          ['Latency (p99)', '~10–30 ms', '~1–10 ms (lowest at modest load)', '~10–100 ms (long-poll)'],
          ['Ordering', 'Per partition (by key)', 'Per queue (single consumer)', 'Best-effort; FIFO: per group @ 300 msg/s'],
          ['Replay old messages', 'Yes: offsets + retention (days)', 'No: consumed = gone', 'No: consumed = gone'],
          ['Ops burden', 'High (brokers, partitions, rebalances) or pay for MSK/Confluent', 'Medium (clustering, mirrored queues)', 'Zero: serverless, $0.40/M requests'],
          ['Sweet spot', 'Event streaming, fan-out to many teams, high volume', 'Task queues, complex routing, RPC-ish patterns', 'Decoupling services on AWS with minimal ops'],
        ],
        verdict:
          'Default to SQS (or its cloud equivalent) for plain work queues; zero ops wins. Reach for Kafka when you need replay, multiple independent consumers, or >50K msg/s sustained. RabbitMQ shines for low-latency task routing at moderate scale.',
      },
    },
    {
      type: 'beforeAfter',
      title: 'Case: checkout goes async',
      scenario: {
        beforeTitle: 'Synchronous call chain',
        beforeDescription:
          'Checkout API calls payments → invoicing → email → analytics in sequence. p99 is 2.8 s, and when the email provider had a 40-minute outage, checkout error rate hit 30% and ~9,000 orders were lost.',
        afterTitle: 'Enqueue and return 202',
        afterDescription:
          'Checkout validates, reserves inventory, enqueues order_placed, and returns. Payments, invoicing, email, and analytics consume independently with retries and a DLQ. The same email outage now just builds a 40-minute email backlog that drains automatically.',
        metrics: [
          { label: 'Checkout p99 latency', before: '2,800 ms', after: '180 ms', improved: true },
          { label: 'Orders lost in dependency outage', before: '~9,000', after: '0 (buffered)', improved: true },
          { label: 'Peak orders/min accepted', before: '3,000 (gateway-bound)', after: '12,000+', improved: true },
          { label: 'User sees final confirmation', before: 'Immediately', after: 'Push/email seconds later', improved: false },
        ],
      },
    },
    {
      type: 'keyNumbers',
      title: 'Numbers worth quoting in an interview',
      numbers: [
        { metric: 'Kafka per-broker throughput', value: '~100–500 MB/s', context: 'Disk- and network-bound; clusters aggregate to multiple GB/s.' },
        { metric: 'Kafka end-to-end p99', value: '10–30 ms', context: 'With small batching. p50 ~5 ms. Tune linger.ms vs latency.' },
        { metric: 'LinkedIn Kafka scale', value: '7+ trillion msgs/day', context: 'Existence proof that the log model scales absurdly far.' },
        { metric: 'SQS price', value: '$0.40/M requests', context: 'First 1M/month free. 1B messages ≈ $400; ops-free decoupling is cheap.' },
        { metric: 'SQS FIFO throughput cap', value: '300 msg/s per group', context: '3,000/s with batching. The price of ordering guarantees.' },
        { metric: 'Stripe idempotency-key TTL', value: '24 hours', context: 'The canonical production implementation of dedupe-by-key.' },
        { metric: 'Typical max delivery attempts', value: '5', context: 'Then to the DLQ. Alert on DLQ depth > 0.' },
      ],
    },
  ],
  quiz: [
    {
      question: 'Your consumer crashes after charging a card but before acking the message. Under at-least-once delivery, what happens next?',
      options: [
        'The message is lost and the order is never completed',
        'The broker detects the partial work and rolls back the charge',
        'The message is redelivered and, without idempotency, the card is charged twice',
        'The broker promotes the message to a dead-letter queue immediately',
      ],
      answer: 2,
      explanation:
        'At-least-once means unacked messages redeliver. The broker knows nothing about your side effects; preventing the double charge is your job, via an idempotency key checked before processing.',
    },
    {
      question: 'You need strict ordering of events per user, but throughput of 200K events/s overall. In Kafka you should…',
      options: [
        'Partition the topic by user ID so each user\'s events land in one partition',
        'Use a single partition to guarantee global order',
        'Set acks=0 for speed and reorder on the consumer',
        'Use one topic per user',
      ],
      answer: 0,
      explanation:
        'Key-based partitioning gives per-key ordering while spreading load across partitions. A single partition caps throughput; per-user topics explode metadata; acks=0 risks loss and fixes nothing about order.',
    },
    {
      question: 'Which capability does Kafka have that SQS and classic RabbitMQ queues fundamentally lack?',
      options: [
        'At-least-once delivery',
        'Dead-letter handling',
        'Competing consumers for parallelism',
        'Replaying already-consumed messages by rewinding offsets',
      ],
      answer: 3,
      explanation:
        'Kafka is a log with time-based retention: consumption just moves an offset, so you can rewind or attach new consumer groups to history. Queues delete on ack; consumed messages are gone.',
    },
    {
      question: 'A malformed "poison" message keeps crashing your consumer and redelivering. The right fix is:',
      options: [
        'Increase the visibility timeout so it redelivers less often',
        'Cap delivery attempts (e.g. 5) and route failures to a monitored dead-letter queue',
        'Switch from at-least-once to at-most-once delivery',
        'Add more consumers so other messages still get processed',
      ],
      answer: 1,
      explanation:
        'A DLQ quarantines the poison message so the main queue keeps flowing, while preserving it for debugging and redrive. At-most-once would silently drop real data; more consumers just crash more often.',
    },
    {
      question: 'A topic has 16 partitions and one consumer group with 20 consumers. How many consumers do useful work?',
      options: ['20: Kafka load-balances messages across all of them', '1: only the group leader consumes', '16, and the rest sit idle', '4: one per broker'],
      answer: 2,
      explanation:
        'Within a group, each partition is owned by exactly one consumer. Partition count is the parallelism ceiling, the reason teams over-partition (e.g. 32–64) at topic creation.',
    },
  ],
  interviewQuestions: [
    {
      question: 'When would you put a queue between two services, and what new problems does it introduce?',
      hint: 'Wins: decoupling failure domains, absorbing spikes (give a numbers example), automatic retry. Costs: eventual processing and UX for "pending" states, duplicate deliveries forcing idempotent consumers, ordering limits, one more piece of infrastructure to monitor (depth, age, DLQ).',
      difficulty: 'Junior',
    },
    {
      question: 'Design the messaging layer for order processing during a 10× flash sale. Walk through failure cases.',
      hint: 'Structure: sync validation + inventory hold, enqueue order_placed, return 202. Then enumerate failures: worker crash mid-charge (idempotency key + at-least-once), payment gateway rate limit (queue buffers, backlog math), poison message (DLQ after N attempts), backlog SLA breach (autoscale on oldest-message age).',
      difficulty: 'Mid',
    },
    {
      question: '"We need exactly-once processing." How do you respond?',
      hint: 'Clarify the boundary: exactly-once delivery to arbitrary external systems is impossible (two-generals); Kafka transactions give it only within Kafka. Propose at-least-once + idempotent consumers keyed by a business ID, dedupe table with unique index, passing the key to downstream APIs (Stripe model), and discuss the outbox pattern for DB-write + publish atomicity.',
      difficulty: 'Senior',
    },
    {
      question: 'Kafka consumer lag on one partition is growing while others are fine. Diagnose and fix.',
      hint: 'Expected structure: hot key skewing traffic to one partition (check per-partition rates), a slow/stuck consumer on that partition (check processing time, GC, poison message), or an under-sized max.poll config causing rebalance loops. Fixes: better partition key or key salting, scale processing inside the consumer, DLQ the stuck message. Note you can\'t just add consumers beyond partition count.',
      difficulty: 'Senior',
    },
  ],
  commonMistakes: [
    'Designing consumers as if messages arrive exactly once. At-least-once is the real contract; every handler needs an idempotency check, or you will double-charge someone within the first month.',
    'Using a queue where you need pub-sub: producer enqueues a command per downstream service, so adding a consumer means changing the producer. Publish facts to a topic instead and let consumers subscribe.',
    'Creating a DLQ and never alerting on it. An unmonitored DLQ is a slow-motion data-loss incident with great deniability.',
    'Promising "Kafka guarantees ordering" without the qualifier. It guarantees order per partition, so the partition key choice IS the ordering design, and repartitioning later breaks it.',
    'Monitoring queue depth instead of oldest-message age. 1M messages draining in 60 s is healthy; 5K messages aging past your SLA is an incident. Depth alone can\'t tell the difference.',
  ],
  cloudMappings: [
    { concept: 'Managed work queue', aws: 'SQS (Standard / FIFO)', gcp: 'Cloud Tasks / Pub/Sub pull', azure: 'Storage Queues / Service Bus Queues' },
    { concept: 'Pub-sub fan-out', aws: 'SNS (+ SQS fan-out)', gcp: 'Pub/Sub topics + subscriptions', azure: 'Service Bus Topics / Event Grid' },
    { concept: 'Kafka-style event streaming', aws: 'MSK / Kinesis Data Streams', gcp: 'Managed Service for Apache Kafka / Pub/Sub', azure: 'Event Hubs (Kafka API)' },
    { concept: 'Dead-letter queues', aws: 'SQS DLQ + redrive', gcp: 'Pub/Sub dead-letter topics', azure: 'Service Bus DLQ (built-in)' },
    { concept: 'Autoscaling consumers on backlog', aws: 'Lambda event source mapping / ECS + CloudWatch', gcp: 'Cloud Run + Pub/Sub push', azure: 'Functions + KEDA' },
    { concept: 'Workflow orchestration over queues', aws: 'Step Functions', gcp: 'Workflows / Cloud Composer', azure: 'Durable Functions / Logic Apps' },
  ],
}

export default messageQueues
