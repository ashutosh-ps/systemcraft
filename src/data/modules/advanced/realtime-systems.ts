import type { Module } from '../../../lib/types'

const realtimeSystems: Module = {
  id: 'realtime-systems',
  category: 'advanced',
  title: 'Real-time Systems: WebSockets to Streaming',
  description:
    'Push data to millions of clients in under a second: polling vs SSE vs WebSockets, the 1M-connections problem, pub-sub backplanes for chat fan-out, and a working mental model for stream processing.',
  difficulty: 'Mid',
  estMinutes: 140,
  keywords: ['WebSockets', 'server-sent events', 'long polling', 'pub-sub', 'presence', 'fan-out', 'stream processing', 'Flink'],
  related: ['message-queues', 'design-notifications', 'design-uber', 'api-design'],
  sections: [
    {
      type: 'text',
      title: 'The realtime problem: HTTP is the wrong shape',
      md: `
HTTP is request-response: the client asks, the server answers, the connection goes quiet. But chat messages, ride
locations, stock ticks, and collaborative cursors originate **on the server** at unpredictable times. Four ways to
get them to the client:

- **Short polling.** Client asks "anything new?" every N seconds. Brutally simple, brutally wasteful: 100K clients
  polling every 5 s is **20,000 QPS** of mostly-empty 200-byte responses, and the *average* message arrives N/2
  seconds late.
- **Long polling.** Client asks; the server **holds the request open** (typically 30–60 s) and responds the moment
  data exists, then the client immediately re-asks. Latency drops to near-zero, but each message still costs a full
  HTTP round trip + headers, and you tie up a request slot per waiting client.
- **Server-Sent Events (SSE).** One long-lived HTTP response the server streams \`data:\` frames down forever.
  Built-in browser API (\`EventSource\`) with **automatic reconnect** and a \`Last-Event-ID\` header so the server
  can replay what the client missed. One direction only: server → client.
- **WebSockets.** A real bidirectional TCP-based protocol bootstrapped via an HTTP \`Upgrade\` handshake. After the
  handshake, frames flow both ways with **2–14 bytes of overhead** instead of ~500–2,000 bytes of HTTP headers.

> Default advice: notifications, dashboards, LLM token streams → **SSE** (it's just HTTP: every proxy, LB, and CDN
> understands it). Chat, games, collaborative editing, anything client→server chatty → **WebSockets**.
`,
    },
    {
      type: 'comparison',
      title: 'The four realtime transports, side by side',
      comparison: {
        columns: ['Criterion', 'Short polling', 'Long polling', 'SSE', 'WebSockets'],
        rows: [
          ['Delivery latency', 'Avg N/2 s for N-second interval', '~0 (response fires on event)', '~0 (streamed)', '~0 (pushed)'],
          ['Per-message overhead', 'Full HTTP req/resp (~1–2 KB headers)', 'Full HTTP req/resp per message', 'HTTP once, then ~bytes per frame', '2–14 bytes per frame'],
          ['Direction', 'Client pulls', 'Client pulls (held)', 'Server → client only', 'Full duplex'],
          ['Proxy / LB friendliness', 'Perfect: plain HTTP', 'Good, needs long timeouts', 'Very good: plain HTTP streaming', 'Needs Upgrade support + sticky routing'],
          ['Reconnect story', 'N/A (stateless)', 'Re-request loop', 'Automatic + Last-Event-ID replay', 'DIY: reconnect, backoff, resume protocol'],
          ['Server cost at idle', 'Wasted QPS (100K clients @5s = 20K QPS)', '1 parked request per client', '1 open conn per client (~KBs RAM)', '1 open conn per client (~10 KB RAM)'],
          ['Best for', 'Tiny scale, cron-ish freshness', 'Legacy environments without SSE/WS', 'Feeds, notifications, AI token streams', 'Chat, games, collab editing, trading'],
        ],
        verdict:
          'Polling is a prototype tool. SSE wins when data flows one way because it inherits all of HTTP’s infrastructure. WebSockets win when the client talks back. Big platforms (Slack, Discord, Figma) run WebSockets with aggressive reconnect logic.',
      },
    },
    {
      type: 'text',
      title: 'The 1M-connections problem',
      md: `
A WebSocket server's job is mostly *holding memory open*. Each idle connection costs roughly:

- **~4–16 KB kernel buffers** (tunable socket read/write buffers),
- **TLS session state** (~2–10 KB),
- **application state** (user id, subscriptions, last-seen). Call it **~10 KB/connection** as a planning number.

So 1M connections ≈ **10 GB of RAM** plus a file descriptor each (\`ulimit\` defaults of 1,024 are the first wall
everyone hits). With an event-loop runtime (epoll/kqueue: Node, Go, Netty, Erlang), CPU at idle is near zero;
heartbeat ping/pongs every ~30 s keep NATs and LBs from silently killing connections. Real-world density:
**10K–100K conns/node** is comfortable; WhatsApp famously pushed **1–2M per box** on tuned FreeBSD/Erlang, and
Discord holds **millions of WebSockets** (and ~**5M concurrent voice users**) on an Elixir gateway fleet.

Three problems that don't exist with stateless HTTP:

1. **Stickiness.** A connection lives on *one specific node*, so "any server can handle any request" is gone. The LB
   must route at L4 and your system needs to know *where each user is connected*.
2. **Deploys are violent.** Restarting a node drops 100K connections at once; they all reconnect simultaneously and
   stampede your auth service. **Connection draining** (stop accepting, then trickle disconnects over 10–30 minutes
   with jittered client backoff) turns deploys from incidents into non-events.
3. **State reconciliation.** After any reconnect the client may have missed messages. You need a resume protocol:
   client sends last-received sequence number, server replays the gap (Discord calls this session resume).
`,
    },
    {
      type: 'text',
      title: 'Presence: the deceptively hard feature',
      md: `
"Show a green dot when a user is online" sounds trivial and is famously not. Presence generates **more traffic than
chat itself**, because every status flip fans out to everyone who can see that user.

The standard mechanics:

- Connect/disconnect handlers set a key in Redis: \`presence:user42 = {node: gw-7, ts: ...}\` with a **TTL of
  ~60 s**, refreshed by heartbeats every ~30 s. Crashed nodes never "log out" their users; the TTL does, within a
  minute. Never trust a disconnect event to fire.
- **Debounce flapping.** A phone on flaky LTE reconnects every few seconds; broadcasting each flip melts the system.
  Wait ~5–10 s before announcing "offline".
- **Fan-out is the killer.** A user with 1,000 visible contacts produces 1,000 notifications per status change.
  At Slack scale this is why presence is **pull-based + subscription-based**: clients ask for presence of the
  ~50 users currently *on screen* and subscribe to changes only for those.

> Interview gold: say "I'd make presence eventually consistent and slightly stale (30–60 s TTL). Nobody notices a
> late green dot, but everyone notices chat latency." Spending your consistency budget on presence is a junior
> mistake.
`,
    },
    {
      type: 'text',
      title: 'Fan-out for chat: the pub-sub backplane',
      md: `
User A (connected to gateway 1) messages user B (connected to gateway 7). Gateway 1 must discover *where B is* and
deliver across nodes. Two standard pieces:

#### 1. Connection registry

A shared map of \`user → gateway node(s)\` (plural: phone *and* laptop), usually Redis with TTLs as in presence.
On connect, register; on message send, look up the recipient's gateway and route to it.

#### 2. Pub-sub backplane

Instead of gateways calling each other point-to-point (an N×N mesh), every gateway subscribes to a message bus:

- **Redis Pub/Sub**, the classic backplane. Each gateway *subscribes* to channels for the rooms/users it hosts;
  senders *publish* once and Redis fans out. Sub-millisecond, fire-and-forget: if a gateway is down, those messages
  are simply gone, which is fine, because durability lives elsewhere.
- **Kafka**, for when you need durable, ordered, replayable delivery (message history, offline catch-up). Events also
  land in Kafka/a database. The common pattern is **both**: Redis for the hot realtime path, Kafka/DB as the source
  of truth clients reconcile against on reconnect.

For rooms it's the same shape: channel per room, gateways subscribe to channels their connected users belong to.
A 10K-member room means one publish → up to N gateway deliveries → 10K socket writes spread across the fleet.
Mega-rooms (Discord servers with 500K+ members) get special-cased: lazy member lists and only delivering to members
with the channel actually open.
`,
    },
    {
      type: 'diagram',
      title: 'Chat architecture: WS gateways + Redis backplane',
      caption:
        'Connections are sticky to a gateway; messages hop gateways via the Redis pub-sub backplane. Kafka persists everything for history and reconnect catch-up.',
      diagram: {
        height: 430,
        nodes: [
          {
            id: 'sender',
            label: 'Sender (mobile)',
            kind: 'client',
            x: 20,
            y: 60,
            detail:
              'Holds one WebSocket. Sends a heartbeat ping every 30 s; on disconnect, reconnects with jittered exponential backoff and a last-received sequence number to resume.',
          },
          {
            id: 'recipient',
            label: 'Recipient (web)',
            kind: 'client',
            x: 20,
            y: 320,
            detail:
              'Connected to a different gateway node than the sender. End-to-end message latency budget: under 150 ms, of which the backplane hop is about 1 ms.',
          },
          {
            id: 'lb',
            label: 'L4 LB',
            kind: 'lb',
            x: 230,
            y: 190,
            detail:
              'Routes at TCP level and supports the HTTP Upgrade. Connections are sticky by nature: once established, all frames flow to the same gateway. Idle timeout raised to several minutes so heartbeats keep connections alive.',
          },
          {
            id: 'gw1',
            label: 'WS Gateway 1',
            kind: 'server',
            x: 440,
            y: 60,
            detail:
              'Event-loop server holding ~100K concurrent connections in ~1 GB of connection state (~10 KB each). On deploy it drains: stops accepting, then trickles disconnects over 15 minutes to avoid a reconnect stampede.',
          },
          {
            id: 'gw2',
            label: 'WS Gateway 2',
            kind: 'server',
            x: 440,
            y: 320,
            detail:
              'Identical clone. Subscribes to Redis channels for exactly the rooms/users its connections care about, so it only receives relevant traffic.',
          },
          {
            id: 'redis',
            label: 'Redis Pub/Sub',
            kind: 'cache',
            x: 660,
            y: 190,
            detail:
              'The backplane: publish once, delivered to every subscribed gateway in under 1 ms. Fire-and-forget, with no durability, which is fine because Kafka holds the source of truth. Also hosts the connection registry and presence keys (60 s TTL).',
          },
          {
            id: 'kafka',
            label: 'Kafka (persist)',
            kind: 'queue',
            x: 830,
            y: 60,
            detail:
              'Every message is appended here (and to the message store) before being acked to the sender. Reconnecting clients catch up by replaying from their last sequence number.',
          },
        ],
        edges: [
          { from: 'sender', to: 'lb', label: 'WSS' },
          { from: 'recipient', to: 'lb', label: 'WSS', dashed: true },
          { from: 'lb', to: 'gw1', label: 'sticky conn' },
          { from: 'lb', to: 'gw2', label: 'sticky conn' },
          { from: 'gw1', to: 'redis', label: 'PUBLISH room:42' },
          { from: 'redis', to: 'gw2', label: 'fan-out <1 ms' },
          { from: 'gw1', to: 'kafka', label: 'persist' },
        ],
      },
    },
    {
      type: 'code',
      title: 'WebSocket gateway with a Redis backplane (pseudocode)',
      language: 'javascript',
      code: `
// Each gateway node runs this. Local sockets + shared Redis backplane.
const localConns = new Map();          // userId -> Set<WebSocket>
const sub = redis.duplicate();         // dedicated subscriber connection

wss.on('connection', async (ws, req) => {
  const userId = await authenticate(req);      // JWT in the Upgrade request
  addLocal(localConns, userId, ws);

  // Registry + presence: where is this user, with a 60s safety TTL
  await redis.set('conn:' + userId, NODE_ID, 'EX', 60);
  for (const room of await roomsOf(userId)) {
    await sub.subscribe('room:' + room);       // idempotent per node
  }

  ws.on('message', async (raw) => {
    const msg = validate(raw);
    msg.seq = await nextSeq(msg.roomId);       // ordering authority
    await kafka.send('messages', msg);         // durability FIRST...
    await redis.publish('room:' + msg.roomId, JSON.stringify(msg));
    ws.send(ack(msg.seq));                     // ...then ack the sender
  });

  ws.on('close', () => {
    removeLocal(localConns, userId, ws);
    // Do NOT delete presence here -- let the TTL expire (crash-safe),
    // and debounce ~10s before broadcasting "offline".
  });
});

// Backplane delivery: one publish reaches every gateway; each writes
// only to ITS local sockets for that room.
sub.on('message', (channel, payload) => {
  const msg = JSON.parse(payload);
  for (const ws of localRoomMembers(channel)) {
    if (ws.bufferedAmount < 1_000_000) ws.send(payload);  // backpressure:
    // slow consumers get dropped + must resume via seq replay, never
    // allowed to balloon server memory.
  }
});

setInterval(heartbeatAndRefreshTTLs, 30_000);  // ping/pong + EX refresh
`,
    },
    {
      type: 'text',
      title: 'Stream processing: computing over data in motion',
      md: `
Delivery is half of realtime; the other half is **computing** on event streams: "rides per minute per city",
"flag 5 failed logins within 10 minutes". Batch jobs over the warehouse answer this *hours* late; stream processors
(**Apache Flink**, **Kafka Streams**, Spark Structured Streaming) answer in **seconds**, holding running state as
events flow through.

Three concepts carry 90% of the value:

- **Windows.** Infinite streams need bounding to aggregate. **Tumbling** windows: fixed, non-overlapping (every
  minute, separately). **Sliding**: overlapping (last 5 minutes, evaluated every 30 s). **Session**: bounded by a gap
  of inactivity (a user's browsing session, closed after 15 idle minutes).
- **Event time vs processing time.** A ride event *happened* at 12:00:01 (event time) but might *arrive* at 12:00:09
  after a tunnel-induced retry (processing time). Correct analytics demand event time, which means tolerating
  out-of-order arrival.
- **Watermarks.** The fix for "how long do I wait for stragglers?" A watermark is the processor's moving claim that
  "events older than T have (probably) all arrived", e.g. trailing 10 s behind the newest event seen. When the
  watermark passes a window's end, the window fires. Later-than-watermark events are either dropped or trigger
  corrections, your choice.

Flink adds fault tolerance via periodic **checkpoints** of all operator state to durable storage, giving
**exactly-once state semantics**: a crashed job resumes from the last checkpoint and replays Kafka from the matching
offsets. Uber and Netflix run thousands of Flink jobs this way for pricing, ETA, and anomaly detection.
`,
    },
    {
      type: 'calculator',
      title: 'Try it: bandwidth for a realtime fan-out',
      calculator: 'bandwidth',
    },
    {
      type: 'beforeAfter',
      title: 'Case: killing the 5-second poll',
      scenario: {
        beforeTitle: 'Dashboard polls REST API every 5 s',
        beforeDescription:
          '120K concurrent dashboards poll an orders endpoint every 5 seconds: 24,000 QPS hammering the API tier and database, ~97% of responses contain no new data, and a change takes 2.5 s on average to appear. 12 app servers exist mostly to say "nothing yet".',
        afterTitle: 'WebSocket push from an events stream',
        afterDescription:
          'Dashboards hold a WebSocket to 3 gateway nodes (~40K conns each, ~12 GB total RAM); order events flow Kafka → gateways → only the dashboards watching that account. The API tier shrinks to 3 servers handling real requests.',
        metrics: [
          { label: 'Steady-state QPS on API tier', before: '24,000', after: '~50 (auth + reconnects)', improved: true },
          { label: 'Median update latency', before: '2,500 ms', after: '<100 ms', improved: true },
          { label: 'Wasted responses', before: '~97% empty', after: '0% (push on change only)', improved: true },
          { label: 'App/gateway servers', before: '12', after: '3 + 3 gateways', improved: true },
          { label: 'Operational complexity', before: 'Stateless, trivial deploys', after: 'Sticky conns, draining, resume protocol', improved: false },
        ],
      },
    },
  ],
  quiz: [
    {
      question: '100K clients each poll every 5 seconds. Roughly what request load is that, and what is the average staleness?',
      options: [
        '100K QPS, 5 s stale',
        '20K QPS, 2.5 s stale on average',
        '500 QPS, near-realtime',
        '20K QPS, but data is always fresh',
      ],
      answer: 1,
      explanation:
        '100,000 ÷ 5 s = 20,000 QPS, and a change lands uniformly within the polling interval, so it waits 2.5 s on average. This double cost (load AND latency) is the case against short polling.',
    },
    {
      question: 'Which transport gives you automatic reconnection with missed-event replay essentially for free in the browser?',
      options: [
        'WebSockets, where the protocol handles resume natively',
        'Long polling',
        'Short polling',
        'Server-Sent Events: EventSource auto-reconnects and sends Last-Event-ID',
      ],
      answer: 3,
      explanation:
        'EventSource reconnects automatically and presents the Last-Event-ID header so the server can replay the gap. WebSockets give you a raw pipe: reconnect, backoff, and resume are all on you.',
    },
    {
      question: 'Why is Redis Pub/Sub acceptable as a chat backplane despite offering no delivery guarantees?',
      options: [
        'Durability lives elsewhere (Kafka/DB); the backplane only handles the low-latency hot path, and clients reconcile via sequence numbers on reconnect',
        'Redis Pub/Sub is actually durable through AOF persistence',
        'Message loss is acceptable in chat applications',
        'Gateways retry publishes until every subscriber acks',
      ],
      answer: 0,
      explanation:
        'The design is layered: messages are persisted (Kafka/message store) before fan-out, so a dropped pub-sub delivery is healed when the client syncs from its last sequence number. The backplane is allowed to be fast and lossy.',
    },
    {
      question: 'In stream processing, a watermark is…',
      options: [
        'A checksum proving events were not tampered with',
        'The maximum events per second a job may consume',
        "The processor's moving estimate that events older than time T have all arrived, used to decide when windows can fire",
        'A marker Kafka writes every 1,000 messages',
      ],
      answer: 2,
      explanation:
        'Watermarks solve out-of-order event time: when the watermark passes the end of a window, the window closes and emits. Events arriving later than the watermark are dropped or handled as corrections.',
    },
    {
      question: 'You deploy a new gateway version by restarting all nodes at once. What goes wrong?',
      options: [
        'Nothing, since WebSocket clients transparently fail over',
        'A reconnect stampede: hundreds of thousands of clients re-handshake and re-auth simultaneously, hammering auth and the registry',
        'Kafka loses the messages in flight',
        'The load balancer caches dead backends for 24 hours',
      ],
      answer: 1,
      explanation:
        'Every dropped connection reconnects at nearly the same moment: a thundering herd of TLS handshakes and auth checks. Connection draining (trickle disconnects over 10–30 min) plus jittered client backoff is the standard fix.',
    },
  ],
  interviewQuestions: [
    {
      question: 'When would you choose SSE over WebSockets, and vice versa?',
      hint: 'Structure: direction of data flow (SSE is server→client only), infrastructure compatibility (SSE is plain HTTP, so proxies/CDNs/LBs just work), reconnect semantics (EventSource auto-resume vs DIY), then concrete examples: notifications and LLM token streams → SSE; chat/games/collab → WebSockets.',
      difficulty: 'Junior',
    },
    {
      question: 'Design the realtime delivery layer for a Slack-like chat with 2M concurrent users.',
      hint: 'Expected shape: ~20–50 gateway nodes (40–100K conns each, ~10 KB/conn memory math), L4 LB with sticky connections, connection registry + presence in Redis with TTLs, Redis pub-sub backplane for fan-out, Kafka/DB for durability, sequence-number resume protocol, and connection draining for deploys.',
      difficulty: 'Mid',
    },
    {
      question: 'Your presence system melts when a popular user with 50K followers flaps between online/offline on bad Wi-Fi. Fix it.',
      hint: 'Look for: debouncing status changes (5–10 s before broadcasting offline), TTL-based liveness instead of trusting disconnect events, converting broadcast fan-out to pull/subscription for visible-on-screen users only, and rate-limiting presence updates per user.',
      difficulty: 'Mid',
    },
    {
      question: 'Design realtime surge pricing: rides-per-minute per city zone, correct under late and out-of-order events, surviving worker crashes.',
      hint: 'Senior answer covers: Kafka-partitioned events by zone, a stream processor (Flink) with tumbling/sliding windows keyed by zone, event time + watermarks (e.g. 10–30 s lateness allowance) for out-of-order GPS pings, checkpointed state for exactly-once recovery, and what happens to too-late events (side output / corrections).',
      difficulty: 'Senior',
    },
  ],
  commonMistakes: [
    'Choosing WebSockets when SSE would do. If data only flows server→client, WebSockets buy you nothing except losing HTTP’s free infrastructure: proxies, auto-reconnect, HTTP/2 multiplexing, simpler auth.',
    'Trusting disconnect events for presence. Crashed processes, killed apps, and dropped trains never send a close frame. Liveness must come from heartbeats plus TTL expiry, with debounce before announcing offline.',
    'Forgetting deploys drop every connection. Without draining and jittered client backoff, each release triggers a self-inflicted thundering herd against your auth service.',
    'No backpressure on the push path. One slow client on hotel Wi-Fi can balloon server-side write buffers; cap bufferedAmount, disconnect laggards, and let them resume via sequence replay.',
    'Acking a chat message after pub-sub publish but before durable persistence. The sender sees "delivered", a gateway dies, the message is gone forever. Persist to Kafka/the store first, then ack, then fan out.',
  ],
  cloudMappings: [
    { concept: 'Managed WebSocket endpoint', aws: 'API Gateway WebSocket APIs / AppSync', gcp: 'Cloud Run (WS support) + Memorystore', azure: 'Azure Web PubSub / SignalR Service' },
    { concept: 'Pub-sub backplane', aws: 'ElastiCache (Redis Pub/Sub)', gcp: 'Memorystore (Redis Pub/Sub)', azure: 'Azure Cache for Redis' },
    { concept: 'Durable event stream', aws: 'MSK / Kinesis Data Streams', gcp: 'Pub/Sub', azure: 'Event Hubs' },
    { concept: 'Stream processing', aws: 'Managed Service for Apache Flink', gcp: 'Dataflow', azure: 'Stream Analytics / Flink on HDInsight' },
    { concept: 'L4 load balancer for WS', aws: 'NLB', gcp: 'Network Load Balancing', azure: 'Azure Load Balancer' },
    { concept: 'Mobile push (offline fallback)', aws: 'SNS Mobile Push', gcp: 'Firebase Cloud Messaging', azure: 'Notification Hubs' },
  ],
}

export default realtimeSystems
