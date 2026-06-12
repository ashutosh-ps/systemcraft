import type { Module } from '../../../lib/types'

const designYoutube: Module = {
  id: 'design-youtube',
  category: 'case-studies',
  title: 'Design YouTube / Video Streaming',
  description:
    'Ingest 500 hours of video per minute, transcode it into an adaptive bitrate ladder, and stream it from CDN edges worldwide. The core problems: the transcoding pipeline, ABR delivery, and counting billions of views without melting a database.',
  difficulty: 'Senior',
  estMinutes: 170,
  keywords: ['video streaming', 'transcoding', 'adaptive bitrate', 'HLS', 'DASH', 'CDN', 'codec', 'view counting'],
  related: ['cdn-edge', 'message-queues', 'caching', 'design-instagram'],
  sections: [
    {
      type: 'text',
      title: 'Step 1: Requirements — scope before you draw boxes',
      md: `
Video platforms are three systems wearing one trenchcoat: an **upload/processing pipeline**, a **delivery network**,
and a **metadata site**. Scope all three, then spend your depth on the first two.

**Functional requirements**

- **Upload**: creators upload files up to tens of GB; uploads must survive flaky connections (resumable).
- **Transcode**: every upload becomes a ladder of resolutions/bitrates (144p → 4K) in multiple codecs.
- **Stream**: playback starts in under ~1–2 s and adapts to the viewer's bandwidth (adaptive bitrate).
- **Metadata**: titles, descriptions, channels, thumbnails; search by title.
- **Views & likes**: counted at billions/day scale.

**Scope cuts to state explicitly**: comments and recommendations are their own systems — mention that comments are
a standard sharded-by-video discussion store and recommendations are an ML serving problem, then move on. Live
streaming changes everything (latency budgets, no full-file transcode) — park it unless asked.

**Non-functional requirements**

- **Durability above all** for uploaded masters: a creator's source file is irreplaceable — 11 nines durability
  (object storage), never a single disk.
- **Startup latency < 2 s**, rebuffer ratio < 0.5% — these correlate directly with watch time.
- **Read:write asymmetry is extreme**: ~500 hours uploaded/minute vs ~1B+ hours watched/day — roughly a
  **1 : 200 ratio of ingest to consumption**. Optimize delivery cost first; egress, not storage, dominates the bill.
- Eventual consistency is fine almost everywhere: a view count that lags 30 s harms nobody.

> Interview tip: say "writes are expensive but rare; reads are cheap but astronomical — so I'll make writes
> asynchronous and reads cache-shaped" before drawing anything.
`,
    },
    {
      type: 'code',
      title: 'Step 2: Capacity estimation — storage is the headline number',
      language: 'python',
      code: `
# --- Ingest ---
upload_hours_per_min = 500                 # YouTube's public number
upload_hours_per_day = 500 * 60 * 24       # 720,000 hours/day

# Source files: assume avg 1080p upload at ~8 Mbps consumer bitrate
source_gb_per_hour = 8 / 8 * 3600          # 8 Mbps -> 1 MB/s -> 3.6 GB/hour
raw_ingest_per_day = 720_000 * 3.6 / 1024  # ~2.5 PB/day of masters

# --- Transcoded ladder (what you actually serve) ---
# H.264 ladder, GB per source hour:
ladder = {
    '2160p': 16.0, '1440p': 9.0, '1080p': 4.5, '720p': 2.7,
    '480p': 1.1, '360p': 0.6, '240p': 0.3, '144p': 0.1,
}
ladder_gb_per_hour = sum(ladder.values())  # ~34 GB/hour... but most
# uploads are <=1080p, so realistic blended ladder ~= 10 GB/hour
ladder_per_day_pb = 720_000 * 10 / 1024 / 1024   # ~6.9 PB/day transcoded
# Add a VP9/AV1 ladder for popular videos: x1.5 => ~10 PB/day total new storage
# => ~3.7 EB/year growth. This is why YouTube cares about codec efficiency.

# --- Delivery (the real cost center) ---
watch_hours_per_day = 1_000_000_000        # 1B+ hours/day
avg_stream_mbps = 3                        # blended across qualities/devices
egress_tbps = watch_hours_per_day * 3600 * avg_stream_mbps / 86_400 / 1e6
# ~125 Tbps average egress. At even $0.01/GB that's ~$13M/day --
# why YouTube/Netflix build their own CDN boxes inside ISPs.

# --- Transcode compute ---
# Rule of thumb: full H.264 ladder ~= 1-2x realtime on a modern core-cluster;
# VP9 ~4x, AV1 (software) ~10-20x H.264 cost. 720K hours/day of ingest
# => hundreds of thousands of cores, or custom ASICs (YouTube's Argos VCU).
`,
    },
    {
      type: 'calculator',
      title: 'Try it: storage math for your own video platform',
      calculator: 'storage',
    },
    {
      type: 'text',
      title: 'Step 3: The core deep-dive — upload and transcoding pipeline',
      md: `
The pipeline is the heart of the design. Three rules make it work at 500 hours/minute:

#### 1. Uploads are chunked and resumable
A 10 GB upload over residential internet *will* be interrupted. The client splits the file into chunks
(YouTube's resumable protocol uses ~8 MB+ chunks), uploads them in parallel, and on disconnect asks the server
"how much do you have?" and resumes from that offset. Chunks land directly in object storage via signed URLs — the
upload service orchestrates but never proxies bytes through itself.

#### 2. Transcoding is an embarrassingly parallel DAG
Never transcode a video as one job — a 4-hour 4K upload would take a day on one machine. Instead:

- **Split** the source into ~2–10 s segments aligned on keyframes (GOP boundaries).
- **Fan out** segments to a worker pool via a queue: each (segment × rung) is an independent task, so a 1-hour video
  becomes ~600 segments × 8 rungs ≈ **4,800 parallel tasks**, and wall-clock time collapses from hours to minutes.
- **Ladder**: encode every rung of the ABR ladder (144p → source resolution). H.264 for universal reach; VP9/AV1
  rungs are added for videos that earn views, since their encode cost only pays off when amortized over many plays.
- **Package** the encoded segments for HLS and DASH (or both at once via CMAF), generate manifests, thumbnails,
  and audio renditions; run content-ID and moderation as parallel branches of the same DAG.
- **Publish**: write rendition metadata, flip the video's status to \`ready\`, notify the creator.

#### 3. Everything is async and idempotent
Workers die mid-segment constantly at this scale. Tasks carry deterministic output keys
(\`videoId/rendition/segment_00042.m4s\`), so a retried task overwrites its own output harmlessly. The queue gives
you retries, backpressure, and priority lanes (a creator with 10M subscribers jumps the line).
`,
    },
    {
      type: 'diagram',
      title: 'Upload → transcode → publish pipeline',
      caption:
        'Bytes flow client → object storage directly; the control plane coordinates via queue and DAG state. Viewers only ever touch the CDN.',
      diagram: {
        height: 460,
        nodes: [
          { id: 'creator', label: 'Creator App', kind: 'client', x: 20, y: 200, detail: 'Splits the file into ~8 MB chunks, uploads in parallel over the resumable protocol, and resumes from the last acknowledged offset after a disconnect. A 10 GB upload completes in ~15 min on a 100 Mbps line.' },
          { id: 'upload', label: 'Upload Service', kind: 'service', x: 210, y: 200, detail: 'Issues signed URLs so chunks go straight to object storage (no bytes proxied), tracks received offsets, assembles/validates the master, then enqueues a transcode DAG and writes a draft metadata row.' },
          { id: 'raw', label: 'Raw Masters', kind: 'storage', x: 400, y: 60, detail: 'Immutable source-of-truth bucket: ~2.5 PB/day of new masters at 11-nines durability. Lifecycle policy tiers masters to cold storage after the transcode succeeds — they are read once and kept forever.' },
          { id: 'meta', label: 'Metadata DB', kind: 'db', x: 400, y: 200, detail: 'Video status, title, channel, rendition list, manifest pointers. Sharded MySQL/Vitess at YouTube scale — metadata is tiny (KBs/video) next to the video bytes but serves every page load.' },
          { id: 'queue', label: 'Transcode Queue', kind: 'queue', x: 400, y: 340, detail: 'Each (segment × rung) is one idempotent task: a 1-hour video fans out to ~4,800 tasks. Priority lanes let big-channel uploads and trending re-encodes jump ahead; dead-letter queue catches poison segments.' },
          { id: 'workers', label: 'Transcode Wkrs', kind: 'server', x: 600, y: 340, detail: 'Autoscaled fleet (spot/preemptible friendly — tasks are retryable). Software x264/libvpx/SVT-AV1, or ASICs: YouTube’s Argos VCU encodes 20-33x faster per watt than CPUs. Output: fMP4/CMAF segments per rung.' },
          { id: 'abr', label: 'ABR Store', kind: 'storage', x: 600, y: 200, detail: 'Packaged HLS/DASH segments + manifests, addressed as videoId/rendition/segment_N.m4s. This bucket is the CDN origin; ~7-10 PB/day of new renditions land here.' },
          { id: 'cdn', label: 'Multi-tier CDN', kind: 'cdn', x: 800, y: 200, detail: 'Edge PoPs (and ISP-embedded caches like Google Global Cache) serve 95%+ of bytes; misses go to regional shields, then origin. Origin offload >99% for popular content — origin egress is the cost to minimize.' },
          { id: 'viewer', label: 'Viewer Player', kind: 'client', x: 800, y: 60, detail: 'Fetches the manifest, then pulls 2-10 s segments, measuring throughput and buffer to pick the next rung. Startup target <2 s; rebuffer ratio target <0.5%.' },
        ],
        edges: [
          { from: 'creator', to: 'upload', label: 'chunked upload' },
          { from: 'upload', to: 'raw', label: 'signed-URL PUT' },
          { from: 'upload', to: 'meta', label: 'draft row' },
          { from: 'upload', to: 'queue', label: 'DAG tasks' },
          { from: 'queue', to: 'workers', label: 'seg × rung' },
          { from: 'workers', to: 'raw', label: 'read source', dashed: true },
          { from: 'workers', to: 'abr', label: 'HLS/DASH out' },
          { from: 'abr', to: 'cdn', label: 'origin pull' },
          { from: 'cdn', to: 'viewer', label: 'manifest + segs' },
        ],
      },
    },
    {
      type: 'text',
      title: 'Step 4: Adaptive bitrate streaming — how playback actually works',
      md: `
Naive streaming serves one MP4 file and prays. Adaptive bitrate (ABR) is what makes video watchable on a train:

- **The video is cut into segments** of ~2–10 s (YouTube uses ~5 s DASH segments), each encoded at every rung of
  the ladder: 144p/~100 kbps up to 2160p/~16 Mbps.
- **A manifest** (HLS \`.m3u8\` or DASH \`.mpd\`) lists every rendition and the URL pattern for its segments. The
  player downloads the manifest first — it's the menu.
- **The player is the brain.** It measures recent download throughput and current buffer depth, then picks the rung
  for the *next* segment: buffer healthy and throughput 2× the current rung → step up; buffer draining → step down
  *before* it empties. Switches land on segment boundaries, so the viewer sees a quality shift, never a stall.
- **The server is dumb.** Every "stream" is just HTTP GETs of small immutable files — which is precisely what makes
  CDNs work: no sessions, no special protocol, infinite cacheability.

Two refinements worth name-dropping:

1. **CMAF + fMP4** lets one set of segment files serve both HLS and DASH, halving storage and doubling cache
   efficiency versus packaging twice.
2. **Per-title encoding**: a static lecture compresses far better than a confetti-filled music video. Encoding to a
   fixed bitrate ladder wastes bits; Netflix-style per-title (or per-shot) analysis picks bitrates per video and
   saves ~20% egress at the same visual quality.

> The exam question behind ABR: *why segments instead of byte-range requests on one big file?* Because each segment
> is an independently cacheable, independently encodable unit — the same property powers parallel transcode and CDN
> efficiency.
`,
    },
    {
      type: 'text',
      title: 'Step 5: Delivery — multi-tier CDN and the long tail',
      md: `
At ~125 Tbps average egress, delivery is where the money goes. The architecture is a cache hierarchy:

- **Edge PoPs** (hundreds, inside or near ISPs — Google Global Cache, Netflix Open Connect): serve the hot set.
  For popular videos, edge hit ratios run **90–95%+**; the head of the catalog is tiny relative to its traffic
  share — roughly **1% of videos drive the majority of watch time**.
- **Regional shield / mid-tier caches** (tens): absorb edge misses so a newly-hot video is fetched from origin
  *once per region*, not once per PoP. This is **origin shielding** — without it, a viral video triggers a
  thundering herd of thousands of identical origin fetches (use request coalescing here too).
- **Origin** (object storage): serves the long tail and first-time fetches. Total origin offload should exceed
  **99% of bytes**.

The **long-tail problem** is the part interviewers want you to acknowledge: most of the *catalog* is almost never
watched. Caching it at the edge is pointless — it would evict hot content. So:

- Edges cache by **segment popularity**, not whole videos (everyone watches the first 30 s; far fewer finish).
- Long-tail requests route straight to shield/origin; the viewer pays one extra 30–80 ms RTT, which the player's
  buffer hides completely.
- Cold renditions (the AV1 ladder for a video with 12 views) may not exist at all — transcode the premium codec
  ladder *lazily*, triggered by popularity thresholds.

Egress economics drive everything: cloud CDN list price is ~$0.02–0.085/GB, negotiated volume deals reach
~$0.005–0.01/GB, and ISP-embedded boxes amortize to near-zero per GB — which is why every serious video platform
eventually builds one.
`,
    },
    {
      type: 'text',
      title: 'Step 6: Metadata and view counting at scale',
      md: `
**Metadata** is the easy half: a sharded relational store (YouTube famously runs MySQL behind **Vitess**, sharded
by video/channel) holding video rows, channel rows, and rendition pointers. Kilobytes per video, read on every
watch page — front it with a cache and replicate reads. The watch page does ~10 metadata lookups and zero video-byte
reads from the database; **the database never touches video bytes**.

**View counting** is the sneaky-hard half. A naive \`UPDATE videos SET views = views + 1\` is a row-lock fight: a
video doing 100K views/minute serializes 1,600 writes/sec on one hot row, and counts become the top write load of
the whole site. The scalable shape:

1. **Log, don't update.** Each playback event is appended to Kafka (billions/day — cheap, lock-free).
2. **Aggregate in stream.** A streaming job (Flink/Dataflow) windows events per video for ~10–60 s and emits one
   batched increment per video per window — turning 100K row updates into ~6 per minute.
3. **Serve approximately, reconcile exactly.** The watch page shows the streamed approximate count (nobody can tell
   301 views from 304 — YouTube's old "301+ views" froze precisely at the consistency boundary). Billing-grade
   counts (ads, payouts) come from batch reconciliation over the raw log, with dedup and fraud filtering.
4. **Dedup/abuse**: count a (user, video) at most once per window; discard non-organic patterns before they reach
   the monetized count.

> Pattern to generalize: **high-volume counters = event log + windowed aggregation + approximate serving + exact
> offline reconciliation.** It applies to likes, ad impressions, and metrics pipelines alike.
`,
    },
    {
      type: 'comparison',
      title: 'Codec choice: H.264 vs VP9 vs AV1',
      comparison: {
        columns: ['Criterion', 'H.264/AVC (2003)', 'VP9 (2013)', 'AV1 (2018)'],
        rows: [
          ['Compression vs H.264', 'Baseline', '~30-40% smaller at same quality', '~50% smaller than H.264, ~30% smaller than VP9'],
          ['Encode cost (software)', '1× (realtime-ish per core-cluster)', '~3-5× H.264', '~10-20× H.264 (SVT-AV1 narrowing this)'],
          ['Device decode support', 'Universal — every phone/TV since ~2010, hardware decode everywhere', 'Broad — Android, Chrome, most smart TVs; weak on older Apple devices', 'Growing — hardware decode in chips from ~2020-2021 (Snapdragon, Apple A17+, modern TVs)'],
          ['Licensing', 'Royalty-bearing (MPEG-LA pool)', 'Royalty-free (Google)', 'Royalty-free (AOMedia: Google, Netflix, Amazon, Apple…)'],
          ['Who serves it', 'The universal fallback rung', 'YouTube default for most playback', 'YouTube/Netflix for popular titles, where encode cost amortizes over millions of plays'],
        ],
        verdict:
          'Encode everything to H.264 for reach; add VP9/AV1 ladders selectively — premium codecs trade one-time encode CPU for perpetual egress savings, so spend them on videos with views. ~30% bitrate savings at 125 Tbps pays for a lot of encoding.',
      },
    },
    {
      type: 'beforeAfter',
      title: 'Case: single-bitrate MP4 from S3 vs ABR via CDN',
      scenario: {
        beforeTitle: 'One 1080p MP4, served straight from object storage',
        beforeDescription:
          'Every viewer gets the same 5 Mbps file from the origin bucket. Mobile users on 2 Mbps links stall every few seconds; startup waits for a large moov atom + first chunk; every byte pays full S3 egress (~$0.09/GB); a viral video hammers one bucket from every continent.',
        afterTitle: 'Eight-rung ABR ladder behind a multi-tier CDN',
        afterDescription:
          'Segments at 144p-2160p with HLS/DASH manifests; players adapt per-segment to measured bandwidth; edges + origin shield serve 99%+ of bytes; origin sees one fetch per segment per region.',
        metrics: [
          { label: 'Rebuffer ratio', before: '3-8% on mobile networks', after: '< 0.5%', improved: true },
          { label: 'Startup time (p50)', before: '4-6 s', after: '< 1.5 s', improved: true },
          { label: 'Egress unit cost', before: '~$0.09/GB origin egress', after: '~$0.01-0.02/GB via CDN contracts', improved: true },
          { label: 'Origin load on viral spike', before: 'Every viewer hits the bucket', after: '< 1% of requests reach origin', improved: true },
          { label: 'Storage per video-hour', before: '~2.2 GB (one rendition)', after: '~10 GB (full ladder)', improved: false },
        ],
      },
    },
    {
      type: 'keyNumbers',
      title: 'Numbers to anchor the design',
      numbers: [
        { metric: 'Upload rate (YouTube)', value: '500+ hours/minute', context: '720,000 hours/day of new source video — ~2.5 PB/day of masters before transcoding.' },
        { metric: '1 hour of 1080p', value: '~1-3 GB', context: 'At consumer bitrates (2.5-8 Mbps H.264). A full 8-rung ladder lands around 10 GB per source hour.' },
        { metric: 'AV1 vs VP9 bitrate', value: '~30% smaller', context: 'Same visual quality; AV1 is ~50% smaller than H.264. Costs 10-20× H.264 encode CPU in software.' },
        { metric: 'Transcode compute', value: '~$0.01-0.05/min (H.264, cloud)', context: 'Cloud transcoding list prices; AV1 multiplies this — why YouTube built the Argos VCU ASIC (20-33× efficiency).' },
        { metric: 'CDN egress pricing', value: '$0.02-0.085/GB list, <$0.01 negotiated', context: 'At ~125 Tbps average, egress dwarfs storage cost — the whole architecture bends around this line item.' },
        { metric: 'Watch volume', value: '1B+ hours/day', context: 'Ingest-to-consumption ratio ~1:200. Reads pay the bills and the design optimizes them first.' },
        { metric: 'Segment length', value: '2-10 s', context: 'The atomic unit of ABR switching, parallel transcoding, and CDN caching — one decision, three systems shaped by it.' },
      ],
    },
  ],
  quiz: [
    {
      question: 'Why is video split into 2-10 second segments rather than served as one file with byte-range requests?',
      options: [
        'HTTP cannot serve files larger than 2 GB',
        'Segments are independently cacheable, independently encodable units — enabling per-segment quality switching, parallel transcoding, and high CDN hit ratios',
        'Byte-range requests are not supported by object storage',
        'Segments encrypt better than whole files',
      ],
      answer: 1,
      explanation:
        'The segment is the atomic unit that makes three systems work at once: the player switches rungs at segment boundaries, transcode workers process segments in parallel, and CDNs cache small immutable files extremely well.',
    },
    {
      question: 'A 1-hour upload needs to be transcoded into an 8-rung ladder quickly. What is the right execution model?',
      options: [
        'One worker per video, encoding rungs sequentially from a single pass',
        'Eight workers, one per rung, each encoding the full hour',
        'Split into ~600 keyframe-aligned segments and fan out each (segment × rung) as an independent idempotent task — ~4,800 parallel jobs',
        'Transcode on the creator’s device before upload',
      ],
      answer: 2,
      explanation:
        'Segment-level fan-out collapses wall-clock time from hours to minutes and makes retries trivial (each task has a deterministic output key). One-worker-per-video leaves a 4-hour 4K upload running for a day.',
    },
    {
      question: 'Why does YouTube serve AV1 only for sufficiently popular videos rather than transcoding everything to AV1?',
      options: [
        'AV1 is patent-encumbered, so each play costs royalties',
        'AV1 quality is worse than VP9 for most content',
        'Browsers block AV1 for videos with few views',
        'AV1 costs ~10-20× the encode CPU of H.264 — a one-time cost that only pays off when ~30% bandwidth savings amortize over many plays',
      ],
      answer: 3,
      explanation:
        'Premium codecs trade one-time encode compute for perpetual egress savings. For a video with 12 views the encode never pays back; for a video with 10M views it pays back enormously. Hence lazy, popularity-triggered ladders.',
    },
    {
      question: 'What does an origin shield (mid-tier cache) protect against?',
      options: [
        'DDoS attacks on the player manifest',
        'A newly-popular video causing thousands of edge PoPs to independently fetch the same segments from origin — the shield collapses these into ~one fetch per region',
        'Viewers downloading videos faster than the CDN allows',
        'Stale manifests being cached at the edge',
      ],
      answer: 1,
      explanation:
        'Without a shield tier, every edge miss goes straight to origin, so a viral video means a thundering herd of identical requests. Shields (plus request coalescing) push origin offload beyond 99%.',
    },
    {
      question: 'A video receives 100K views/minute. Why is UPDATE videos SET views = views + 1 per view the wrong design?',
      options: [
        'SQL cannot increment integers atomically',
        'View counts must be exact at all times for advertisers',
        '~1,600 writes/sec serialize on one hot row’s lock; the fix is logging events to a stream and applying windowed batched increments, serving approximate counts',
        'The database would run out of storage for the counter',
      ],
      answer: 2,
      explanation:
        'Hot-row contention, not storage, is the killer. Log → window → one batched increment per video per 10-60 s turns 100K updates into ~6, while exact billing-grade counts come from offline reconciliation of the raw log.',
    },
  ],
  interviewQuestions: [
    {
      question: 'Walk me through what happens between a creator clicking "upload" and the video being playable worldwide.',
      hint: 'Chunked resumable upload via signed URLs → master in object storage → DAG fan-out (segment × rung) through a queue → packaged HLS/DASH renditions + manifests → metadata flip to ready → first plays warm the CDN tiers. Bonus points for time estimates per stage and idempotent retries.',
      difficulty: 'Junior',
    },
    {
      question: 'How does your design change for live streaming instead of video-on-demand?',
      hint: 'No full file: transcode a continuous stream in realtime with 2-6 s segments appended to a rolling manifest; latency budget (3-30 s glass-to-glass, lower with LL-HLS/chunked CMAF); no lazy codec ladders — you encode what you can in realtime; CDN caches very short-TTL segments; DVR window = retained segments.',
      difficulty: 'Senior',
    },
    {
      question: 'A video goes from 10 views to 10M views in an hour. Trace the load through your system — what breaks first and what saves you?',
      hint: 'CDN edges absorb the read storm (immutable segments cache perfectly); origin shield + request coalescing prevents origin herding; view-count pipeline batches harder under load (windows absorb spikes); watch out for: missing premium-codec renditions triggering lazy transcode, metadata cache stampede on the watch page, and comment/like hot partitions.',
      difficulty: 'Mid',
    },
    {
      question: 'Storage grows ~3-4 EB/year in this design. The CFO asks you to cut the storage bill 40% without deleting videos. What levers do you pull?',
      hint: 'Tier masters to cold/archive storage after transcode (read-once data); drop rarely-watched renditions and re-transcode lazily on demand (trade compute for storage); per-title encoding to shrink the ladder ~20%; re-encode old popular H.264 content to AV1; dedupe re-uploads via content hashing.',
      difficulty: 'Senior',
    },
  ],
  commonMistakes: [
    'Streaming video bytes through your application servers or storing them in a database. Bytes go client → object storage (signed URLs) and object storage → CDN → client; app servers only ever handle metadata and control flow.',
    'Designing transcoding as one job per video. A 4-hour 4K upload on one worker takes a day; segment-level fan-out (segment × rung as idempotent tasks) is the difference between hours and minutes — and what makes spot instances usable.',
    'Ignoring egress economics. Candidates obsess over storage (~$0.02/GB-month) when egress (~$0.05+/GB, paid on every view) dominates by 10-100×. Codec choice, per-title encoding, and CDN contracts are cost decisions, not just quality decisions.',
    'Proposing exact, synchronous view counts. A hot row taking 1,600 locked increments/sec is self-inflicted pain — log events, aggregate in windows, serve approximate counts, reconcile exactly offline for billing.',
    'Transcoding the full premium ladder (VP9 + AV1) for every upload. Most videos get almost no views; encode H.264 eagerly for reach and earn the expensive codecs through popularity thresholds.',
  ],
  cloudMappings: [
    { concept: 'Master + rendition storage', aws: 'S3 (+ Glacier tiers)', gcp: 'Cloud Storage (+ Archive class)', azure: 'Blob Storage (+ Cool/Archive)' },
    { concept: 'Managed transcoding pipeline', aws: 'Elemental MediaConvert', gcp: 'Transcoder API', azure: 'Azure Media Services (retired 2024; partner encoders)' },
    { concept: 'Transcode job queue', aws: 'SQS / MSK', gcp: 'Pub/Sub / Cloud Tasks', azure: 'Service Bus / Storage Queues' },
    { concept: 'CDN delivery', aws: 'CloudFront (+ Origin Shield)', gcp: 'Cloud CDN / Media CDN', azure: 'Azure Front Door / CDN' },
    { concept: 'View-event streaming + aggregation', aws: 'Kinesis + Flink (KDA)', gcp: 'Pub/Sub + Dataflow', azure: 'Event Hubs + Stream Analytics' },
    { concept: 'Sharded metadata store', aws: 'Aurora MySQL / DynamoDB', gcp: 'Cloud SQL + Vitess (GKE) / Spanner', azure: 'Azure Database for MySQL / Cosmos DB' },
  ],
}

export default designYoutube
