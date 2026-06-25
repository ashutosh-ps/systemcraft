import type { Difficulty, Module } from './types'

/**
 * Auto-derives a flashcard deck from a module's existing content. No separate
 * authoring needed. Cards come from four high-signal sources:
 *  - keyNumbers   → "recall the number" cards
 *  - comparison   → "rule of thumb" trade-off cards (when a verdict exists)
 *  - commonMistakes → "why is this a mistake" pitfall cards
 *  - interviewQuestions → question → how-to-approach cards
 */

export type FlashcardKind = 'number' | 'tradeoff' | 'pitfall' | 'interview'

export interface Flashcard {
  /** Stable across rebuilds so spaced-repetition progress persists. */
  id: string
  kind: FlashcardKind
  front: string
  back: string
  difficulty?: Difficulty
}

const KIND_LABEL: Record<FlashcardKind, string> = {
  number: 'Number to know',
  tradeoff: 'Trade-off',
  pitfall: 'Common mistake',
  interview: 'Interview question',
}

export function flashcardKindLabel(kind: FlashcardKind): string {
  return KIND_LABEL[kind]
}

function leadWords(text: string, count = 8): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const lead = words.slice(0, count).join(' ')
  return words.length > count ? `${lead}…` : lead
}

export function moduleToFlashcards(mod: Module): Flashcard[] {
  const cards: Flashcard[] = []

  mod.sections.forEach((section, si) => {
    if (section.type === 'keyNumbers') {
      section.numbers.forEach((n, i) => {
        cards.push({
          id: `${mod.id}:number:${si}:${i}`,
          kind: 'number',
          front: n.metric,
          back: `${n.value}. ${n.context}`,
        })
      })
    } else if (section.type === 'comparison' && section.comparison.verdict) {
      const topic = (section.title ?? mod.title).replace(/\s*[?:]\s*$/, '')
      cards.push({
        id: `${mod.id}:tradeoff:${si}`,
        kind: 'tradeoff',
        front: `${topic}?`,
        back: section.comparison.verdict,
      })
    }
  })

  mod.commonMistakes.forEach((m, i) => {
    cards.push({
      id: `${mod.id}:pitfall:${i}`,
      kind: 'pitfall',
      front: `Why is this a mistake: "${leadWords(m)}"`,
      back: m,
    })
  })

  mod.interviewQuestions.forEach((q, i) => {
    cards.push({
      id: `${mod.id}:interview:${i}`,
      kind: 'interview',
      front: q.question,
      back: q.hint,
      difficulty: q.difficulty,
    })
  })

  return cards
}
