# SystemCraft. Interactive System Design Course

A professional, interactive system design course built as a single-page React app. 19 in-depth modules (~45 hours of content) covering fundamentals, advanced distributed-systems topics, and end-to-end case studies. With clickable architecture diagrams, capacity calculators, quizzes, and real production numbers throughout.

## Features

- **19 modules in 3 stages**. Fundamentals (6), Advanced Topics (8), Case Studies (5)
- **Interactive SVG architecture diagrams**. Click any component to explore what it does, with real throughput/latency/cost figures
- **Capacity calculators**. QPS, storage, bandwidth, and cache-sizing estimators with log-scale sliders
- **CAP trade-off explorer**. Drag a slider between consistency and availability and see what each position costs
- **Before/after optimization scenarios**. Toggle between naive and scaled architectures with metric deltas
- **Quizzes with explanations**. Score ≥60% to auto-complete a module; best scores persist
- **Progress tracking**. Per-module checkmarks, per-category progress bars, overall completion ring (localStorage)
- **Search**. ⌘K / Ctrl-K search across titles, descriptions, keywords, and section headings
- **Dark mode**. System-preference default, manual toggle, no flash on load
- **Downloadable notes**. Every module exports as Markdown; print stylesheet for save-as-PDF
- **Per-module extras**. Interview questions with hints (Junior/Mid/Senior), common mistakes, AWS/GCP/Azure service mappings, related-topic links, time-to-complete estimates
- **Code snippets**. Syntax-highlighted with one-click copy

## Tech stack

- [React 19](https://react.dev) + TypeScript (strict)
- [Vite](https://vite.dev) build tooling
- [Tailwind CSS v4](https://tailwindcss.com)
- [Framer Motion](https://motion.dev) animations
- [React Router](https://reactrouter.com) client-side routing
- No backend required. Fully static, progress lives in localStorage

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build:

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally
```

## Deploying to Vercel

The repo is Vercel-ready out of the box:

1. Push to GitHub.
2. In Vercel, **Import Project** → select the repo. Vercel auto-detects Vite (`npm run build`, output `dist/`).
3. Done. `vercel.json` already contains the SPA rewrite so deep links like `/module/sharding` resolve.

Any static host works (Netlify, Cloudflare Pages, S3+CloudFront); just make sure all routes rewrite to `index.html`.

## Project structure

```
src/
├── lib/
│   ├── types.ts            # Module/Section content model (the contract)
│   ├── markdown.tsx        # Minimal markdown renderer for course prose
│   └── download.ts         # Module → Markdown notes exporter
├── context/
│   ├── ThemeContext.tsx    # Dark mode (persisted)
│   └── ProgressContext.tsx # Completion + quiz scores (persisted)
├── data/
│   ├── course.ts           # Category metadata + auto-registry of modules
│   └── modules/            # One file per module. Auto-discovered via glob
│       ├── fundamentals/   # scalability, load-balancing, caching, databases, …
│       ├── advanced/       # sharding, consensus, replication, microservices, …
│       └── case-studies/   # design-instagram, design-uber, design-youtube, …
├── components/
│   ├── layout/             # Header, Sidebar (progress nav), SearchModal
│   └── module/             # Diagram, Quiz, CapacityCalculator, TradeoffVisualizer,
│                           # BeforeAfter, CodeBlock, ComparisonTable, KeyNumbers, extras
└── pages/                  # HomePage, CategoryPage, ModulePage, NotFoundPage
```

## Adding a module

1. Create `src/data/modules/<category>/<id>.ts` that default-exports a `Module` (see `src/lib/types.ts` for the schema and `fundamentals/scalability.ts` for a fully-featured example).
2. Add the module id to its category's `moduleIds` in `src/data/course.ts` to place it in the course order.

That's it. The sidebar, search index, progress tracking, notes export, and prev/next navigation pick it up automatically.

## License

Content and code provided as-is for educational use.
