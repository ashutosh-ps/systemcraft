/**
 * Content model for the course. Every module is a `Module` object authored in
 * src/data/modules/** and rendered by the shared section components.
 */

export type CategoryId = 'fundamentals' | 'advanced' | 'case-studies'

export type Difficulty = 'Junior' | 'Mid' | 'Senior'

/* ---------------------------------- Diagrams --------------------------------- */

export type NodeKind =
  | 'client'
  | 'lb'
  | 'server'
  | 'service'
  | 'db'
  | 'cache'
  | 'queue'
  | 'cdn'
  | 'storage'
  | 'search'
  | 'external'

export interface DiagramNode {
  id: string
  label: string
  kind: NodeKind
  /** Position on a 1000x<height> grid; w/h default to 150x56 */
  x: number
  y: number
  w?: number
  h?: number
  /** Shown in the detail panel when the node is clicked */
  detail: string
}

export interface DiagramEdge {
  from: string
  to: string
  label?: string
  dashed?: boolean
  /** Render both directions */
  bidirectional?: boolean
}

export interface DiagramSpec {
  /** Height of the coordinate space (width is always 1000) */
  height: number
  nodes: DiagramNode[]
  edges: DiagramEdge[]
}

/* --------------------------------- Calculators ------------------------------- */

export type CalculatorKind = 'qps' | 'storage' | 'bandwidth' | 'cache-sizing'

/* ------------------------------- Comparison table ---------------------------- */

export interface ComparisonSpec {
  /** e.g. ['', 'SQL', 'NoSQL'] — first column holds the criterion name */
  columns: string[]
  rows: string[][]
  /** Optional verdict line rendered under the table */
  verdict?: string
}

/* -------------------------------- Before / After ----------------------------- */

export interface BeforeAfterMetric {
  label: string
  before: string
  after: string
  /** true when the after value is an improvement (renders green) */
  improved: boolean
}

export interface BeforeAfterSpec {
  beforeTitle: string
  afterTitle: string
  beforeDescription: string
  afterDescription: string
  metrics: BeforeAfterMetric[]
}

/* ---------------------------------- Sections --------------------------------- */

export interface KeyNumber {
  metric: string
  value: string
  context: string
}

export type Section =
  | { type: 'text'; title?: string; md: string }
  | { type: 'code'; title?: string; language: string; code: string }
  | { type: 'diagram'; title?: string; diagram: DiagramSpec; caption?: string }
  | { type: 'comparison'; title?: string; comparison: ComparisonSpec }
  | { type: 'calculator'; title?: string; calculator: CalculatorKind }
  | { type: 'tradeoff'; title?: string }
  | { type: 'beforeAfter'; title?: string; scenario: BeforeAfterSpec }
  | { type: 'keyNumbers'; title?: string; numbers: KeyNumber[] }

/* ------------------------------------ Quiz ----------------------------------- */

export interface QuizQuestion {
  question: string
  options: string[]
  /** Index into options */
  answer: number
  explanation: string
}

/* -------------------------------- Extra content ------------------------------ */

export interface InterviewQuestion {
  question: string
  hint: string
  difficulty: Difficulty
}

export interface CloudMapping {
  concept: string
  aws: string
  gcp: string
  azure: string
}

/* ----------------------------------- Module ---------------------------------- */

export interface Module {
  id: string
  category: CategoryId
  title: string
  /** One-line summary shown in cards and search */
  description: string
  difficulty: Difficulty
  /** Estimated time to complete, in minutes */
  estMinutes: number
  /** Extra terms the search index should match */
  keywords: string[]
  /** ids of related modules (rendered as "Related topics") */
  related: string[]
  sections: Section[]
  quiz: QuizQuestion[]
  interviewQuestions: InterviewQuestion[]
  commonMistakes: string[]
  cloudMappings: CloudMapping[]
}

/* ----------------------------- Course metadata ------------------------------- */

export interface CategoryMeta {
  id: CategoryId
  title: string
  tagline: string
  /** Module ids in recommended order */
  moduleIds: string[]
}
