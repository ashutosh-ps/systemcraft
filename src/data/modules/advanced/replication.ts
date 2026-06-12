import type { Module } from '../../../lib/types'

const replication: Module = {
  id: 'replication',
  category: 'advanced',
  title: 'Database Replication & Failover',
  description:
    'Keeping copies of your data alive and (mostly) in sync. Sync vs async vs semi-sync, replication lag pathologies, quorum systems, and the anatomy of a failover that doesn’t split your brain.',
  difficulty: 'Senior',
  estMinutes: 150,
  keywords: [
    'replication lag',
    'failover',
    'split-brain',
    'semi-synchronous',
    'read-your-writes',
    'quorum',
    'hinted handoff',
    'fencing',
  ],
  related: ['databases', 'consensus', 'sharding', 'distributed-systems'],
  sections: [
    {
      type: 'text',
      title: 'Why replicate at all',
      md: `
Replication means keeping the same data on multiple machines. Every serious database does it, for three distinct
reasons — and being precise about *which one you're solving for* drives every later decision:

- **Read scaling.** A single Postgres primary tops out around 40–50K TPS, but most workloads are 90%+ reads. Five read replicas turn one box's read capacity into six — for the price of tolerating some staleness.
- **High availability.** Hardware dies (~1–2% annual disk failure rate; entire AZs go down a few times a decade). A warm replica turns "restore 5 TB from backup, RTO 8 hours" into "promote a replica, RTO 30 seconds."
- **Geo-locality.** A user in Singapore reading from \`us-east-1\` pays ~200 ms round trip *per query*. A replica in \`ap-southeast-1\` cuts that to ~2 ms.

Two definitions you must use correctly in any HA discussion:

- **RPO (Recovery Point Objective)** — how much data you may lose. Async replication: RPO = replication lag at failure time (typically <1 s, can be minutes under load). Sync replication: RPO = 0.
- **RTO (Recovery Time Objective)** — how long until you're serving again. Manual failover: 15–60 min. Automated: 30 s–2 min. Aurora advertises typically <30 s.

> The trade running through this whole module: replicas can be **consistent** or **independent**, never fully
> both. Synchronous copies are consistent but couple their failures and latencies; asynchronous copies are
> resilient and fast but lie to you about the present.
`,
    },
    {
      type: 'text',
      title: 'Single-leader replication: sync, async, semi-sync',
      md: `
The dominant pattern: one **leader** accepts all writes and streams its change log (Postgres WAL, MySQL binlog)
to **followers**. The design decision is *when the leader acknowledges the client*:

#### Asynchronous

Leader commits locally, acks immediately, replicas catch up whenever. Zero write-latency penalty — and zero
guarantee: if the leader's disk dies with 800 ms of lag, those 800 ms of acknowledged writes are **gone** (that's
your RPO). This is the default for MySQL replication, Postgres streaming replication, and most read-replica
setups.

#### Synchronous

Leader waits for the replica to confirm *durable receipt* before acking. RPO = 0, but now every write pays the
replica round trip, and — the real killer — **a dead or slow synchronous replica blocks all writes**. Fully sync
to all replicas means availability is the *product* of replica availabilities; nobody does this beyond one
replica.

#### Semi-synchronous (the production sweet spot)

Leader waits for **at least one** replica (any of them) to confirm receipt, then acks. Cost: roughly
**0.5–2 ms added write latency within an AZ** (one network RTT + replica fsync). Benefit: an acknowledged write
exists on ≥2 machines, so single-machine failure loses nothing. MySQL semi-sync, Postgres
\`synchronous_standby_names = ANY 1 (...)\`, and most managed offerings work this way.

**Aurora** pushes the idea further: every write goes to a shared storage layer keeping **6 copies across 3 AZs**,
acking at a **4/6 write quorum** (reads need 3/6). Losing an entire AZ plus one more node still loses no
acknowledged data.
`,
    },
    {
      type: 'comparison',
      title: 'Sync vs semi-sync vs async',
      comparison: {
        columns: ['Criterion', 'Synchronous (all)', 'Semi-sync (ANY 1)', 'Asynchronous'],
        rows: [
          [
            'Write latency penalty',
            'Slowest replica’s RTT — 10s of ms cross-AZ, worse cross-region',
            '~0.5–2 ms in-AZ (fastest replica’s ack)',
            'None',
          ],
          [
            'RPO on leader loss',
            '0 — every ack’d write is on all replicas',
            '≈0 — every ack’d write is on ≥2 nodes',
            'Lag at failure: usually <1 s, unbounded under load',
          ],
          [
            'Replica failure impact',
            'Writes block until replica recovers or is removed',
            'None while ≥1 replica is healthy; degrades to async if all die',
            'None — replicas are invisible to the write path',
          ],
          [
            'Read staleness on replicas',
            'None (after ack)',
            'Possible on the non-confirming replicas',
            'Normal — design for it explicitly',
          ],
          [
            'Typical use',
            'Rare; regulated zero-loss ledgers with 1 sync standby',
            'Production OLTP default (MySQL semi-sync, PG ANY 1, Aurora 4/6)',
            'Read replicas, cross-region copies, analytics feeds',
          ],
        ],
        verdict:
          'Semi-sync to one in-AZ standby plus async to everything else is the boring, correct default: near-zero RPO for ~1 ms of write latency, without letting any single replica hold your writes hostage.',
      },
    },
    {
      type: 'text',
      title: 'Replication lag and its pathologies',
      md: `
Async replicas run *behind* the leader. Typical lag is **under 1 second**, but it is fundamentally **unbounded**:
a bulk import, a long replica transaction, or a saturated NIC can push lag to minutes (Postgres
\`pg_stat_replication\`, MySQL \`Seconds_Behind_Source\` — alert on these). Lag produces three classic anomalies,
each with a standard fix:

#### 1. Read-your-writes violations

User updates their profile photo, the next page load reads a replica that's 500 ms behind, the old photo is back.
Users interpret this as data loss. Fixes:

- **Pin after write:** route a user's reads to the leader for ~60 s after they write (session sticky flag).
- **LSN/GTID tracking:** remember the leader's log position at write time; serve the read from any replica that has replayed past it (Postgres \`pg_last_wal_replay_lsn()\`, MySQL \`WAIT_FOR_EXECUTED_GTID_SET\`). ProxySQL and some drivers automate this.

#### 2. Monotonic read violations

Two consecutive reads hit different replicas — the second one *further behind* — and a comment the user just saw
vanishes. Time appears to flow backwards. Fix: **session affinity** — hash each session to one replica, so reads
may be stale but never regress.

#### 3. Causal violations

An answer replicates before its question; observers see effects precede causes. Fixes range from causal-consistency
tokens to simply keeping causally linked data behind one leader.

> Replication lag isn't a bug to eliminate — it's a budget to manage. State which reads tolerate staleness
> (feeds: seconds are fine) and which don't (the page right after a write), and route accordingly.
`,
    },
    {
      type: 'text',
      title: 'Multi-leader and leaderless replication',
      md: `
#### Multi-leader: write anywhere, regret everywhere

Multiple leaders accept writes (one per region, typically) and replicate to each other asynchronously. Local
writes get local latency — and you've signed up for **write conflicts**: two regions update the same row in the
same 100 ms window, and both think they won. Resolution options are all unpleasant: **last-writer-wins (LWW)**
silently discards one write using timestamps from clocks that legitimately skew by milliseconds; app-level merge
callbacks are write-once-debug-forever code. **CRDTs** (conflict-free replicated data types) are the principled
escape hatch: counters, sets, and lists with mathematically commutative merges, so concurrent updates converge
deterministically — Riak, Redis Enterprise CRDBs, and collaborative editors (Figma's multiplayer, Automerge) use
them, but they only fit data with sensible merge semantics. Avoid multi-leader unless you truly need multi-region
*writes*; most systems do region-local reads + single write region instead.

#### Leaderless: Dynamo-style quorums

Cassandra, Riak, and DynamoDB's internals skip leaders. The client (or coordinator) writes to all **N** replicas,
waiting for **W** acks; reads query **R** replicas and take the newest version. The guarantee: when
**R + W > N**, read and write sets overlap in ≥1 replica, so a read sees the latest acknowledged write. Classic
production setting: **N=3, W=2, R=2** — tolerates one slow/dead replica on both paths with no failover event at
all. Supporting machinery: **read repair** (fix stale replicas during reads), **hinted handoff** (a neighbor
holds writes for a down node and replays them later), and **sloppy quorums** (accept writes on stand-in nodes
during partitions — favoring availability while weakening the overlap guarantee).
`,
    },
    {
      type: 'code',
      title: 'Quorum math and a guarded promotion (pseudocode)',
      language: 'python',
      code: `
# Part 1 — Dynamo-style quorum: R + W > N guarantees overlap.
N, W, R = 3, 2, 2
assert R + W > N          # 2+2 > 3: every read set intersects every write set

def write(key, value, replicas):
    version = next_version(key)               # vector clock / timestamp
    acks = 0
    for r in replicas[:N]:
        if r.put(key, value, version):        # in parallel in real life
            acks += 1
    return acks >= W                          # ack client at W=2 of N=3

def read(key, replicas):
    responses = [r.get(key) for r in replicas[:N] if r.alive][:R]
    latest = max(responses, key=lambda x: x.version)
    for resp in responses:                    # read repair: heal stale copies
        if resp.version < latest.version:
            resp.node.put(key, latest.value, latest.version)
    return latest.value

# Part 2 — single-leader failover with fencing (what RDS/Orchestrator
# style tooling does). The order of operations is the whole game.
def failover(cluster):
    # 1. DETECT: multiple observers, not one flaky ping.
    #    (GitHub 2018: 43s of partition was enough to trigger promotion.)
    if healthy_checks(cluster.primary, observers=3, fails=3, interval=1.0):
        return

    # 2. FENCE the old primary BEFORE promoting anything.
    epoch = config_store.increment_epoch()    # fencing token in etcd
    cluster.primary.kill_connections()        # and/or revoke VIP, STONITH
    storage.reject_writes_below(epoch)        # stale-epoch writes bounce

    # 3. PROMOTE the most caught-up replica (minimize RPO).
    candidate = max(cluster.replicas, key=lambda r: r.replayed_lsn)
    lost_ms = cluster.last_known_lsn - candidate.replayed_lsn
    log("RPO: ~" + str(lost_ms) + "ms of writes lost (async tail)")
    candidate.promote(epoch=epoch)

    # 4. REPOINT traffic atomically: DNS/VIP/proxy flip, then
    #    re-parent surviving replicas onto the new primary.
    proxy.set_primary(candidate, epoch=epoch)
    for r in cluster.replicas:
        if r is not candidate:
            r.follow(candidate)
    # Old primary rejoins only as a replica, never as a leader.
`,
    },
    {
      type: 'diagram',
      title: 'Primary + replicas across AZs, with the failover path',
      caption:
        'Steady state: semi-sync to AZ-b, async to AZ-c, reads load-balanced to replicas. Dashed edges are the failover machinery — health checks, fencing via etcd, and the promotion path.',
      diagram: {
        height: 380,
        nodes: [
          {
            id: 'clients',
            label: 'Clients',
            kind: 'client',
            x: 30,
            y: 105,
            detail:
              'App traffic: ~25K read QPS, ~3K write QPS. Connects through a proxy that knows which node is primary — clients never hardcode database hosts.',
          },
          {
            id: 'proxy',
            label: 'DB Proxy',
            kind: 'lb',
            x: 250,
            y: 105,
            detail:
              'PgBouncer/ProxySQL/RDS Proxy. Routes writes to the primary, balances reads across replicas, and is the single point where failover gets repointed — flipping here beats waiting on DNS TTLs.',
          },
          {
            id: 'primary',
            label: 'Primary (AZ-a)',
            kind: 'db',
            x: 520,
            y: 40,
            detail:
              'Accepts all writes, streams WAL to both replicas. Semi-sync to AZ-b adds ~1 ms per commit; cross-AZ RTT is ~0.5-1.5 ms.',
          },
          {
            id: 'replica1',
            label: 'Replica (AZ-b)',
            kind: 'db',
            x: 790,
            y: 40,
            detail:
              'Semi-sync standby: confirms WAL receipt before the primary acks, so RPO≈0 for single-node loss. First in line for promotion — usually the most caught-up.',
          },
          {
            id: 'replica2',
            label: 'Replica (AZ-c)',
            kind: 'db',
            x: 790,
            y: 180,
            detail:
              'Async replica serving reads. Lag typically 100-800 ms; alert past 5 s. Promotable, but anything not yet replayed at failure time is lost (RPO > 0).',
          },
          {
            id: 'orch',
            label: 'Orchestrator',
            kind: 'service',
            x: 520,
            y: 260,
            detail:
              'Patroni/Orchestrator-style failover manager. Probes the primary every 1 s from multiple vantage points; after ~3 failed checks (and peer confirmation) it runs fence → promote → repoint in ~30 s total.',
          },
          {
            id: 'etcd',
            label: 'etcd (lease)',
            kind: 'external',
            x: 250,
            y: 260,
            detail:
              'Consensus-backed source of truth for "who is primary": a leader lease with a fencing epoch. An old primary that wakes from a GC pause finds a higher epoch and demotes itself instead of split-braining.',
          },
        ],
        edges: [
          { from: 'clients', to: 'proxy', label: 'SQL' },
          { from: 'proxy', to: 'primary', label: 'writes' },
          { from: 'proxy', to: 'replica2', label: 'reads (lag <1s)' },
          { from: 'primary', to: 'replica1', label: 'WAL semi-sync' },
          { from: 'primary', to: 'replica2', label: 'WAL async' },
          { from: 'orch', to: 'primary', label: 'health 1s', dashed: true },
          { from: 'orch', to: 'replica1', label: 'promote', dashed: true },
          { from: 'orch', to: 'etcd', label: 'epoch++', dashed: true },
        ],
      },
    },
    {
      type: 'text',
      title: 'Failover anatomy — and the split-brain horror story',
      md: `
Failover sounds simple — "promote a replica" — but every step hides a way to lose data:

1. **Detection.** Distinguishing "primary is dead" from "primary is slow / I can't see it" is the FLP problem wearing a pager. Use multiple observers and consecutive-failure thresholds (e.g., 3 fails × 1 s probes). Too aggressive → flapping failovers; too lax → minutes of downtime.
2. **Fencing — *before* promotion.** The old primary may still be alive and accepting writes from clients that can still reach it. You must make it harmless first: revoke its VIP, kill its connections, bump a **fencing epoch** in etcd so storage/proxies reject its writes, or power it off outright (STONITH — "shoot the other node in the head").
3. **Promotion.** Pick the most caught-up replica (highest replayed LSN/GTID) to minimize RPO. With async replication, the un-replicated tail is lost — decide *in advance* whether to accept that or block writes instead.
4. **Repointing.** Flip the proxy/VIP atomically and re-parent the remaining replicas onto the new primary. DNS-based repointing is the slow path — 30–300 s of TTL caching.

#### GitHub, October 21, 2018

A routine maintenance caused **43 seconds** of connectivity loss between GitHub's East Coast data center and the
rest. Orchestrator dutifully failed over: West Coast MySQL replicas were promoted. But the East Coast primary had
accepted writes during those seconds that never replicated — and after promotion, *both* sides had unique writes.
The result of 43 seconds of partition: **24+ hours of degraded service** while data was manually reconciled, with
some writes restored from backups. The lessons are the modern failover canon: fence before promoting, prefer
strict topologies (don't auto-promote across regions on async links), and rehearse failovers routinely — an
untested failover path is just an outage with extra YAML.
`,
    },
    {
      type: 'tradeoff',
      title: 'Explore it: consistency vs availability in a replicated system',
    },
    {
      type: 'beforeAfter',
      title: 'Case: from manual failover to automated, fenced failover',
      scenario: {
        beforeTitle: 'Pager-driven manual failover',
        beforeDescription:
          'Primary dies at 03:10. On-call wakes, confirms it’s really down, picks a replica by eyeballing lag, runs a promotion runbook, edits DNS (300 s TTL), restarts app pools. Writes are down ~15 minutes; one incident promoted a 40 s-stale replica and silently lost orders.',
        afterTitle: 'Patroni-style automation + semi-sync + fencing',
        afterDescription:
          'Semi-sync to one in-AZ standby (RPO≈0), async to a second AZ. Failover manager detects in 3 s, fences via etcd epoch, promotes the most caught-up replica, flips the proxy. Monthly game-day failovers keep the path tested.',
        metrics: [
          { label: 'RTO (write downtime)', before: '~15 min', after: '~30 s', improved: true },
          { label: 'RPO (data lost)', before: 'Up to 40 s of writes', after: '≈0 (semi-sync ack)', improved: true },
          { label: 'Split-brain protection', before: 'Hope + a runbook', after: 'Fencing epoch in etcd', improved: true },
          { label: 'Write p99 (steady state)', before: '4 ms', after: '5.5 ms (+semi-sync RTT)', improved: false },
          { label: 'Failover rehearsals', before: 'Never (too scary)', after: 'Monthly game day', improved: true },
        ],
      },
    },
  ],
  quiz: [
    {
      question: 'With async replication and 800 ms of lag, the primary’s disk is destroyed. What happens to the last 800 ms of acknowledged writes?',
      options: [
        'They are lost — that lag is exactly your RPO',
        'They are recovered from the WAL on the replicas',
        'The clients automatically replay them',
        'Nothing — acknowledged writes are always durable',
      ],
      answer: 0,
      explanation:
        'Async means the leader acked writes that existed only on its own disk. Whatever hadn’t reached a replica is gone — the core trade you accept in exchange for zero write-latency penalty.',
    },
    {
      question: 'A user saves a new profile photo, refreshes, and sees the old one. Which fix is most precise?',
      options: [
        'Switch the whole app to synchronous replication',
        'Add more read replicas to reduce lag',
        'Track the write’s LSN/GTID and serve that user’s reads from a replica that has replayed past it (or the leader)',
        'Cache the photo in the client',
      ],
      answer: 2,
      explanation:
        'This is a read-your-writes violation. LSN/GTID tracking (or briefly pinning the user to the leader) fixes it surgically; full sync replication fixes it by making every write in the system slower.',
    },
    {
      question: 'In a leaderless store with N=3, why does W=2, R=2 guarantee reads see the latest acknowledged write?',
      options: [
        'Because writes are retried until all 3 replicas confirm',
        'Because R + W > N forces the read set and write set to overlap in at least one replica',
        'Because the coordinator orders all operations through a leader',
        'Because vector clocks prevent any replica from being stale',
      ],
      answer: 1,
      explanation:
        'Any 2 of 3 replicas intersect any other 2 of 3 in at least one node, so some read replica always holds the newest version — version metadata picks it out. No leader or failover event required.',
    },
    {
      question: 'In the GitHub 2018 incident, what turned a 43-second partition into 24+ hours of degraded service?',
      options: [
        'The replicas were minutes behind on replication',
        'DNS caching kept routing traffic to the dead site',
        'Backups turned out to be corrupted',
        'Automated promotion without fencing left two sides with conflicting writes that needed manual reconciliation',
      ],
      answer: 3,
      explanation:
        'The old primary had accepted writes that never replicated before a cross-country promotion — both sides then held unique data. Fencing the old leader before promotion is the lesson.',
    },
    {
      question: 'Why is semi-sync (ANY 1 standby) the common production default over full sync?',
      options: [
        'It has zero write-latency overhead',
        'It guarantees replicas never serve stale reads',
        'It puts every ack’d write on ≥2 nodes for ~1 ms of latency, without letting one dead replica block all writes',
        'It removes the need for failover automation',
      ],
      answer: 2,
      explanation:
        'Full sync to all replicas couples your write availability to every replica’s health. ANY-1 semi-sync gets you RPO≈0 for single-node loss at ~0.5–2 ms cost, and degrades gracefully.',
    },
  ],
  interviewQuestions: [
    {
      question: 'Your product is read-heavy and the database is saturating. Walk me through adding read replicas and what breaks.',
      hint: 'Expected: async streaming replicas behind a routing proxy; immediately discuss lag (<1 s typical, unbounded under load), read-your-writes and monotonic-read anomalies, and the fixes (pin-after-write, LSN tracking, session affinity). Bonus: replicas don’t help write scaling at all.',
      difficulty: 'Junior',
    },
    {
      question: 'Define RPO and RTO, and design a Postgres topology for RPO≈0 and RTO<60 s within one region.',
      hint: 'RPO = max acceptable data loss, RTO = max acceptable downtime. Expected design: semi-sync (ANY 1) standby in a second AZ + async third replica, Patroni with etcd for leader lease and fencing, proxy-based repointing (not DNS), and an explicit note that cross-region DR remains async with nonzero RPO.',
      difficulty: 'Mid',
    },
    {
      question: 'When would you choose leaderless (Dynamo-style) replication over single-leader, and what new problems do you take on?',
      hint: 'Choose it for write availability with no failover pause and multi-DC symmetry (carts, sessions, time-series). Costs: no transactions, conflict versions needing vector clocks/LWW, read repair + hinted handoff machinery, sloppy quorums weakening the R+W>N guarantee, and tombstone/repair operational burden.',
      difficulty: 'Senior',
    },
    {
      question: 'Design the failover controller itself. How do you make sure it never creates two primaries?',
      hint: 'Structure: multi-observer detection with quorum agreement (don’t trust one prober), fencing before promotion (epoch in a consensus store + connection kill + VIP revoke / STONITH), promote highest-LSN replica, atomic proxy repoint, old primary rejoins only as replica after a rewind (pg_rewind). The controller’s own HA must come from a consensus-backed lease — otherwise you’ve just moved the split-brain.',
      difficulty: 'Senior',
    },
  ],
  commonMistakes: [
    'Saying "we have replicas" as if that equals HA. Without tested, automated failover plus fencing, replicas are just warm disks; your real RTO is however long the 3 a.m. runbook takes.',
    'Promoting a replica without fencing the old primary first. A paused-but-alive leader keeps taking writes and you get the GitHub-2018 scenario: divergent data and a day of reconciliation.',
    'Reading your own write from an async replica and calling it a bug in the database. It’s a routing decision you didn’t make — pin post-write reads or track LSNs.',
    'Treating replication lag as bounded because it’s usually 200 ms. Under bulk loads it grows without limit; alert on lag and define what happens to reads when it breaches the budget.',
    'Choosing LWW conflict resolution casually in multi-leader setups. Clock skew of a few ms means LWW silently deletes concurrent writes — fine for a presence flag, catastrophic for a cart.',
  ],
  cloudMappings: [
    { concept: 'Managed HA failover (single region)', aws: 'RDS Multi-AZ (semi-sync standby, ~60 s failover)', gcp: 'Cloud SQL HA (regional sync disk)', azure: 'Azure SQL / Flexible Server zone-redundant HA' },
    { concept: 'Quorum-replicated storage engine', aws: 'Aurora (6 copies / 3 AZs, 4/6 write quorum)', gcp: 'AlloyDB (regional log-structured storage)', azure: 'Cosmos DB (4-replica sets per partition)' },
    { concept: 'Read replicas (async)', aws: 'RDS/Aurora read replicas (up to 15)', gcp: 'Cloud SQL read replicas / AlloyDB read pools', azure: 'Azure Database read replicas' },
    { concept: 'Cross-region disaster recovery', aws: 'Aurora Global Database (~1 s lag, RPO seconds)', gcp: 'Spanner multi-region (sync, RPO 0) / Cloud SQL cross-region replica', azure: 'Cosmos DB multi-region / SQL failover groups' },
    { concept: 'Leaderless / tunable-quorum NoSQL', aws: 'DynamoDB global tables / Keyspaces', gcp: 'Bigtable multi-cluster routing', azure: 'Cosmos DB (5 consistency levels)' },
    { concept: 'Connection routing for failover', aws: 'RDS Proxy', gcp: 'AlloyDB Auth Proxy / PgBouncer on GKE', azure: 'Azure SQL listener / PgBouncer on AKS' },
  ],
}

export default replication
