import type { CategoryId, CategoryMeta, Module } from '../lib/types'

/**
 * Module files under ./modules/** each default-export a `Module`.
 * They are auto-registered here via glob import, so adding a new module file
 * is all that's needed to put it in the course.
 */
const moduleFiles = import.meta.glob<{ default: Module }>('./modules/**/*.ts', { eager: true })

const byId = new Map<string, Module>()
for (const file of Object.values(moduleFiles)) {
  const mod = file.default
  if (mod?.id) byId.set(mod.id, mod)
}

export const categories: CategoryMeta[] = [
  {
    id: 'fundamentals',
    title: 'Fundamentals',
    tagline: 'The building blocks every system design conversation starts with.',
    moduleIds: ['scalability', 'load-balancing', 'caching', 'databases', 'message-queues', 'api-design'],
  },
  {
    id: 'advanced',
    title: 'Advanced Topics',
    tagline: 'Distributed systems concepts that separate senior answers from junior ones.',
    moduleIds: [
      'distributed-systems',
      'sharding',
      'consensus',
      'search-analytics',
      'realtime-systems',
      'cdn-edge',
      'microservices',
      'replication',
    ],
  },
  {
    id: 'case-studies',
    title: 'Case Studies',
    tagline: 'End-to-end designs of real systems, the way interviews actually ask them.',
    moduleIds: ['design-instagram', 'design-uber', 'design-youtube', 'design-google-search', 'design-notifications'],
  },
]

/** All modules in recommended course order (skips any not yet authored). */
export const orderedModules: Module[] = categories.flatMap((c) =>
  c.moduleIds.map((id) => byId.get(id)).filter((m): m is Module => Boolean(m)),
)

export function getModule(id: string): Module | undefined {
  return byId.get(id)
}

export function getCategory(id: CategoryId): CategoryMeta {
  return categories.find((c) => c.id === id)!
}

export function modulesInCategory(id: CategoryId): Module[] {
  return getCategory(id)
    .moduleIds.map((m) => byId.get(m))
    .filter((m): m is Module => Boolean(m))
}

export function adjacentModules(id: string): { prev?: Module; next?: Module } {
  const idx = orderedModules.findIndex((m) => m.id === id)
  if (idx === -1) return {}
  return {
    prev: idx > 0 ? orderedModules[idx - 1] : undefined,
    next: idx < orderedModules.length - 1 ? orderedModules[idx + 1] : undefined,
  }
}

export const totalCourseMinutes = orderedModules.reduce((sum, m) => sum + m.estMinutes, 0)
