import type { Module } from '../../../lib/types'

const designNotifications: Module = {
  id: 'design-notifications',
  category: 'case-studies',
  title: 'Design a Real-time Notification System',
  description:
    'A multi-channel notification platform. Push, email, SMS, in-app. Handling 10M+ sends/day with idempotency (never double-send), per-user rate limits, preferences, retries with DLQs, and honest per-channel cost math.',
  difficulty: 'Mid',
  estMinutes: 150,
  keywords: ['push notifications', 'APNs', 'FCM', 'idempotency', 'dead letter queue', 'webhooks', 'fan-out', 'digest batching'],
  related: ['message-queues', 'realtime-systems', 'design-instagram', 'api-design'],
  sections: [
    {
      type: 'text',
      title: 'Step 1: Requirements clarification',
      md: `
"Design a notification system" is deliberately vague. Scope it before you draw anything.

#### Functional requirements

- **Multi-channel delivery**: mobile push (APNs/FCM), email, SMS, and in-app (badge/inbox via WebSocket).
- **Producers are internal services**: orders, social, marketing, security. They call one API; they should *not* know about channels.
- **User preferences & opt-outs**: per-category, per-channel ("order updates: push yes, email no"), plus legal opt-outs (CAN-SPAM/TCPA. Unsubscribing must actually work).
- **Templates**: producers send event data; the system renders localized content per channel.
- **Scheduling & digests**: "send at 9am local", and batching ("12 people liked your post" instead of 12 pings).

#### Explicit scope cuts

- ❌ Building an email server. We use SES/SendGrid; same for SMS (Twilio).
- ❌ The marketing campaign authoring UI; we expose the send API it would call.

#### Non-functional requirements

- **Scale**: 10M+ notifications/day baseline (~120/sec average). But bursts are the real problem: a marketing blast or a breaking-news event can demand **10K–50K sends/sec** for minutes.
- **At-least-once delivery with dedup**, which means **idempotency end to end: never double-send**. A duplicate "your payment failed" SMS is a support ticket; a duplicate OTP is a security smell.
- **Latency tiers**: OTP/security ≤ 5 s; transactional ≤ 30 s; marketing can wait minutes. Priority must be explicit in the system.
- **No notification silently lost**: failed sends are retried, then parked in a DLQ with alerting. Never dropped on the floor.
`,
    },
    {
      type: 'code',
      title: 'Step 2: Capacity estimation',
      language: 'python',
      code: `
# ---- Volume (state assumptions out loud) ----
notifications_per_day = 10_000_000
SECONDS_PER_DAY       = 86_400

avg_rate  = notifications_per_day / SECONDS_PER_DAY    # ~120/sec
peak_rate = avg_rate * 5                               # ~600/sec organic peak

# The sizing case is NOT the average - it's the burst:
# a marketing blast to 5M users "now", or a security incident.
blast_users   = 5_000_000
blast_window  = 10 * 60                                # acceptable: 10 minutes
blast_rate    = blast_users / blast_window             # ~8,300/sec
# => Design ingestion + queue for ~10K msg/sec sustained bursts.
# Kafka does this on a 3-broker cluster without blinking;
# the REAL constraints are downstream provider limits:
#   APNs/FCM: effectively unlimited (batch HTTP/2 streams)
#   SES:      default ~14 msg/sec, raisable to thousands
#   Twilio:   ~1 msg/sec per long-code number; short code ~100/sec
# => per-channel worker pools with PER-PROVIDER rate limiting.

# ---- Channel mix (typical) ----
mix = {"push": 0.60, "in_app": 0.25, "email": 0.12, "sms": 0.03}

# ---- Daily cost (why the mix looks like that) ----
push_cost  = 0.60 * notifications_per_day * 0.0          # $0 - APNs/FCM are free
email_cost = 0.12 * notifications_per_day * (0.10/1000)  # ~$120/day (SES $0.10/1K)
sms_cost   = 0.03 * notifications_per_day * 0.0075       # ~$2,250/day (Twilio US)
# SMS is 3% of volume but ~95% of spend -> reserve it for OTP/critical.

# ---- Storage: delivery tracking ----
row_size   = 1_000        # id, user, channel, status timeline, provider ids
per_day    = notifications_per_day * row_size            # ~10 GB/day
per_year   = per_day * 365                               # ~3.7 TB/year
# Keep 90 days hot (~0.9 TB), archive the rest to object storage.

# ---- Dedup store ----
# idempotency keys with a 24h TTL in Redis:
dedup_keys = notifications_per_day * 1.2                 # retries inflate ~20%
dedup_mem  = dedup_keys * 100                            # ~1.2 GB - tiny. No excuse
                                                         # to skip idempotency.
`,
    },
    {
      type: 'calculator',
      title: 'Try it: estimate the notification QPS',
      calculator: 'qps',
    },
    {
      type: 'diagram',
      title: 'Step 3: High-level architecture',
      caption:
        'Producers fire events at one ingestion API; Kafka decouples bursts from delivery; per-channel workers respect provider rate limits; every state change lands in the tracking DB.',
      diagram: {
        height: 520,
        nodes: [
          { id: 'sources', label: 'Event Sources', kind: 'external', x: 30, y: 240, detail: 'Internal services: orders, social, security, marketing. They call notify(user, event, payload) with an idempotency key, and know nothing about channels, templates, or providers.' },
          { id: 'ingest', label: 'Ingestion API', kind: 'server', x: 215, y: 240, detail: 'Validates, dedups against Redis (24h idempotency keys), resolves user preferences + opt-outs, expands one event into per-channel tasks, and publishes to Kafka. Returns 202 in ~10 ms.' },
          { id: 'kafka', label: 'Kafka', kind: 'queue', x: 410, y: 160, detail: 'Topics per channel × priority (push.critical, email.bulk, ...). Absorbs 10K+/sec blasts while workers drain at provider-safe rates. 7-day retention enables replay after worker bugs.' },
          { id: 'tracking', label: 'Tracking DB', kind: 'db', x: 410, y: 400, detail: 'Cassandra/DynamoDB: one row per notification with status timeline (queued → sent → delivered/failed/bounced). ~10 GB/day; powers "was it sent?" support queries and per-channel SLO dashboards.' },
          { id: 'pushw', label: 'Push Workers', kind: 'service', x: 605, y: 50, detail: 'Render template, look up device tokens (a user may have 3 devices), send via HTTP/2 multiplexed streams. Handle token feedback: APNs 410 Unregistered → delete token, stop sending.' },
          { id: 'emailw', label: 'Email Workers', kind: 'service', x: 605, y: 170, detail: 'Render MJML/HTML templates, throttle to the SES quota, process bounce/complaint webhooks back into the tracking DB. Hard bounce → suppress address permanently.' },
          { id: 'smsw', label: 'SMS Workers', kind: 'service', x: 605, y: 290, detail: 'Most rate-constrained channel: ~1 msg/sec per long code, ~100/sec per short code. Worker pool enforces per-number token buckets and spreads bulk sends across the number pool.' },
          { id: 'wsgw', label: 'WS Gateway', kind: 'server', x: 605, y: 410, detail: 'Holds persistent WebSocket connections (~100K-1M per node is achievable; plan ~100K/node). Online users get in-app notifications in <100 ms; offline users read from the inbox table on next open.' },
          { id: 'apns', label: 'APNs / FCM', kind: 'external', x: 820, y: 110, detail: 'Apple/Google push services. Free, p50 delivery ~0.5-2 s to a reachable device. Best-effort: a powered-off phone gets the latest push only when it reconnects.' },
          { id: 'providers', label: 'SES / Twilio', kind: 'external', x: 820, y: 290, detail: 'Email: SES at ~$0.10/1K. SMS: Twilio at ~$0.0075-0.008/msg (US). Both return provider message IDs + status webhooks that feed delivery tracking.' },
        ],
        edges: [
          { from: 'sources', to: 'ingest', label: 'POST /notify' },
          { from: 'ingest', to: 'kafka', label: 'per-channel tasks' },
          { from: 'ingest', to: 'tracking', label: 'status=queued', dashed: true },
          { from: 'kafka', to: 'pushw' },
          { from: 'kafka', to: 'emailw' },
          { from: 'kafka', to: 'smsw' },
          { from: 'kafka', to: 'wsgw', label: 'in-app' },
          { from: 'pushw', to: 'apns', label: 'HTTP/2' },
          { from: 'emailw', to: 'providers', label: 'SES API' },
          { from: 'smsw', to: 'providers', label: 'Twilio API' },
          { from: 'emailw', to: 'tracking', label: 'status + webhooks', dashed: true },
          { from: 'wsgw', to: 'tracking', dashed: true },
        ],
      },
    },
    {
      type: 'text',
      title: 'Deep dive: idempotency (never double-send)',
      md: `
At-least-once delivery is the only honest guarantee a queue gives you, so **duplicates are guaranteed by design**. A producer retries a timed-out API call, a worker crashes after sending but before committing its offset, Kafka
redelivers. The system must make duplicates harmless at two layers:

#### Layer 1: producer idempotency keys

Every \`POST /notify\` carries a caller-supplied key, e.g. \`order-shipped:order-58471\`. Ingestion does
\`SET key NX EX 86400\` in Redis (~1 ms): first writer wins, replays get \`409 already accepted\`. The key encodes
*business intent* (the shipped-notification for order 58471), so an order service that crashes and re-emits the
event cannot create a second send. ~1.2 GB of Redis covers a full day of keys; there is no cost excuse to skip this.

#### Layer 2: worker send-dedup

The dangerous window: worker sends to APNs → crashes → never commits the Kafka offset → another worker re-reads the
message. Guard the actual provider call with a second key (\`send:{notification_id}:{channel}\`) set **before**
dispatch, with a short TTL and a *sending* state. On redelivery, the second worker sees the in-flight/sent marker and
verifies status instead of re-sending. This narrows exactly-once to "exactly-once *effect*", the standard and achievable
target.

Practical details that earn points:

- TTL the keys (24 h). An idempotency store that grows forever is an outage scheduled for later.
- Scope keys per channel: a failed email retry must not be blocked by a successful push under the same event.
- **Beware retrying on ambiguous provider errors**: a Twilio timeout may still have sent the SMS. Record the provider message ID, and reconcile via status webhooks before re-dispatching.
`,
    },
    {
      type: 'text',
      title: 'Deep dive: preference resolution and template rendering',
      md: `
#### Preference resolution: the policy gate

Between "event accepted" and "task enqueued" sits a pure function worth designing explicitly:

\`resolve(user, category, urgency) → [channels to send]\`

It evaluates, in order: **legal opt-outs** (unsubscribed email, STOP'd SMS; non-negotiable, checked against a
suppression list), **user preferences** (per category × channel matrix), **channel viability** (no device token →
no push; hard-bounced address → no email), **quiet hours** (hold non-critical sends 22:00–08:00 *in the user's
timezone*), and **rate limits / digest rules**. Security notifications (OTP, password reset) bypass preferences and
quiet hours, but never legal opt-outs for the channel.

Cache the resolved preference blob in Redis (~1 KB/user, TTL minutes, invalidated on settings change): at 10K/sec
burst you cannot afford a DB read per notification.

#### Template rendering: content lives in the system, not in producers

Producers send structured data (\`{order_id, eta}\`), not prose. A versioned template store renders per channel:
push (≤ ~178 chars visible; APNs payload cap 4 KB), email (full HTML + plain-text part), SMS (160 GSM-7 chars per
segment; a 161-char message **bills as two segments**, so truncate deliberately), in-app (rich JSON). Localization
picks the user's locale with a fallback chain (\`de-AT → de → en\`).

Render at *send time* in the channel worker, not at ingestion: a template fix then applies to everything still in
the queue, and you never store 10M copies of the same prose.
`,
    },
    {
      type: 'text',
      title: 'Deep dive: retries, DLQs, and digest batching',
      md: `
#### Retry with exponential backoff + jitter

Providers fail transiently all the time (APNs hiccups, SES throttles, Twilio 429s). The worker retry policy:

- Retry only **retryable** errors (timeouts, 429/5xx). Permanent failures (invalid token, hard bounce, opted-out number) must **not** retry; they trigger cleanup (delete token, suppress address).
- Schedule: 1 s → 4 s → 16 s → 64 s → 4 min, with **full jitter** so 50K failures from one provider blip don't re-arrive as one synchronized wave.
- Respect per-message **TTLs by priority**: an OTP older than 5 minutes is worse than no OTP. Drop it. A digest can retry for hours.

#### Dead-letter queue

After max attempts, park the message in a **DLQ** with its full context and last error. The DLQ is a product surface,
not a trash can: alert when depth > 0 for critical topics, build a redrive tool (fix the bug, replay the DLQ), and
review its contents. A DLQ full of \`410 Unregistered\` means your token hygiene is broken, not your network.

#### Digest batching

40 likes in an hour must not equal 40 pushes. Over-notification is the #1 cause of opt-outs (and each push opt-out
permanently closes your cheapest channel). For low-urgency categories, write events into a per-user **pending buffer**
instead of sending; a scheduler flushes it on a trigger: a count threshold (10 events), a time window (hourly), or smart
timing (the user's historically active hour). One rendered notification: **"Anna and 39 others liked your post."**
Transactional and security events always bypass the buffer.
`,
    },
    {
      type: 'comparison',
      title: 'Delivery channels compared',
      comparison: {
        columns: ['Criterion', 'Mobile push (APNs/FCM)', 'Email (SES)', 'SMS (Twilio)', 'In-app (WebSocket)'],
        rows: [
          ['Marginal cost', '~$0 (free APIs)', '~$0.10 per 1,000', '~$0.0075/msg US. 75× email', '~$0 (your infra only)'],
          ['Typical latency', 'p50 ~0.5–2 s to reachable device', 'Seconds to deliver; opens take hours', 'p50 ~2–5 s', '<100 ms if connected'],
          ['Delivery guarantee', 'Best-effort; device may be off', 'High to inbox; ~10–20% lands in spam/promo tabs', 'Highest reach. Works on feature phones', 'Only while app is open'],
          ['Reach constraint', 'Requires app install + opt-in (~50–60% of iOS users allow)', 'Requires verified address', 'Requires phone number; carrier filtering', 'Requires active session'],
          ['Engagement', 'CTR ~2–10%, seen in minutes', 'Open rate ~20%, slow', 'Open rate ~95%+ within 3 min', 'High, but only for online users'],
          ['Best for', 'Default channel for everything', 'Receipts, digests, long content', 'OTP, fraud alerts, critical only', 'Badges, counters, live updates'],
        ],
        verdict:
          'Route by urgency and cost: in-app + push as the free defaults, email for content that keeps, SMS reserved for OTP/critical. It is 3% of volume and ~95% of channel spend.',
      },
    },
    {
      type: 'beforeAfter',
      title: 'Case: from synchronous sends to a queued pipeline',
      scenario: {
        beforeTitle: 'Each service calls providers synchronously',
        beforeDescription:
          'The order service calls SES and Twilio inline during checkout. A 30 s SES brownout stalls checkout threads; a marketing blast from a cron job tramples Twilio rate limits and drops OTPs; retries after timeouts double-send payment alerts. No record of what was actually delivered.',
        afterTitle: 'One ingestion API → Kafka → rate-limited channel workers',
        afterDescription:
          'Producers fire-and-forget with idempotency keys (202 in ~10 ms). Kafka absorbs 10K/sec bursts; per-provider token buckets protect quotas; priority topics keep OTPs ahead of marketing; retries with jitter + DLQ make failures visible instead of silent. Cost: a queue, a worker fleet, and a tracking DB to operate.',
        metrics: [
          { label: 'Checkout p99 (notification path)', before: '+1,800 ms inline provider calls', after: '+10 ms (enqueue only)', improved: true },
          { label: 'Delivery success', before: '~97% (silent drops on failures)', after: '99.9% (retries + DLQ redrive)', improved: true },
          { label: 'Duplicate sends', before: '~0.5% on provider timeouts', after: '~0% (two-layer idempotency)', improved: true },
          { label: 'OTP latency during marketing blast', before: 'Minutes (one shared path)', after: '<5 s (priority topics)', improved: true },
          { label: 'Moving parts to operate', before: 'None beyond provider SDKs', after: 'Kafka + workers + Redis + tracking DB', improved: false },
        ],
      },
    },
    {
      type: 'text',
      title: 'Step 7: Rate limiting and quiet hours',
      md: `
The system's job is not "send everything". It's "send what helps, when it helps." Two guardrails:

#### Per-user rate limiting

Cap notifications per user per channel per window. E.g. **max 5 pushes/day** for non-critical categories, 2 marketing
emails/week. Implement as a Redis sliding-window or token-bucket counter (\`INCR\` + \`EXPIRE\`, ~1 ms) checked during
preference resolution. When over limit: **downgrade, don't drop**. Overflow goes to the in-app inbox, optionally
folded into the next digest. Critical/security traffic is exempt by category, never by caller request (otherwise every
team declares itself critical within a quarter).

This protects users from you, and you from yourself: industry data consistently shows push opt-out spikes after
notification-heavy weeks, and **~60% of users disable push within months** for over-notifying apps. Each opt-out
permanently closes your free channel and pushes you toward $0.0075 SMS.

#### Quiet hours

Hold non-critical sends during the user's local night (default 22:00–08:00, user-overridable). Two non-obvious
requirements: store and resolve the **user's timezone** (a 03:00 UTC send is 19:00 in California and 04:00 in Berlin, so it is per-user, not per-region), and on release, **smear** the held queue over 15–30 minutes instead of firing the whole
night's backlog at 08:00:00. That morning spike looks exactly like a self-inflicted DDoS to your own workers and to
provider rate limits.

> Close with the metric that ties it together: track opt-out rate per category as a first-class SLO. A notification
> system optimizing only deliveries races to the bottom.
`,
    },
    {
      type: 'keyNumbers',
      title: 'Numbers to anchor the interview',
      numbers: [
        { metric: 'Baseline vs burst throughput', value: '120/sec → 10K+/sec', context: '10M/day averages tiny; marketing blasts and incidents set the real capacity bar.' },
        { metric: 'Push delivery latency', value: 'p50 ~0.5–2 s', context: 'APNs/FCM to a reachable device; the API itself is free.' },
        { metric: 'SMS cost (US, Twilio)', value: '~$0.0075/msg', context: '75× the cost of email per message; ~1 msg/sec per long-code number. Reserve for OTP/critical.' },
        { metric: 'Email cost (SES)', value: '~$0.10 per 1,000', context: 'Cheap at any volume; the real risks are spam-folder placement and bounce hygiene.' },
        { metric: 'Push opt-in reality', value: '~50–60% on iOS', context: 'Opt-in must be earned, and over-notifying burns it. Opt-outs permanently close the free channel.' },
        { metric: 'Idempotency overhead', value: '~1.2 GB Redis/day', context: '24h-TTL keys for 10M+ sends. Protection against double-sends costs almost nothing.' },
      ],
    },
  ],
  quiz: [
    {
      question: 'A worker sends a push notification, then crashes before committing its Kafka offset. Without further safeguards, what happens?',
      options: [
        'The notification is lost forever',
        'Kafka detects the duplicate and suppresses it',
        'Another worker re-reads the message and the user gets the push twice',
        'APNs deduplicates identical payloads automatically',
      ],
      answer: 2,
      explanation:
        'Uncommitted offsets are redelivered. That is at-least-once semantics doing its job. A send-scoped idempotency key set before the provider call is what turns redelivery into a harmless no-op.',
    },
    {
      question: 'Why route SMS through priority-separated queues with per-number rate limiting?',
      options: [
        'SMS messages are larger than push payloads',
        'A long-code number sends ~1 msg/sec, so a 5M-recipient blast would otherwise starve OTPs for days',
        'Twilio requires Kafka specifically',
        'SMS is the cheapest channel so it gets the most traffic',
      ],
      answer: 1,
      explanation:
        'SMS is the most rate-constrained channel (~1/sec per long code, ~100/sec per short code). Without priority lanes and per-number token buckets, bulk traffic queues critical OTPs behind it.',
    },
    {
      question: 'Which failure should NOT be retried?',
      options: [
        'APNs returns 410 Unregistered for a device token',
        'SES returns a 429 throttling error',
        'A timeout while calling Twilio',
        'A Kafka consumer rebalance interrupts the worker',
      ],
      answer: 0,
      explanation:
        '410 means the token is permanently dead (app uninstalled). The correct action is deleting the token, not retrying. Throttles and timeouts are transient; note the timeout case also needs reconciliation since the SMS may have actually sent.',
    },
    {
      question: 'The main reason to batch low-urgency events into digests ("Anna and 39 others liked your post") is…',
      options: [
        'It reduces Kafka storage costs',
        'Templates render faster in batches',
        'APNs rejects more than 10 notifications per user per hour',
        'Over-notification drives opt-outs, which permanently close your cheapest channel',
      ],
      answer: 3,
      explanation:
        'Push is free and effective only while users keep it enabled; notification fatigue is the top driver of opt-outs. Digests cut volume drastically while preserving the information.',
    },
    {
      question: 'Quiet hours end at 08:00 local. The correct way to release the held notifications is…',
      options: [
        'Send them all at exactly 08:00:00',
        'Smear them over 15–30 minutes to avoid spiking your workers and provider rate limits',
        'Drop them, since they are stale',
        'Convert them all to email instead',
      ],
      answer: 1,
      explanation:
        'Releasing a night\'s backlog at one instant is a self-inflicted thundering herd. It slams your worker fleet and provider quotas. Smearing (with priority ordering) delivers the same content safely.',
    },
  ],
  interviewQuestions: [
    {
      question: 'A user says "I never got my password-reset email." Walk me through how you debug it.',
      hint: 'This is what the tracking DB exists for: look up the notification by user + category, follow the status timeline (queued → sent → provider message ID → bounce/complaint webhook?), check the suppression list and spam placement. If status is missing at ingestion, check the producer\'s idempotency key for a 409.',
      difficulty: 'Junior',
    },
    {
      question: 'How do you guarantee an OTP arrives within 5 seconds while a 5M-user marketing blast is in flight?',
      hint: 'Isolation at every layer: separate Kafka topics per priority, dedicated worker pools (bulkheads), per-provider quota partitioning (reserve short-code capacity for OTP), and TTLs that drop stale OTPs rather than deliver them late. One shared queue makes the SLA impossible.',
      difficulty: 'Mid',
    },
    {
      question: 'Design the in-app channel: how do 50M online users get sub-second notifications?',
      hint: 'WebSocket gateway fleet (~100K connections/node → ~500 nodes), a connection registry (user → gateway node) in Redis, pub/sub or direct routing from workers to the right gateway, heartbeats + reconnect with resume tokens, and an inbox table as the source of truth so offline users catch up on open.',
      difficulty: 'Senior',
    },
    {
      question: 'Marketing wants "exactly-once" delivery guarantees in the SLA. What do you actually commit to?',
      hint: 'Exactly-once delivery over lossy networks is impossible. Commit to at-least-once transport with exactly-once *effect* via two-layer idempotency, quantified as a duplicate rate (e.g. <0.01%) and a delivery success SLO (99.9% within channel latency tiers). Explain the ambiguous-timeout case as the irreducible residual.',
      difficulty: 'Senior',
    },
  ],
  commonMistakes: [
    'Designing for the 120/sec average instead of the 10K/sec blast. The queue exists precisely because notification traffic is the spikiest workload most companies run.',
    'One shared queue for all channels and priorities. A marketing campaign then delays OTPs by minutes. Priority topics and bulkheaded worker pools are table stakes.',
    'Retrying everything. Retrying a 410 Unregistered token or a hard-bounced address wastes capacity and wrecks sender reputation; permanent failures need cleanup, not persistence.',
    'Skipping idempotency because "duplicates are rare." At-least-once delivery makes them structurally guaranteed, and the fix costs ~1 GB of Redis. Double-sent payment alerts erode trust permanently.',
    'Treating opt-outs as someone else\'s problem. Ignoring digests, rate limits, and quiet hours drives push opt-out, which closes your free channel and converts your traffic to $0.0075 SMS.',
  ],
  cloudMappings: [
    { concept: 'Event ingestion queue', aws: 'MSK (Kafka) / SQS + SNS', gcp: 'Pub/Sub', azure: 'Event Hubs / Service Bus' },
    { concept: 'Mobile push delivery', aws: 'SNS Mobile Push (APNs/FCM)', gcp: 'Firebase Cloud Messaging', azure: 'Notification Hubs' },
    { concept: 'Transactional email', aws: 'SES', gcp: 'SendGrid (partner)', azure: 'Azure Communication Services Email' },
    { concept: 'SMS delivery', aws: 'SNS SMS / Pinpoint', gcp: 'Twilio (partner)', azure: 'Communication Services SMS' },
    { concept: 'Delivery tracking store', aws: 'DynamoDB', gcp: 'Bigtable / Firestore', azure: 'Cosmos DB' },
    { concept: 'Idempotency / rate-limit store', aws: 'ElastiCache (Redis)', gcp: 'Memorystore', azure: 'Azure Cache for Redis' },
  ],
}

export default designNotifications
