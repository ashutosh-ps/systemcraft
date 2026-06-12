import type { Module } from '../../../lib/types'

const cdnEdge: Module = {
  id: 'cdn-edge',
  category: 'advanced',
  title: 'CDNs & Edge Computing',
  description:
    'Physics makes distant servers slow. CDNs move bytes — and increasingly compute — to within ~30 ms of every user. Learn PoPs, cache headers, invalidation, edge functions, and signed URLs.',
  difficulty: 'Mid',
  estMinutes: 120,
  keywords: ['CDN', 'edge computing', 'Cache-Control', 'origin shield', 'anycast', 'stale-while-revalidate', 'signed URLs'],
  related: ['caching', 'load-balancing', 'design-youtube', 'design-instagram'],
  sections: [
    {
      type: 'text',
      title: 'Distance is latency: the speed-of-light budget',
      md: `
No amount of clever engineering beats physics. Light in fiber travels at ~200,000 km/s (two-thirds of c, thanks to
the glass's refractive index) — about **5 ms per 1,000 km one way, ~10 ms round trip**. And real packets don't take
great-circle routes; they zigzag through carrier hotels and add router hops, so multiply the theoretical minimum by
1.5–2×.

The budget for a user in Sydney hitting a server in Virginia (~15,700 km):

- Theoretical RTT floor: ~157 ms. Observed in practice: **~200–230 ms**.
- TCP + TLS 1.3 handshake: 2 round trips before the first byte of your request even ships → **~400–460 ms**.
- A page making 4 sequential requests: **over a second of pure travel time**, before your servers do any work.

Compare a CDN edge node 30 km away in Sydney: **~1–10 ms RTT**, handshake included for cached content. Same app, same
code — 50× faster, purely by moving bytes closer.

This is the entire thesis of a **Content Delivery Network**: thousands of cache servers in hundreds of cities, so
that for the ~90–99% of requests that hit cache, the speed-of-light tax is nearly zero. Cloudflare operates in
**300+ cities** claiming ~95% of the internet's population within ~50 ms; CloudFront runs **600+ PoPs**; Fastly bets
on fewer (~100) but much larger PoPs.

> Rule of thumb for interviews: same city ~1–10 ms, same continent ~20–60 ms, cross-continent ~100–250 ms RTT. Any
> design serving global users from one region eats that last number on every uncached request.
`,
    },
    {
      type: 'text',
      title: 'CDN mechanics: PoPs, anycast, and the origin shield',
      md: `
A CDN is a tree of caches between users and your origin:

- **PoPs (points of presence)** — racks of cache servers in internet exchange points worldwide. Users reach the
  nearest one via **anycast**: every PoP advertises the *same IP* (e.g. Cloudflare's 104.16.0.0/13) via BGP, and
  internet routing naturally delivers each packet to the topologically closest PoP. No GeoDNS gymnastics; failover is
  automatic because a withdrawn route stops attracting traffic.
- **Cache hierarchy** — a miss at an edge PoP doesn't necessarily go to your origin. Edges often check a **regional
  shield/parent tier** first, which aggregates misses from dozens of edges.
- **Origin shield** — one designated PoP that all others fetch through on a miss. With 300 PoPs and no shield, an
  expiring popular object can trigger up to 300 simultaneous origin fetches; with a shield, **one** request reaches
  the origin and 300 PoPs share the answer. Origin offload routinely improves from ~85% to **98%+**.
- **Request collapsing** — within a PoP, 10,000 concurrent requests for the same uncached object become a single
  origin fetch; the other 9,999 wait on it. This plus the shield is your thundering-herd insurance.

What CDNs cache by default: responses with explicit caching headers, keyed by URL (plus any headers/cookies you
configure into the **cache key** — keep that key minimal; adding \`Cookie\` to it destroys your hit ratio). Static
assets routinely hit **90–99%**; even "dynamic" HTML cached for 30 s can absorb a front-page traffic spike.
`,
    },
    {
      type: 'diagram',
      title: 'Global CDN topology',
      caption:
        'Anycast pulls each user to the nearest PoP; misses funnel through an origin shield so the origin sees a tiny, smooth fraction of total traffic.',
      diagram: {
        height: 440,
        nodes: [
          {
            id: 'user-eu',
            label: 'User (Berlin)',
            kind: 'client',
            x: 20,
            y: 70,
            detail:
              'Resolves the same anycast IP as every other user worldwide; BGP routing lands them on the Frankfurt PoP, ~8 ms away.',
          },
          {
            id: 'user-au',
            label: 'User (Sydney)',
            kind: 'client',
            x: 20,
            y: 310,
            detail:
              'Without a CDN this user pays ~220 ms RTT to a US-East origin on every request. Via the Sydney PoP: ~5 ms for the 95%+ of requests that hit cache.',
          },
          {
            id: 'pop-eu',
            label: 'Edge PoP (FRA)',
            kind: 'cdn',
            x: 230,
            y: 70,
            detail:
              'Cache servers in a Frankfurt exchange. Hit ratio ~95% on this site. Also terminates TLS, so even cache misses save one full handshake round trip to the US.',
          },
          {
            id: 'pop-au',
            label: 'Edge PoP (SYD)',
            kind: 'cdn',
            x: 230,
            y: 310,
            detail:
              'Identical config, locally cached working set. Within the PoP, request collapsing turns 10K concurrent requests for one cold object into a single upstream fetch.',
          },
          {
            id: 'shield',
            label: 'Origin Shield',
            kind: 'cdn',
            x: 460,
            y: 190,
            detail:
              'A designated PoP near the origin (e.g. Ashburn) that all edges fetch through. Collapses misses from 300+ PoPs into one origin request per object — origin offload rises from ~85% to 98%+.',
          },
          {
            id: 'origin',
            label: 'Origin (us-east)',
            kind: 'server',
            x: 690,
            y: 70,
            detail:
              'The app servers. Thanks to the shield they see ~2% of total request volume, smooth instead of spiky — a fleet sized for 1,000 QPS fronts 50,000 QPS of user traffic.',
          },
          {
            id: 's3',
            label: 'Media storage',
            kind: 'storage',
            x: 690,
            y: 310,
            detail:
              'Object store for images/video. Origin-to-CDN transfer is free on same-vendor pairs (S3 → CloudFront), so the CDN also slashes egress cost, not just latency.',
          },
        ],
        edges: [
          { from: 'user-eu', to: 'pop-eu', label: 'anycast ~8 ms' },
          { from: 'user-au', to: 'pop-au', label: 'anycast ~5 ms' },
          { from: 'pop-eu', to: 'shield', label: 'miss (~5%)' },
          { from: 'pop-au', to: 'shield', label: 'miss (~5%)' },
          { from: 'shield', to: 'origin', label: 'collapsed fetch' },
          { from: 'shield', to: 's3', label: 'media fill' },
        ],
      },
    },
    {
      type: 'text',
      title: 'Cache-Control: the protocol you already ship',
      md: `
HTTP caching is controlled by response headers — no CDN config required if you get these right:

- \`Cache-Control: max-age=31536000\` — any cache (browser *and* CDN) may store this for a year.
- \`s-maxage=600\` — overrides \`max-age\` for **shared caches only** (CDNs). The killer combo:
  \`max-age=0, s-maxage=600\` means "browsers must revalidate, but the CDN may serve it for 10 minutes" — you keep
  purge-ability at the edge without stale browsers you can't reach.
- \`stale-while-revalidate=60\` — after expiry, serve the stale copy *instantly* while refreshing in the background.
  Users never wait on origin latency; your cache is at worst a TTL+60 s behind. This single directive removes the
  latency cliff at expiry.
- \`stale-if-error=86400\` — origin down? Serve yesterday's copy rather than a 502. Free graceful degradation.
- \`private\` — browser may cache, CDN must not (user-specific data). \`no-store\` — nobody caches (auth tokens, PII).
- \`ETag\` + conditional requests — revalidation costs a ~100-byte 304 instead of a full body transfer.

Two mistakes dominate real-world incidents:

1. **Caching personalized responses in a shared cache.** \`Cache-Control: max-age=600\` on \`/api/me\` once served
   user A's profile to user B. If a response varies per user, it's \`private\` or \`no-store\` — full stop.
2. **No headers at all**, which makes CDN behavior vendor-default-dependent and browsers guess (heuristic caching).
   Be explicit on every route.
`,
    },
    {
      type: 'code',
      title: 'Header recipes that cover 95% of routes',
      language: 'nginx',
      code: `
# --- 1. Fingerprinted static assets: app.4f8a2c.js, photo.a1b2.webp ---
# Content is immutable -- the URL changes when the content changes.
location ~* "\\.[0-9a-f]{6,}\\.(js|css|woff2|png|webp|avif)$" {
    add_header Cache-Control "public, max-age=31536000, immutable";
    # 1 year, and "immutable" stops browsers revalidating on reload.
}

# --- 2. HTML shell: must pick up deploys quickly ---
location / {
    add_header Cache-Control
      "public, max-age=0, s-maxage=300, stale-while-revalidate=60, stale-if-error=86400";
    # Browser: always revalidate (cheap 304s via ETag).
    # CDN: cache 5 min, refresh in background, survive origin outages.
}

# --- 3. Public API, read-heavy (product listings, search results) ---
location /api/products {
    add_header Cache-Control "public, s-maxage=30, stale-while-revalidate=30";
    add_header Vary "Accept-Encoding";
    # 30s edge cache absorbs traffic spikes; clients always revalidate.
}

# --- 4. Per-user API: never let a shared cache touch it ---
location /api/me {
    add_header Cache-Control "private, no-store";
}

# Golden rules:
#  - Versioned URL?            -> max-age=1y, immutable. Never purge.
#  - Shared but changes?       -> small s-maxage + stale-while-revalidate.
#  - Personalized?             -> private or no-store. No exceptions.
`,
    },
    {
      type: 'text',
      title: 'Invalidation: versioned URLs beat purges',
      md: `
"How do I update a file cached in 300 cities for a year?" Wrong question. The right design makes invalidation
unnecessary:

#### Versioned (fingerprinted) URLs — the gold standard

Every build hashes each asset's content into its filename: \`app.4f8a2c.js\`. Deploying new code produces a *new URL*;
the HTML (cached only ~minutes) references it; the old file simply ages out untouched. You get:

- **Atomic deploys** — old HTML keeps loading old assets; no mid-deploy version skew where new HTML pulls old JS.
- **Instant rollback** — re-point the HTML; both asset versions are still cached.
- **max-age=1 year, immutable** with zero risk. Every bundler (Vite, webpack, Next.js) does this by default.

#### Purges — the escape hatch

For content you *can't* version — HTML at a fixed URL, a product image you must replace in place — CDNs offer purge
APIs. Speed varies wildly by vendor: **Fastly purges globally in ~150 ms** (it's a core product feature),
**Cloudflare in seconds**, **CloudFront invalidations take minutes** and cost $0.005/path after the first 1,000/month.
Tag-based purging ("purge everything tagged product-1234") via \`Surrogate-Key\` headers is the scalable variant.

> The hierarchy: versioned URLs > short TTL + stale-while-revalidate > tag-based purge > path purge > "purge
> everything" (the panic button that also nukes your hit ratio and stampedes your origin).
`,
    },
    {
      type: 'text',
      title: 'Compute at the edge — and keeping private content private',
      md: `
Modern CDNs run your code in every PoP, not just your bytes:

- **Cloudflare Workers** run on V8 **isolates** — no container, no VM — giving **~0 ms cold starts (<5 ms)** and a
  free tier of 100K requests/day. Constraints: V8 runtime (JS/WASM), 128 MB memory, CPU-milliseconds budgets.
- **Lambda@Edge** runs full Node/Python at AWS regional edge locations: more powerful, but cold starts of
  **hundreds of ms to seconds** and ~$0.60/million requests vs Workers' ~$0.30/million. CloudFront Functions is the
  lightweight sibling (sub-ms, but ~10 KB of JS for header tweaks only).

What edge code is *for*: A/B test bucketing without a round trip, auth token validation before requests reach you,
geo-personalization (currency, language), rewriting cache keys, serving entire APIs from edge KV stores. What it's
*not* for: anything needing your primary database — the edge is 100+ ms from your data, so a "fast" edge function
that makes 3 origin DB calls is slower than no edge function at all.

#### Signed URLs: private content on a public CDN

You can't put \`Authorization\` checks on every image if the CDN serves them without touching your origin. Instead,
your app **signs URLs**: it appends an expiry timestamp and an HMAC (or RSA) signature —
\`/video.mp4?expires=1718200000&sig=9f3a...\` — and edge servers validate the signature cryptographically, **no origin
call needed**. Expired or tampered → 403 at the edge.

- S3 presigned URLs and CloudFront signed URLs/cookies: standard for private media (signed *cookies* cover "this user
  may fetch all 2,000 segments of this video" without signing each one).
- Typical expiry: minutes for downloads, hours for video sessions.
- This is exactly how Netflix, YouTube, and every paid-content site gate media at CDN scale.
`,
    },
    {
      type: 'comparison',
      title: 'CloudFront vs Cloudflare vs Fastly',
      comparison: {
        columns: ['Criterion', 'CloudFront (AWS)', 'Cloudflare', 'Fastly'],
        rows: [
          ['Network shape', '600+ PoPs, deep AWS integration', '300+ cities, anycast everything', '~100 huge PoPs (fewer, beefier)'],
          ['Pricing model', '$0.085/GB first 10 TB (US/EU), tiers down; free from S3/EC2 to CDN', 'Flat plans; bandwidth effectively free on most plans (R2 egress $0)', 'Usage-based ~$0.12/GB + per-request; enterprise-leaning'],
          ['Purge speed', 'Minutes; $0.005/path past 1,000/mo', 'Seconds; free', '~150 ms globally; tag (surrogate-key) purge is first-class'],
          ['Edge compute', 'Lambda@Edge (100ms–1s+ cold starts) + CloudFront Functions (sub-ms, tiny)', 'Workers: V8 isolates, ~0 ms cold start, KV/D1/R2/Durable Objects', 'Compute@Edge (WASM, ~µs startup) + VCL for cache logic'],
          ['Config & DX', 'CloudFormation/Terraform; changes deploy in minutes', 'Dashboard + Wrangler CLI; instant global config', 'VCL/API; instant config deploys (~seconds)'],
          ['Sweet spot', 'AWS-native stacks (S3, ALB, MediaStore origins)', 'Whole-site fronting, security bundle (WAF/DDoS), generous free tier', 'Realtime purge needs: news, e-commerce inventory, API caching'],
        ],
        verdict:
          'Already on AWS with S3 origins? CloudFront is the path of least resistance and free origin fetch. Want edge compute and a security bundle with flat pricing? Cloudflare. Need sub-second invalidation as a product feature (live inventory, breaking news)? Fastly.',
      },
    },
    {
      type: 'keyNumbers',
      title: 'CDN numbers worth memorizing',
      numbers: [
        { metric: 'Light in fiber', value: '~5 ms / 1,000 km (one way)', context: 'Physics floor, ~10 ms RTT per 1,000 km. Real routes run 1.5–2× worse.' },
        { metric: 'Cross-continent RTT', value: '~100–250 ms', context: 'Sydney→Virginia ~220 ms. With TLS setup, first byte costs 2+ RTTs.' },
        { metric: 'Edge PoP RTT', value: '~10–30 ms', context: 'What a CDN buys you; under 10 ms in well-served metros.' },
        { metric: 'Static asset hit ratio', value: '90–99%', context: 'Origin sees 1–10% of traffic. HTML/API caching runs lower (60–90%).' },
        { metric: 'CloudFront egress', value: '$0.085/GB (first 10 TB, US/EU)', context: 'Tiers down to ~$0.02/GB at PB scale; S3→CloudFront transfer is free.' },
        { metric: 'Workers cold start', value: '~0 ms (<5 ms)', context: 'V8 isolates vs 100 ms–1 s+ for Lambda@Edge containers.' },
        { metric: 'Fastly global purge', value: '~150 ms', context: 'Vs seconds (Cloudflare) and minutes (CloudFront). Matters for live content.' },
        { metric: 'Cloudflare reach', value: '300+ cities', context: '~95% of internet users within ~50 ms of a PoP.' },
      ],
    },
    {
      type: 'beforeAfter',
      title: 'Case: media-heavy page, with and without a CDN',
      scenario: {
        beforeTitle: 'Single-region origin (us-east-1) serves everything',
        beforeDescription:
          'A photo-feed page (2.5 MB: HTML + 30 images) served straight from app servers + S3. Sydney users pay ~220 ms RTT per connection plus transfer; p75 TTFB abroad is ~600 ms and the page settles in 4–6 s. Egress: 50 TB/month of S3 → internet at $0.09/GB ≈ $4,500.',
        afterTitle: 'CloudFront in front: fingerprinted assets, s-maxage HTML, shield on',
        afterDescription:
          'Images and JS/CSS are fingerprinted (max-age=1y immutable, 98% hit ratio); HTML cached at edge for 5 min with stale-while-revalidate; origin shield collapses misses. Sydney users hit the SYD PoP at ~5 ms; origin traffic drops ~50×. S3 → CloudFront transfer is free; CDN egress bills at $0.085/GB tiering down.',
        metrics: [
          { label: 'TTFB (Sydney, p75)', before: '~600 ms', after: '~40 ms', improved: true },
          { label: 'Full page load (Sydney)', before: '4–6 s', after: '1–1.5 s', improved: true },
          { label: 'Origin bandwidth', before: '50 TB/month', after: '~1 TB/month', improved: true },
          { label: 'Monthly egress cost', before: '~$4,500 (S3 → internet)', after: '~$3,800 (CDN tiered, free origin fetch)', improved: true },
          { label: 'Origin exposure to spikes', before: 'Every request', after: '~2% of requests, smoothed by shield', improved: true },
        ],
      },
    },
  ],
  quiz: [
    {
      question: 'A user in Sydney calls an API in Virginia (~15,700 km). Ignoring server time, roughly what is the floor for a single HTTPS request on a cold connection?',
      options: [
        '~50 ms — modern TLS is free',
        '~150 ms — one round trip',
        '~700 ms — DNS makes it unbounded',
        '~450 ms — TCP+TLS handshakes cost ~2 RTTs before the request, at ~220 ms real-world RTT',
      ],
      answer: 3,
      explanation:
        'Real-world Sydney↔Virginia RTT is ~200–230 ms (physics floor ~157 ms × routing overhead). TLS 1.3 needs ~2 RTTs to first byte on a cold connection: roughly 2 × 220 ms ≈ 450 ms before any server work.',
    },
    {
      question: 'What does an origin shield primarily protect against?',
      options: [
        'DDoS attacks on the edge PoPs',
        'Hundreds of PoPs independently fetching the same expiring object — a thundering herd on the origin',
        'Stale content being served after a purge',
        'TLS downgrade attacks between edge and origin',
      ],
      answer: 1,
      explanation:
        'Without a shield, every PoP that misses goes to your origin — potentially 300+ simultaneous fetches per object. The shield funnels all PoP misses through one cache, so the origin sees one request and offload climbs to 98%+.',
    },
    {
      question: 'Which header tells CDNs to cache for 10 minutes while forcing browsers to revalidate every time?',
      options: [
        'Cache-Control: max-age=0, s-maxage=600',
        'Cache-Control: private, max-age=600',
        'Cache-Control: no-store, s-maxage=600',
        'Expires: +10m with ETag',
      ],
      answer: 0,
      explanation:
        's-maxage applies only to shared caches (CDNs) and overrides max-age there; max-age=0 makes browsers revalidate. private would forbid CDN caching entirely, and no-store forbids caching for everyone.',
    },
    {
      question: 'Why are fingerprinted asset URLs (app.4f8a2c.js) superior to purging on deploy?',
      options: [
        'They compress better at the edge',
        'CDNs refuse to purge JavaScript files',
        'New content gets a new URL, so caches never need invalidation, deploys are atomic, and rollbacks are instant',
        'They prevent cross-site scripting',
      ],
      answer: 2,
      explanation:
        'Content-hashed URLs make cached objects immutable: old HTML references old assets, new HTML references new ones — no version skew, no purge propagation delay, and both versions remain cached for rollback.',
    },
    {
      question: 'Why do Cloudflare Workers start in ~0 ms while Lambda@Edge can take a second?',
      options: [
        'Workers are precompiled to machine code',
        'Workers run as V8 isolates inside an already-running process — no container or VM to boot per tenant',
        'Cloudflare has more data centers, so code is always nearby',
        'Lambda@Edge re-downloads the function bundle on every request',
      ],
      answer: 1,
      explanation:
        'Isolates share one warm V8 process with per-tenant sandboxing, so "cold start" is just instantiating a context (<5 ms). Lambda@Edge provisions a microVM/container per concurrent execution, which costs hundreds of ms when cold.',
    },
  ],
  interviewQuestions: [
    {
      question: 'Walk me through what happens when a user requests an image served via a CDN, on both a cache hit and a miss.',
      hint: 'Expected flow: DNS/anycast to nearest PoP → TLS terminates at edge → cache-key lookup. Hit: served in ~10–30 ms. Miss: edge → regional tier/origin shield → origin, with request collapsing; response stored per Cache-Control. Bonus: mention the response headers that controlled it (s-maxage, age, x-cache).',
      difficulty: 'Junior',
    },
    {
      question: 'Design the caching strategy for a news site: breaking-news headlines must update within seconds, but pages get traffic spikes of 100×.',
      hint: 'Good answers layer it: fingerprinted assets at max-age=1y; article HTML with s-maxage=5–30 s + stale-while-revalidate (absorbs spikes while staying seconds-fresh); tag-based purge (surrogate keys) for corrections; origin shield + request collapsing for the spike; discussion of why Fastly-style ~150 ms purge changes the design vs CloudFront-style minutes.',
      difficulty: 'Mid',
    },
    {
      question: 'Your CDN bill shows a 60% cache hit ratio on static assets. Diagnose and fix.',
      hint: 'Look for: cache key polluted by query strings/cookies/headers (Vary: Cookie is the classic killer), missing or short max-age, assets not fingerprinted so TTLs were kept timid, too many PoPs each holding a cold copy (enable origin shield/tiered caching), and unbatched purges resetting everything. Structure: measure per-URL hit ratio first, fix the key, then the TTLs.',
      difficulty: 'Mid',
    },
    {
      question: 'Design private video delivery for a paid-courses platform: 4K video, global users, no origin involvement per segment, links must not be shareable.',
      hint: 'Senior shape: HLS/DASH segments on object storage behind CDN; signed cookies (not per-segment URLs) scoped to the course path with hours-long expiry; edge validation of HMAC/RSA signatures with zero origin calls; short-lived signing endpoint behind auth; discuss key rotation, expiry vs UX on resume, and why DRM (Widevine/FairPlay) is the answer to determined pirates, not signatures.',
      difficulty: 'Senior',
    },
  ],
  commonMistakes: [
    'Letting cookies or query strings into the cache key. One marketing utm_ parameter and every visitor gets a unique cache entry — hit ratio collapses to nothing while everyone blames the CDN.',
    'Caching personalized responses in a shared cache. max-age on /api/me has served user A’s data to user B at real companies. Per-user responses are private or no-store, every time.',
    'Relying on purges as the deploy mechanism. CloudFront invalidations take minutes and old browsers cache aggressively — fingerprinted URLs make the whole problem disappear.',
    'Treating the CDN as static-only. Caching HTML or read-heavy APIs for even 10–30 s with stale-while-revalidate absorbs 100× spikes; teams leave this on the table because "our content is dynamic".',
    'Putting an edge function in front of every request that then calls the origin database three times. The edge is 100+ ms from your data; edge compute must work with edge-local state (KV, cache, request itself) or it makes latency worse.',
  ],
  cloudMappings: [
    { concept: 'CDN', aws: 'CloudFront', gcp: 'Cloud CDN / Media CDN', azure: 'Azure Front Door / CDN' },
    { concept: 'Edge functions (full runtime)', aws: 'Lambda@Edge', gcp: 'Cloud Run + Cloud CDN (no true equivalent)', azure: 'Front Door rules + Azure Functions' },
    { concept: 'Lightweight edge logic', aws: 'CloudFront Functions', gcp: 'Cloud CDN cache rules / Service Extensions', azure: 'Front Door Rules Engine' },
    { concept: 'Signed URLs / private content', aws: 'CloudFront signed URLs & cookies, S3 presigned', gcp: 'Cloud CDN signed URLs / signed cookies', azure: 'SAS tokens + Front Door' },
    { concept: 'Origin object storage', aws: 'S3 (free transfer to CloudFront)', gcp: 'GCS', azure: 'Blob Storage' },
    { concept: 'DDoS / WAF at edge', aws: 'AWS WAF + Shield', gcp: 'Cloud Armor', azure: 'Azure WAF + DDoS Protection' },
  ],
}

export default cdnEdge
