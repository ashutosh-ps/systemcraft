import type { Module } from '../../../lib/types'

const consensus: Module = {
  id: 'consensus',
  category: 'advanced',
  title: 'Consensus: Raft & Paxos, Simplified',
  description:
    'How a cluster of unreliable machines agrees on one truth. Raft leader election and log replication explained properly, Paxos demystified, and why you should rent consensus from etcd instead of building it.',
  difficulty: 'Senior',
  estMinutes: 170,
  keywords: [
    'Raft',
    'Paxos',
    'leader election',
    'quorum',
    'log replication',
    'etcd',
    'ZooKeeper',
    'split vote',
  ],
  related: ['distributed-systems', 'replication', 'sharding'],
  sections: [
    {
      type: 'text',
      title: 'Why consensus exists',
      md: `
Plenty of distributed problems reduce to one primitive: **get N machines to agree on a value, or a sequence of
values (a log), even while some of them crash or the network drops messages.** Who is the primary database right
now? Did this configuration change commit? Which node holds the lock? Get any of these wrong and you get two
primaries accepting conflicting writes (split-brain), or a committed transaction that quietly evaporates.

A correct consensus protocol guarantees:

- **Agreement**: no two nodes ever decide different values for the same slot.
- **Validity**: the decided value was actually proposed by someone.
- **Termination**: nodes eventually decide (this is the hard one).

Why hard? Because in a real network you **cannot distinguish a crashed node from a slow one**. A heartbeat that
hasn't arrived in 200 ms might mean death, a GC pause, or a congested switch. The **FLP impossibility result**
(Fischer, Lynch, Paterson, 1985) makes this rigorous: in a fully asynchronous system, *no deterministic protocol
can guarantee consensus terminates* if even one process may crash. There is always a schedule of message delays
that stalls the decision forever. Practical systems don't refute FLP; they sidestep it by assuming *partial
synchrony* (timeouts are usually right) and adding **randomness** (Raft's randomized election timers), accepting
that liveness may be delayed during pathological network weather, while **safety is never violated**.

> That sentence is the whole game: consensus protocols may pause, but they must never disagree.
`,
    },
    {
      type: 'text',
      title: 'Quorums: why clusters have odd sizes',
      md: `
The mechanism underneath every consensus protocol is the **majority quorum**. A cluster of **2f + 1** nodes
tolerates **f** failures, because any two majorities must overlap in at least one node. Any new decision is
therefore guaranteed to "see" every previous decision through that overlapping member.

| Cluster size | Quorum | Failures tolerated |
|---|---|---|
| 3 | 2 | 1 |
| 4 | 3 | 1 |
| 5 | 3 | 2 |
| 7 | 4 | 3 |

Two practical consequences:

- **Even sizes are pointless.** 4 nodes need a quorum of 3 and still tolerate only 1 failure, the same as 3 nodes, with more machines to operate and more network chatter. Run 3 or 5; run 5 if you want to survive one planned maintenance *plus* one surprise failure.
- **Bigger isn't better.** Every write must reach a majority, so a 7-node cluster commits more slowly than a 3-node one (more replication fan-out, slower tail). etcd's docs recommend **max 7 members**; Google's Chubby ran 5 for years. You scale consensus *reads* with followers or learners, never writes.

Quorum overlap is also why a partitioned minority goes read-only or fully silent: 2 nodes of a 5-node cluster
cannot form a majority, so they can neither elect a leader nor commit. Annoying, but it's exactly what prevents
two halves of the cluster from diverging.
`,
    },
    {
      type: 'text',
      title: 'Raft I: leader election',
      md: `
Raft (Ongaro & Ousterhout, 2014) was explicitly designed to be *understandable*. It decomposes consensus into
**leader election**, **log replication**, and **safety rules**. All client writes flow through a single leader,
which serializes them into a log and replicates it.

#### Terms: logical time

Time divides into numbered **terms**. Each term has at most one leader. Every message carries the sender's term;
a node that sees a higher term immediately updates its own and steps down to follower. Terms are how Raft detects
and neutralizes stale leaders: an old leader returning from a GC pause finds the world at term 8 while it's
still at term 5, and demotes itself.

#### The election

1. Followers expect heartbeats from the leader every ~50–100 ms. Each follower has an **election timeout randomized in roughly the 150–300 ms range**.
2. A follower whose timeout fires without hearing a heartbeat increments its term, becomes a **candidate**, votes for itself, and sends \`RequestVote\` to everyone.
3. Each node grants **at most one vote per term** (persisted to disk, since voting twice would allow two leaders), and only to candidates whose log is **at least as up-to-date** as its own.
4. Majority of votes → leader; starts sending heartbeats. A vote split (two candidates, neither with a majority) just times out and retries, and because the timeouts are *randomized*, a repeat collision is unlikely. This randomness is Raft's pragmatic answer to FLP.

A failed leader is typically replaced within one election timeout plus one round trip, **under a second**, and
commonly ~200–400 ms with default tunings.
`,
    },
    {
      type: 'diagram',
      title: 'A 5-node Raft cluster replicating an entry',
      caption:
        'Term 5: the leader appends a client write to its log and replicates via AppendEntries. The entry commits the moment 3 of 5 logs contain it. S5 being down does not block progress.',
      diagram: {
        height: 470,
        nodes: [
          {
            id: 'app',
            label: 'Client (etcd API)',
            kind: 'service',
            x: 30,
            y: 205,
            detail:
              'A service writing config or acquiring a lock. All writes go to the leader; followers redirect. Expect ~1-3 ms commit latency in-AZ, since commit costs one round trip to a majority.',
          },
          {
            id: 's1',
            label: 'S1 · Leader t=5',
            kind: 'server',
            x: 300,
            y: 205,
            detail:
              'Won the term-5 election with votes from S2 and S3 (3/5 including itself). Appends the write at log index 12, fans out AppendEntries, and commits once 2 followers ack: quorum of 3 reached.',
          },
          {
            id: 's2',
            label: 'S2 · Follower',
            kind: 'server',
            x: 620,
            y: 20,
            detail:
              'Log matches the leader through index 12. Acks AppendEntries in ~0.5 ms in-AZ. Its ack (plus the leader) makes 2 of the 3 needed for commit.',
          },
          {
            id: 's3',
            label: 'S3 · Follower',
            kind: 'server',
            x: 620,
            y: 140,
            detail:
              'Third member of the commit quorum. Resets its randomized election timeout (150-300 ms) every time a heartbeat or entry arrives, so it never starts a rival election while the leader is healthy.',
          },
          {
            id: 's4',
            label: 'S4 · Follower',
            kind: 'server',
            x: 620,
            y: 260,
            detail:
              'Slightly behind at index 10. The leader tracks per-follower nextIndex and backs up until logs match, then streams the missing entries 11-12. Commit never waits for stragglers.',
          },
          {
            id: 's5',
            label: 'S5 · down',
            kind: 'server',
            x: 620,
            y: 380,
            detail:
              'Crashed 30 s ago. A 5-node cluster tolerates 2 such failures. On restart it rejoins at term 5, and the leader replays everything it missed from its log.',
          },
          {
            id: 'sm',
            label: 'State machine',
            kind: 'db',
            x: 850,
            y: 140,
            detail:
              'Once an entry commits, every node applies it to its local key-value store in log order. Identical logs + deterministic apply = identical state on all nodes (replicated state machine).',
          },
        ],
        edges: [
          { from: 'app', to: 's1', label: 'PUT /config' },
          { from: 's1', to: 's2', label: 'AppendEntries', bidirectional: true },
          { from: 's1', to: 's3', label: 'AppendEntries', bidirectional: true },
          { from: 's1', to: 's4', label: 'backfill 11-12' },
          { from: 's1', to: 's5', label: 'retry (no ack)', dashed: true },
          { from: 's3', to: 'sm', label: 'apply committed' },
        ],
      },
    },
    {
      type: 'text',
      title: 'Raft II: log replication and commit rules',
      md: `
#### The replicated log

The leader appends each client command to its log as \`(term, index, command)\` and ships it to followers via
**AppendEntries**. Each RPC carries the *previous* entry's index and term; a follower rejects the append if its
own log doesn't match at that position. This consistency check gives Raft its key invariant: **if two logs agree
on an entry's index and term, they agree on everything before it.** When a follower diverges (it accepted entries
from a deposed leader), the leader walks back \`nextIndex\` until the logs match, then overwrites the follower's
conflicting suffix. Uncommitted entries are disposable; committed ones never conflict.

#### When is an entry committed?

An entry is **committed** once the leader knows it's replicated on a **majority**. At that point it survives any
f failures, and the leader applies it and answers the client. One subtlety worth knowing for interviews: a leader
only commits entries **from its own term** directly; older-term entries commit implicitly when a current-term
entry on top of them commits (Raft paper §5.4.2; skipping this rule allows a committed entry to be lost).

#### Leader crash, replayed

1. Leader S1 dies mid-replication. Followers stop receiving heartbeats.
2. First timeout fires (150–300 ms later); say S3 stands for election at term 6.
3. The **up-to-date log rule** means only a candidate holding every committed entry can win; voters refuse candidates with shorter/older logs. Committed data therefore cannot be lost by an election.
4. New leader reconciles follower logs and resumes. Clients see a sub-second write stall, not data loss, though they must handle retries idempotently, since a write committed-but-unacked during the crash may already be applied.
`,
    },
    {
      type: 'code',
      title: 'Simplified Raft election logic (pseudocode)',
      language: 'python',
      code: `
# Raft leader election, stripped to the safety-critical parts.
# Persisted before answering any RPC: current_term, voted_for, log.

import random

ELECTION_TIMEOUT = lambda: random.uniform(0.150, 0.300)   # seconds
HEARTBEAT_INTERVAL = 0.050

class Node:
    def __init__(self):
        self.state = "follower"          # follower | candidate | leader
        self.current_term = 0
        self.voted_for = None            # node id voted for in current_term
        self.log = []                    # [(term, command), ...]
        self.reset_election_timer()

    def on_election_timeout(self):
        # No heartbeat heard for 150-300 ms -> assume leader is dead.
        self.state = "candidate"
        self.current_term += 1
        self.voted_for = self.id         # vote for self
        votes = 1
        for peer in self.peers:
            granted = peer.request_vote(
                term=self.current_term,
                last_log_index=len(self.log) - 1,
                last_log_term=self.log[-1][0] if self.log else 0,
            )
            if granted:
                votes += 1
        if votes >= (len(self.peers) + 1) // 2 + 1:   # majority of 2f+1
            self.become_leader()         # start heartbeats every 50 ms
        else:
            self.reset_election_timer()  # split vote: random retry wins

    def on_request_vote(self, term, last_log_index, last_log_term):
        if term < self.current_term:
            return False                          # stale candidate
        if term > self.current_term:
            self.current_term, self.voted_for = term, None
            self.state = "follower"
        # Grant at most ONE vote per term, and only to candidates whose
        # log is at least as up-to-date as ours (protects committed data).
        up_to_date = (last_log_term, last_log_index) >= self.my_last()
        if self.voted_for in (None, "candidate_id") and up_to_date:
            self.voted_for = "candidate_id"       # persist to disk first!
            self.reset_election_timer()
            return True
        return False
`,
    },
    {
      type: 'text',
      title: 'Paxos, and why everyone found it hard',
      md: `
**Paxos** (Lamport, 1989/1998) solves the same problem and predates Raft by 25 years. Single-decree Paxos agrees
on *one* value using two phases among **proposers**, **acceptors**, and **learners**:

- **Phase 1 (prepare):** a proposer picks a unique, increasing ballot number n and asks a majority of acceptors to *promise* to reject anything numbered below n. Acceptors reply with any value they've already accepted.
- **Phase 2 (accept):** the proposer must propose the highest-numbered value reported back (it can only use its own value if none exists) and asks the majority to accept it. Majority accepted → decided.

The protocol is tiny and provably safe; the pain is everything around it. Single-decree Paxos decides one value, but
real systems need an ordered *log*, which means running Paxos per slot, optimizing away phase 1 by electing a
stable proposer (a leader), handling reconfiguration, snapshots, and recovery. Lamport left those parts as
sketches, so every team (Chubby at Google, most famously) filled the gaps differently. Google's "Paxos Made
Live" paper is essentially a confession that the distance from the paper to production is enormous.

That optimized form (stable leader + per-slot accepts) is **Multi-Paxos**, and here's the punchline:
**Multi-Paxos and Raft are essentially the same algorithm.** Raft's term is Paxos's ballot; AppendEntries is a
phase-2 accept; the election is phase 1 amortized over the leader's whole tenure. Raft's contribution wasn't a
new possibility result. It was packaging: a concrete spec with leader election, log matching, and membership
change *fully specified*, which is why nearly everything built after 2014 (etcd, Consul, TiKV, CockroachDB,
Kafka KRaft) picked Raft.
`,
    },
    {
      type: 'comparison',
      title: 'Raft vs Paxos vs ZAB',
      comparison: {
        columns: ['Criterion', 'Raft', '(Multi-)Paxos', 'ZAB (ZooKeeper)'],
        rows: [
          [
            'Designed for',
            'Understandability; complete spec (2014)',
            'Generality; safety proof first (1989)',
            'ZooKeeper’s primary-backup broadcast (2008)',
          ],
          [
            'Leader',
            'Mandatory; one per term',
            'Optional in theory; stable proposer in practice',
            'Mandatory; epochs like terms',
          ],
          [
            'Log gaps',
            'Never; logs are strictly contiguous',
            'Allowed; slots can be decided out of order',
            'Never; strict FIFO order per epoch',
          ],
          [
            'Election picks',
            'Any node with an up-to-date log (votes enforce it)',
            'Any proposer; must learn chosen values in phase 1',
            'Node with the highest (epoch, txn id)',
          ],
          [
            'Membership change',
            'Specified (joint consensus / single-server)',
            'Left as an exercise; source of real bugs',
            'Dynamic reconfiguration added in 3.5',
          ],
          [
            'Used by',
            'etcd, Consul, CockroachDB, TiKV, Kafka KRaft',
            'Chubby, Spanner (Paxos groups), Cassandra LWT',
            'ZooKeeper (Kafka pre-KRaft, HBase, Hadoop)',
          ],
        ],
        verdict:
          'Functionally near-equivalent: all are majority-quorum leader-based log replication. Choose by ecosystem, not algorithm: in 2025 that almost always means a Raft-based system.',
      },
    },
    {
      type: 'text',
      title: 'Where consensus actually lives, and why you should rent it',
      md: `
You will probably never implement Raft, but you'll use it daily, usually without noticing:

- **etcd** (Raft) stores every Kubernetes object; each \`kubectl apply\` is a Raft commit. Sustains roughly **10K writes/s** (~30–50K with batching), which is why you keep high-churn data *out* of etcd.
- **ZooKeeper** (ZAB) coordinates Hadoop, HBase, ClickHouse, and pre-KRaft Kafka.
- **Kafka KRaft** replaced ZooKeeper with built-in Raft for cluster metadata, the default since 3.3, and **Kafka 4.0 (2025) removed ZooKeeper entirely**, cutting controller failover from minutes to seconds on large clusters.
- **Spanner / CockroachDB / TiDB** run *thousands of consensus groups* (one per shard/range), so consensus scales horizontally with the data, with Raft/Paxos leaders spread across nodes.
- **Aurora, DynamoDB, S3** all run quorum or consensus protocols internally for metadata and membership.

#### Use a coordination service, don't build one

The pattern: keep consensus for the **small, critical control plane** (locks, leases, leader election, membership,
config, all kilobytes), and let the data plane scale with ordinary replication. Concretely: your 50 API servers don't
run Raft; they each try to acquire a **lease** in etcd (\`Campaign\` in etcd's election API, or an ephemeral znode
in ZooKeeper), and whoever holds it is the leader, auto-expiring on crash within a ~5–10 s TTL.

Why not DIY? "Paxos Made Live" reports that hardening textbook Paxos for Chubby took a senior team years.
Disk corruption handling, membership change, snapshotting, and testing harnesses dwarf the core algorithm. A
subtle election bug surfaces once a year at 3 a.m. as split-brain. Jepsen's test suite has failed *commercial
databases* on exactly these edge cases.

> Interview answer that lands: "I'd use etcd/ZooKeeper for leader election and store only control-plane state
> there. Consensus on the data path caps throughput at the quorum's speed."
`,
    },
    {
      type: 'keyNumbers',
      title: 'Consensus numbers worth memorizing',
      numbers: [
        { metric: 'Raft election timeout', value: '150–300 ms', context: 'Randomized per node to break split votes; etcd defaults to 1 s for WAN tolerance.' },
        { metric: 'Heartbeat interval', value: '50–100 ms', context: 'Must be well under the election timeout or healthy clusters hold spurious elections.' },
        { metric: 'Quorum of 5 nodes', value: '3 (tolerates 2 failures)', context: '2f+1 rule. 4 nodes still tolerate only 1, so run odd sizes.' },
        { metric: 'etcd write throughput', value: '~10K writes/s', context: 'Sequential commits through one leader; ~30-50K/s with batching. Why consensus stays on the control plane.' },
        { metric: 'Commit latency', value: '1 RTT to majority (~1–2 ms in-AZ)', context: 'Cross-region quorums pay 30–100 ms per commit, so Spanner leaders are placed near writers for this reason.' },
        { metric: 'Practical cluster size', value: '3–7 voters', context: 'etcd recommends ≤7. Beyond that, replication fan-out slows every commit; add non-voting learners for read scale.' },
      ],
    },
  ],
  quiz: [
    {
      question: 'A 5-node Raft cluster suffers a network partition: 2 nodes on one side, 3 on the other. What happens?',
      options: [
        'Both sides elect leaders and diverge until the partition heals',
        'The 3-node side can elect a leader and commit; the 2-node side can do neither',
        'The whole cluster freezes until all 5 nodes reconnect',
        'The side containing the old leader keeps committing regardless of size',
      ],
      answer: 1,
      explanation:
        'Only a majority (3 of 5) can elect a leader or commit entries. The minority side stalls; an old leader stranded there can append to its log but can never commit, so safety holds.',
    },
    {
      question: 'Why are Raft election timeouts randomized (e.g., 150–300 ms) instead of fixed?',
      options: [
        'To reduce heartbeat bandwidth',
        'To make elections complete faster on average',
        'To break split votes: with identical timeouts, candidates would repeatedly tie',
        'To tolerate clock skew between data centers',
      ],
      answer: 2,
      explanation:
        'If all followers timed out simultaneously, they would all become candidates each round and split the vote forever. Randomization makes one node usually time out first and win: Raft’s practical dodge around FLP.',
    },
    {
      question: 'What does the FLP impossibility result actually say?',
      options: [
        'No deterministic protocol can guarantee consensus terminates in a fully asynchronous system with even one possible crash',
        'Consensus is impossible whenever the network can partition',
        'You can have at most two of consistency, availability, and partition tolerance',
        'Leader-based protocols cannot be made safe',
      ],
      answer: 0,
      explanation:
        'FLP is about termination (liveness) under full asynchrony, not safety, and not CAP. Real systems sidestep it with timeouts and randomness: they may stall, but they never decide inconsistently.',
    },
    {
      question: 'An entry in a Raft leader’s log is safe to apply (committed) when…',
      options: [
        'The leader has written it to its own disk',
        'Every single follower has acknowledged it',
        'It has been pending for one full election timeout',
        'The leader knows a majority of nodes hold it (and it’s from the leader’s current term)',
      ],
      answer: 3,
      explanation:
        'Majority replication means the entry survives any f failures, and the up-to-date-log vote rule means any future leader must have it. Waiting for all nodes would make one slow follower block the cluster.',
    },
    {
      question: 'Your team needs leader election for a payment-reconciliation worker. The senior move is:',
      options: [
        'Implement Raft inside the worker; it’s only ~1,000 lines',
        'Use Redis SETNX with no TTL as a lock',
        'Acquire a lease via etcd or ZooKeeper and store only control-plane state there',
        'Have workers coordinate through database row locks across regions',
      ],
      answer: 2,
      explanation:
        'Battle-tested coordination services give you leases with auto-expiry, fencing, and a decade of Jepsen-grade hardening. DIY consensus and TTL-less locks are where split-brain incidents come from.',
    },
  ],
  interviewQuestions: [
    {
      question: 'Explain how Raft elects a leader, to a new grad, in two minutes.',
      hint: 'Expected beats: heartbeats from leader → randomized 150–300 ms timeout fires → candidate increments term, votes for itself, requests votes → one vote per node per term, up-to-date-log check → majority wins → split votes resolved by randomized retry. Bonus: why terms neutralize zombie leaders.',
      difficulty: 'Junior',
    },
    {
      question: 'Why does a 4-node consensus cluster tolerate the same number of failures as a 3-node one? When would you pick 5 over 3?',
      hint: 'Quorum math: 4 nodes → quorum 3 → tolerates 1, same as 3 nodes. Pick 5 to survive one planned maintenance plus one unplanned failure, at the cost of slower commits (larger fan-out). Mention learners/non-voters for read scaling without quorum growth.',
      difficulty: 'Mid',
    },
    {
      question: 'Kafka migrated from ZooKeeper to KRaft. What problem did that solve, and what stayed the same?',
      hint: 'Look for: external coordination system removed (two systems to operate, metadata via ZK watches was a scaling bottleneck, controller failover took minutes on clusters with 100K+ partitions); KRaft keeps metadata in an internal Raft-replicated log → failover in seconds, supports millions of partitions. Same: still majority-quorum consensus, still a single metadata leader.',
      difficulty: 'Senior',
    },
    {
      question: 'Design leader election for a service where two simultaneous leaders would double-charge customers. Walk through the failure modes.',
      hint: 'Structure: lease in etcd/ZooKeeper with TTL ~10 s; the killer scenario is a paused-then-resumed old leader acting on an expired lease (GC pause!). Require fencing tokens (monotonically increasing epoch numbers checked by downstream systems) so stale leaders’ writes are rejected. Discuss why a lock alone, without fencing, is insufficient.',
      difficulty: 'Senior',
    },
  ],
  commonMistakes: [
    'Confusing FLP with CAP. FLP says async deterministic consensus can’t guarantee termination; CAP is about consistency vs availability during partitions. Citing the wrong one is an instant credibility hit.',
    'Believing a leader lease alone prevents split-brain. A GC-paused leader can wake up and act on an expired lease, so you need fencing tokens validated downstream, not just a lock.',
    'Running consensus on the data path. Funneling 200K writes/s through a Raft group caps you at the quorum’s speed (~10K/s on etcd). Consensus is for control-plane metadata, locks, and membership.',
    'Scaling a cluster to 9+ voters "for more redundancy." Every commit waits on a larger quorum, so writes get slower while tolerance barely improves. Use 3–5 voters plus learners.',
    'Treating "committed on the leader’s disk" as committed. Until a majority holds the entry, a leader crash can lose it. Durability in consensus is a property of the quorum, not of any single machine.',
  ],
  cloudMappings: [
    { concept: 'Managed coordination / consensus store', aws: 'No managed etcd; run etcd/ZooKeeper on EC2 or via EKS', gcp: 'etcd managed inside GKE control plane', azure: 'etcd managed inside AKS control plane' },
    { concept: 'Leader election primitive for apps', aws: 'DynamoDB conditional writes + TTL lease (lock client)', gcp: 'Cloud Spanner / Firestore transactions as lease store', azure: 'Cosmos DB conditional writes / Blob lease API' },
    { concept: 'Consensus-replicated SQL', aws: 'Aurora DSQL / RDS Multi-AZ (internal quorum)', gcp: 'Spanner (Paxos groups per split)', azure: 'Cosmos DB (per-partition replica set quorum)' },
    { concept: 'Streaming metadata via Raft', aws: 'MSK (KRaft mode)', gcp: 'Managed Kafka (KRaft) / Pub/Sub internal', azure: 'HDInsight Kafka / Event Hubs internal' },
    { concept: 'Service discovery + locks', aws: 'Consul on ECS/EKS, Cloud Map', gcp: 'Consul on GKE / Service Directory', azure: 'Consul on AKS' },
    { concept: 'Distributed lock with fencing', aws: 'DynamoDB lock client (record version numbers)', gcp: 'etcd revisions / Spanner commit timestamps', azure: 'Blob lease + ETag conditions' },
  ],
}

export default consensus
