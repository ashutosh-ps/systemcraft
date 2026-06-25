import type { Module } from '../../../lib/types'

const distributedSystems: Module = {
  id: 'distributed-systems',
  category: 'advanced',
  title: 'Distributed Systems Concepts',
  description:
    'The mental models that separate senior engineers: partial failure, unreliable networks and clocks, the two generals problem, failure detection, split brain, and fencing tokens.',
  difficulty: 'Senior',
  estMinutes: 160,
  keywords: [
    'partial failure',
    'fallacies of distributed computing',
    'Lamport timestamps',
    'vector clocks',
    'fencing token',
    'split brain',
    'exponential backoff',
    'phi accrual',
  ],
  related: ['consensus', 'replication', 'sharding', 'scalability'],
  sections: [
    {
      type: 'text',
      title: 'Partial failure: the defining property',
      md: `
On a single machine, failure is honest: the process is running or it's dead. Distributed systems introduce something
qualitatively worse: **partial failure**. Node A is healthy, node B is healthy, and the link between them just
dropped your request. Or delivered it and lost the reply. Or delivered it 9 seconds late because a switch buffer
backed up.

Here's the insight to internalize: **you cannot distinguish a slow node, a dead node, and a partitioned network from
the outside.** All three look identical: silence. Every distributed algorithm, from TCP retransmission to Raft
elections, is downstream of this single epistemic limit.

Concrete consequence: you send a payment request and get no response within your 2-second timeout. Reality is one of:

1. The request never arrived. Safe to retry.
2. The request arrived, the payment **executed**, and the response was lost. Retry = double charge.
3. The node is alive but GC-paused or overloaded; it will process the request 11 seconds from now. Retry = double charge, *later*.

No amount of waiting resolves the ambiguity. Only design does: idempotent operations, reconciliation, or consensus
protocols that make ambiguity survivable.

Scale makes partial failure *constant* rather than exceptional. Google's published numbers for a new cluster's first
year: **~5 rack failures, ~3 router failures, ~1,000 individual machine failures, thousands of disk failures**. At
10,000 nodes, "something is broken" is the steady state, not an event.

> Senior-level framing: a distributed system isn't "many computers." It's a system that can be *partially wrong*
> about its own state, and every design decision is about bounding the cost of being wrong.
`,
    },
    {
      type: 'text',
      title: 'The 8 fallacies of distributed computing',
      md: `
Written down at Sun in 1994 and still the most efficient checklist for finding the bugs in a design:

1. **The network is reliable.** Packets drop. AWS publishes 99.99% availability for in-region connectivity, and that missing 0.01% is ~4.3 minutes/month of weirdness, *by SLA*.
2. **Latency is zero.** Same-rack RTT ~0.1 ms, same-AZ ~0.5 ms, cross-region (Virginia↔Frankfurt) ~90 ms. A chatty service making 50 sequential calls pays 50× the hop cost.
3. **Bandwidth is infinite.** A 10 Gbps NIC moves ~1.2 GB/s, so shuffling a 10 TB dataset across it takes 2.3 hours, ignoring everything else on the link.
4. **The network is secure.** Hence mTLS east-west, zero-trust designs, and why "it's internal" stopped being an excuse around 2014.
5. **Topology doesn't change.** Autoscaling, deploys, spot reclamation, and AZ failovers reshuffle who-talks-to-whom continuously. Hardcoded IPs are a time bomb; service discovery exists for this.
6. **There is one administrator.** Your dependency's maintenance window is not on your calendar.
7. **Transport cost is zero.** Cross-AZ traffic on AWS costs $0.01–0.02/GB; cross-region $0.02–0.09/GB. At petabyte scale, architecture diagrams have invoices attached.
8. **The network is homogeneous.** That one service still on HTTP/1.1 without keep-alive sets your tail latency.

Use them as a design review: walk a proposed architecture and ask which fallacy each arrow silently assumes.
Most "rare, weird" production incidents are fallacy #1 or #2 wearing a costume.
`,
    },
    {
      type: 'text',
      title: 'Timeouts, retries, backoff, and jitter',
      md: `
Since silence is ambiguous, **timeouts are a decision, not a discovery**. You're choosing how long to wait before
*acting as if* the peer failed. Too short: false positives, spurious retries, duplicated work. Too long: users wait
behind dead nodes. A defensible recipe: set the timeout near **p99.9 of observed latency** for that dependency
(e.g., p99.9 = 800 ms → timeout 1 s), and budget timeouts end-to-end so an outer 2 s timeout isn't waiting on an
inner 5 s one.

Retries are where well-meaning code creates outages:

- **Naive immediate retry** turns a brief blip into a sustained 2–3× load multiplier, exactly when the dependency is least able to absorb it. This is the classic **retry storm**.
- **Exponential backoff** (100 ms, 200 ms, 400 ms, 800 ms… capped at ~30 s) spreads recovery load over time.
- **Jitter** is the underrated half. If 10,000 clients all fail at the same instant and all back off deterministically, they all *return* at the same instant: synchronized waves, a thundering herd with a schedule. Randomizing each delay (AWS's "full jitter": sleep a uniform random amount between 0 and the exponential cap) decorrelates the herd. AWS's own analysis showed full jitter cut both contention and total completion time dramatically versus plain exponential backoff.

Two guardrails belong in every answer: a **retry budget** (e.g., retries may add at most 10% extra load; beyond
that, fail fast) and **circuit breakers** (after N consecutive failures, stop calling for a cool-off window, then
probe). And the prerequisite for *any* retry: the operation must be **idempotent**, because per the timeout
ambiguity above, you may be retrying something that already succeeded.
`,
    },
    {
      type: 'code',
      title: 'Retry with exponential backoff + full jitter',
      language: 'python',
      code: `
import random, time

BASE_DELAY  = 0.1     # 100 ms
MAX_DELAY   = 30.0    # cap; without it, attempt 12 would wait 7 minutes
MAX_RETRIES = 5

def call_with_retries(op, idempotency_key):
    """Retry an IDEMPOTENT operation. If op is not idempotent, a retry
    after an ambiguous timeout can double-execute it (see: two generals)."""
    for attempt in range(MAX_RETRIES + 1):
        try:
            return op(idempotency_key=idempotency_key,
                      timeout=1.0)            # ~p99.9 of this dependency
        except RetryableError as e:           # timeouts, 503s, conn resets
            if attempt == MAX_RETRIES:
                raise                          # surface it; don't retry forever
            if not retry_budget.try_acquire(): # cap retries at ~10% extra load
                raise                          # shed instead of storming

            # Exponential cap for this attempt: 0.1, 0.2, 0.4, 0.8, 1.6 ...
            cap = min(MAX_DELAY, BASE_DELAY * (2 ** attempt))

            # FULL JITTER: uniform in [0, cap]. Deterministic backoff makes
            # 10,000 clients that failed together RETRY together: same
            # thundering herd, on a schedule. Randomness decorrelates them.
            time.sleep(random.uniform(0, cap))

        except ClientError:
            raise   # 4xx: the request is wrong; retrying can't fix it

# Worth saying in an interview:
# - retry only retryable errors (timeout/503), never 4xx
# - same idempotency_key across attempts = "effectively once"
# - pair with a circuit breaker so a dead dependency isn't probed
#   by every request; let one canary probe per cool-off window
`,
    },
    {
      type: 'text',
      title: 'Time is a lie: physical and logical clocks',
      md: `
Every machine's quartz clock drifts, typically **~10–50 parts per million**, which compounds to roughly
**1–4 seconds per day** unsynchronized. NTP reins this in to **0.5–10 ms of error on a LAN** and **10–100 ms over
the public internet**, but NTP can also *step* a clock backward when correcting, so \`now()\` is not even monotonic.
Two timestamps from two machines that differ by 20 ms tell you nothing about which event happened first.

The classic casualty: **last-write-wins** conflict resolution. If node A's clock runs 30 ms ahead, A's *older* writes
beat B's *newer* ones: silent data loss with no error anywhere.

When ordering matters, use **logical clocks**, which track causality instead of wall time:

- **Lamport timestamps**: every node keeps a counter; increment on each local event, attach to every message, and on receive set \`counter = max(local, received) + 1\`. Guarantee: if A causally happened-before B, then \`L(A) < L(B)\`. Limitation: the converse fails. A smaller timestamp doesn't prove causality; two concurrent events still get ordered numbers (fine for deciding a total order, useless for detecting conflicts).
- **Vector clocks**: each node keeps a counter *per node* (a vector of N entries). Now comparison is informative: if every entry of V(A) ≤ V(B), A happened-before B; if neither dominates, the events were **concurrent**: a genuine conflict to surface or merge. Amazon's original Dynamo used vector clocks to detect conflicting shopping-cart writes. Cost: O(N) metadata per object.

The exotic third option is **bounded physical uncertainty**: Google Spanner's TrueTime (GPS + atomic clocks) exposes
time as an interval of **~1–7 ms uncertainty**, and Spanner *waits out* the interval before committing, buying
global strong consistency by literally sleeping ~7 ms. Knowing this exists (and what it costs) is the senior flex.
`,
    },
    {
      type: 'text',
      title: 'Two generals, heartbeats, and phi-accrual',
      md: `
#### The two generals problem

Two armies must attack together or lose; they coordinate by messenger across enemy ground where messengers vanish.
General A sends "attack at dawn" but cannot act without knowing B got it. So B sends an ack, but B can't be sure
*the ack* arrived, so B needs an ack-of-the-ack… The proof: **no finite protocol achieves certain agreement over an
unreliable channel.** This isn't a puzzle with a clever answer; it's an impossibility result. It's why exactly-once
delivery across system boundaries is a myth, and why real systems settle for at-least-once delivery plus idempotency,
making duplicates *harmless* instead of impossible.

#### Failure detection

Since you can't be certain, you guess, systematically. The baseline is the **heartbeat**: every node pings its peers
(or a coordinator) on an interval, typically **100 ms–1 s**, and a node is *suspected* dead after K missed beats
(e.g., 3 misses at 500 ms = flagged in 1.5 s). The tension: aggressive thresholds evict healthy-but-slow nodes (a 2 s
GC pause looks exactly like death), while lax ones leave you routing traffic at a corpse for 30 seconds.

**Phi-accrual failure detection** (used by Cassandra and Akka) replaces the binary alive/dead with a continuously
updated *suspicion level* φ, computed from the statistical distribution of recent heartbeat inter-arrival times. A
node whose heartbeats normally arrive every 500 ms ± 20 ms earns suspicion quickly when one is 2 s late; a node with
naturally jittery beats gets more slack. Consumers pick a φ threshold per use case. Cassandra defaults to
**φ = 8** (roughly "1-in-10⁸ chance this node is actually alive"). The deep point survives, though: every detector
on an asynchronous network is making a *probabilistic bet*, never a certain call.
`,
    },
    {
      type: 'text',
      title: 'Split brain and fencing tokens',
      md: `
**Split brain**: a partition (or a long GC pause) leaves *two* nodes each believing they're the leader, both
accepting writes. Reconciling two divergent "authoritative" histories afterward ranges from painful to impossible.
This is the failure mode that turns an outage into data loss.

Quorum-based leader election (Raft, ZooKeeper) prevents two *simultaneous legitimate* leaders: with 5 nodes, any
leader needs 3 votes, and two disjoint majorities can't exist. But quorums don't save you from the **zombie
leader**: a deposed leader that *doesn't know it's deposed*. The canonical sequence:

1. Leader A holds a lease/lock and is mid-write.
2. A stalls in a 15-second GC pause, real and documented in production (HBase hit exactly this with ZooKeeper locks).
3. A's lease expires; the cluster elects B. B starts writing.
4. A wakes, **still believing it holds the lock**, and fires its pending write, corrupting B's data.

Checking the lock before writing doesn't help: A checked before the pause; the network gives no take-backs.

The fix is **fencing tokens**: the lock service hands out a monotonically increasing number with every lock grant
(ZooKeeper's \`zxid\`, etcd's revision). Every write carries its token, and **the storage layer rejects any write
bearing a token lower than the highest it has seen**. A wakes and writes with token 33; storage has already seen B's
token 34; A's write bounces. Note the shift in trust: safety is enforced by the *resource*, not by the lock holder's
opinion of itself. Any design where correctness depends on a node's self-assessment of its own liveness is broken:
GC pauses, VM migrations, and packet delay all forge that self-assessment.
`,
    },
    {
      type: 'diagram',
      title: 'A partitioned cluster: zombie leader vs fencing token',
      caption:
        'A partition isolates the old leader N1 (minority side, left). The majority elects N3 with fencing token 34. When N1 retries its in-flight write with stale token 33, the storage layer rejects it: safety enforced at the resource, not by the nodes.',
      diagram: {
        height: 440,
        nodes: [
          {
            id: 'n1',
            label: 'Old Leader N1',
            kind: 'server',
            x: 110,
            y: 80,
            detail:
              'Minority side of the partition. Held the lease with fencing token 33; a 15 s GC pause plus the partition means it has not yet learned it was deposed. It will retry its in-flight write on wake.',
          },
          {
            id: 'n2',
            label: 'Follower N2',
            kind: 'server',
            x: 110,
            y: 230,
            detail:
              'Also stranded in the minority. With only 2 of 5 nodes reachable, this side cannot form a quorum (needs 3), so it can elect nothing and commits nothing. Unavailable but safe.',
          },
          {
            id: 'n3',
            label: 'New Leader N3',
            kind: 'server',
            x: 520,
            y: 60,
            detail:
              'Elected by the 3-node majority ~2 s after N1\'s heartbeats stopped (4 missed beats at 500 ms). Granted fencing token 34, strictly greater than every token issued before it.',
          },
          {
            id: 'n4',
            label: 'Follower N4',
            kind: 'server',
            x: 520,
            y: 210,
            detail:
              'Majority-side follower replicating from N3. Heartbeat interval 500 ms; suspicion threshold tuned so a normal 200 ms GC pause does not trigger a spurious election.',
          },
          {
            id: 'n5',
            label: 'Follower N5',
            kind: 'server',
            x: 520,
            y: 360,
            detail:
              'Third majority vote: the reason this side reaches quorum (3 of 5) and the minority side cannot. Clusters use odd sizes precisely so exactly one side of any partition can win.',
          },
          {
            id: 'storage',
            label: 'Shared Storage',
            kind: 'storage',
            x: 800,
            y: 210,
            w: 160,
            detail:
              'The fencing enforcement point. Tracks the highest token seen (34) and rejects any write with a lower one. N1\'s zombie write with token 33 is refused. Correctness no longer depends on N1 knowing it was deposed.',
          },
        ],
        edges: [
          { from: 'n1', to: 'n2', label: 'no quorum (2/5)', dashed: true },
          { from: 'n3', to: 'n4', label: 'replicate' },
          { from: 'n3', to: 'n5', label: 'heartbeat 500ms' },
          { from: 'n3', to: 'storage', label: 'write, token 34' },
          { from: 'n1', to: 'storage', label: 'token 33 ✗ rejected', dashed: true },
        ],
      },
    },
    {
      type: 'tradeoff',
      title: 'Partition hits: explore consistency vs availability',
    },
    {
      type: 'comparison',
      title: 'Ways to order events: physical vs logical time',
      comparison: {
        columns: ['Criterion', 'Wall clock (NTP)', 'Lamport timestamp', 'Vector clock', 'TrueTime (Spanner)'],
        rows: [
          ['What it gives you', 'Human-readable time, ±0.5–100 ms error', 'Total order consistent with causality', 'Causality + detects concurrent writes', 'Bounded uncertainty interval (~1–7 ms)'],
          ['Detects conflicts?', 'No, and LWW silently drops data', 'No; concurrent events still get ordered', 'Yes: neither vector dominates ⇒ concurrent', 'N/A: avoids conflicts by waiting out ε'],
          ['Metadata cost', 'One 8-byte timestamp', 'One integer', 'O(N): one counter per node', 'One interval; GPS + atomic clock hardware'],
          ['Monotonic?', 'No; NTP can step backward', 'Yes', 'Yes', 'Yes (within uncertainty bounds)'],
          ['Used by', 'Logs, TTLs, metrics (fine!)', 'Total-order broadcast, distributed locks', 'Dynamo-style stores, CRDT lineage', 'Spanner external consistency'],
        ],
        verdict:
          'Wall clocks are for humans and TTLs, never for ordering writes. Lamport when you need a total order; vector clocks when you must detect conflicts; TrueTime-style bounded uncertainty if you happen to own atomic clocks.',
      },
    },
    {
      type: 'keyNumbers',
      title: 'The numbers that drive timeout and threshold choices',
      numbers: [
        { metric: 'Same-AZ network RTT', value: '~0.5 ms', context: 'Same rack ~0.1 ms. The floor for every intra-DC hop.' },
        { metric: 'Cross-region RTT (US↔EU)', value: '~80–100 ms', context: 'US↔Asia ~150–250 ms. Physics; no vendor fixes this.' },
        { metric: 'Unsynced clock drift', value: '~1–4 s/day', context: '10–50 ppm quartz drift. Why NTP is mandatory, not optional.' },
        { metric: 'NTP sync error', value: '0.5–10 ms LAN, 10–100 ms WAN', context: 'Two "synchronized" machines can still disagree by more than a network RTT.' },
        { metric: 'Typical heartbeat interval', value: '100 ms – 1 s', context: 'With 3–4 missed beats before suspicion ⇒ detection in ~0.5–4 s.' },
        { metric: 'Cassandra phi threshold', value: 'φ = 8', context: 'Phi-accrual default: suspicion as a probability, not a binary.' },
        { metric: 'Stop-the-world GC pause', value: '100 ms – 15 s', context: 'The documented cause of zombie-leader incidents; the case for fencing tokens.' },
        { metric: 'Spanner TrueTime uncertainty', value: '~1–7 ms', context: 'Commit waits out the interval: global consistency bought with milliseconds.' },
      ],
    },
  ],
  quiz: [
    {
      question: 'Your service calls a dependency and the request times out. What do you actually know?',
      options: [
        'The dependency is down',
        'The request was never delivered',
        'Nothing definitive: the request may have failed, succeeded with a lost reply, or still be in flight on a slow node',
        'The network dropped the packet',
      ],
      answer: 2,
      explanation:
        'Silence is ambiguous between a dead node, a slow node, a lost request, and a lost reply. They are indistinguishable from outside. This is why retried operations must be idempotent.',
    },
    {
      question: 'Why add jitter to exponential backoff rather than using exact doubling delays?',
      options: [
        'Jitter makes individual retries complete faster',
        'It reduces the total number of retries needed',
        'It prevents the cap from being reached too early',
        'Clients that failed simultaneously would otherwise retry simultaneously, so jitter decorrelates the synchronized waves',
      ],
      answer: 3,
      explanation:
        'Deterministic backoff preserves the synchronization of a mass failure: 10,000 clients return at the same instants, hammering the recovering service in waves. Randomizing each delay spreads the load smoothly.',
    },
    {
      question: 'Node A\'s clock runs 30 ms ahead of node B. Under last-write-wins by wall-clock timestamp, what goes wrong?',
      options: [
        'Writes from A that are actually older can overwrite genuinely newer writes from B, causing silent data loss',
        'Nothing, as long as NTP runs on both nodes',
        'B\'s writes are rejected with a clock-skew error',
        'The system detects the conflict and keeps both versions',
      ],
      answer: 0,
      explanation:
        'LWW trusts timestamps to encode real order, but 30 ms of skew exceeds many write intervals, so A\'s stale write carries a "newer" timestamp and wins. No error is raised anywhere; the data is just gone. Vector clocks (or avoiding LWW) fix this.',
    },
    {
      question: 'A deposed leader wakes from a 15-second GC pause and issues a write it prepared before pausing. What actually prevents corruption?',
      options: [
        'The leader re-checks that it still holds the lock before writing',
        'The storage layer rejects the write because its fencing token is lower than the newest one it has seen',
        'Quorum election guarantees the old leader cannot send writes',
        'The heartbeat detector marks the node dead so its packets are dropped',
      ],
      answer: 1,
      explanation:
        'Re-checking the lock is racy (it can pause again right after checking), and election only prevents two simultaneous legitimate leaders, not a zombie that hasn\'t learned the news. Only enforcement at the resource, via monotonic fencing tokens, is airtight.',
    },
    {
      question: 'What does the two generals problem prove?',
      options: [
        'Consensus is impossible in asynchronous systems even without message loss',
        'Leader election requires an odd number of nodes',
        'Exactly-once message delivery requires vector clocks',
        'No finite protocol can guarantee agreement over a channel that may lose messages. Certainty is unachievable, so systems engineer around it with idempotency',
      ],
      answer: 3,
      explanation:
        'Each acknowledgment needs its own acknowledgment, forever. The practical translation: cross-system exactly-once delivery is impossible, so we use at-least-once plus idempotent handlers. (Impossibility without message loss is FLP, a different result.)',
    },
  ],
  interviewQuestions: [
    {
      question: 'A downstream service starts timing out intermittently. Walk me through how your client code should behave.',
      hint: 'Structure: timeout chosen from the dependency\'s latency distribution (~p99.9), retry only retryable errors with exponential backoff + full jitter, idempotency key so retries of ambiguous timeouts are safe, retry budget to cap amplification, circuit breaker after sustained failures, and graceful degradation (cached/default response) while open.',
      difficulty: 'Junior',
    },
    {
      question: 'Design a distributed lock for a job that must run on exactly one node at a time. What breaks it, and how do you fix it?',
      hint: 'Expected arc: lease-based lock in ZooKeeper/etcd with TTL; then attack it: clock skew on TTLs, GC pause creating a zombie holder, partition isolating the holder. The fix is fencing tokens enforced at the resource being protected, plus the honest concession: if the resource can\'t check tokens, "exactly one" degrades to "almost always one" and the job must be idempotent.',
      difficulty: 'Senior',
    },
    {
      question: 'Two datacenters both accept writes to the same user profile. How do you order or reconcile concurrent updates?',
      hint: 'Compare options with their failure modes: wall-clock LWW (silent loss under ~10–100 ms NTP skew), Lamport timestamps (total order but can\'t detect concurrency), vector clocks (detect conflicts, then merge, but with O(N) metadata and sibling explosion), CRDTs for mergeable types, or single-writer-per-key routing to dodge the problem. Strong answers pick per-field strategies.',
      difficulty: 'Senior',
    },
    {
      question: 'Your cluster\'s failure detector is flagging healthy nodes during deploys, triggering needless failovers. Tune it.',
      hint: 'Discuss the false-positive vs detection-latency dial: heartbeat interval and miss threshold math (500 ms × 3 misses = 1.5 s detection), why deploys/GC cause heartbeat gaps, phi-accrual as an adaptive alternative (suspicion from the observed inter-arrival distribution, Cassandra default φ=8), and operational fixes: drain before deploy, separate liveness from readiness.',
      difficulty: 'Mid',
    },
  ],
  commonMistakes: [
    'Retrying non-idempotent operations after a timeout. The timeout means "unknown outcome," not "failed." Without an idempotency key you are choosing duplicate side effects whenever the answer was actually "succeeded."',
    'Exponential backoff without jitter. Correlated failure produces correlated recovery: every client returns on the same schedule, and the thundering herd arrives in neat waves precisely as the dependency tries to recover.',
    'Ordering cross-node writes by wall-clock timestamps. NTP leaves 0.5–100 ms of disagreement and can step clocks backward; last-write-wins on skewed clocks silently discards newer data with no error to alert on.',
    'Trusting a lock holder\'s own belief that it holds the lock. GC pauses (observed up to 15 s in production) create zombie leaders; only fencing tokens checked at the storage/resource side make the stale writer harmless.',
    'Tuning failure detection for speed alone. A 1-beat miss threshold evicts every node that takes a 600 ms GC pause, and the resulting failover churn causes more downtime than the failures it was meant to catch.',
  ],
  cloudMappings: [
    { concept: 'Coordination / locks / leader election', aws: 'DynamoDB lock client / ZooKeeper on MSK', gcp: 'Firestore transactions / GKE etcd', azure: 'Cosmos DB / Service Fabric naming' },
    { concept: 'Consensus-backed config & service discovery', aws: 'Cloud Map / EKS etcd (managed)', gcp: 'GKE etcd / Service Directory', azure: 'AKS etcd / Azure App Configuration' },
    { concept: 'High-accuracy clock sync', aws: 'Time Sync Service (µs-level with PTP)', gcp: 'NTP + TrueTime (inside Spanner)', azure: 'Azure Time Sync (VMICTimeSync)' },
    { concept: 'Globally consistent database', aws: 'Aurora DSQL / DynamoDB (per-key)', gcp: 'Spanner (external consistency)', azure: 'Cosmos DB (5 consistency levels)' },
    { concept: 'Health checking & failover', aws: 'Route 53 health checks / ALB', gcp: 'Cloud Load Balancing health checks', azure: 'Traffic Manager / Front Door probes' },
    { concept: 'Retry/backoff + circuit breaking in the mesh', aws: 'App Mesh / SDK adaptive retry', gcp: 'Istio on GKE / client libraries', azure: 'Service Fabric / Istio on AKS' },
  ],
}

export default distributedSystems
