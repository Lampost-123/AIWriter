// The style guide in effect for a story: Adam's writing preferences underneath,
// then the world's style guide, then the story's overrides on top.
// Empty strings and empty lists mean "not set". Phrases to avoid are combined
// from all three levels (Adam's words to avoid first, repeats dropped).
//
// These are the same rules as effectiveStyle() in src/shared/style.ts (the
// Style guide screen's copy). When that module is present, the two must agree;
// context assembly can use either.

import type { Spelling, StyleGuide, WritingPrefs } from '@shared/types'

const TEXT_KEYS = ['pov', 'tense', 'proseStyle', 'samplePassage', 'contentLimits', 'notes'] as const
type TextKey = (typeof TEXT_KEYS)[number]

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const spelling = (v: unknown): Spelling | '' => (v === 'UK' || v === 'US' ? v : '')
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

function prefText(prefs: Partial<WritingPrefs>, key: TextKey): string {
  if (key === 'pov') return text(prefs.pov)
  if (key === 'tense') return text(prefs.tense)
  if (key === 'notes') return text(prefs.voiceNotes)
  return ''
}

/** Joins lists, trimming items and dropping blanks and repeats (ignoring case). The first spelling wins. */
export function mergePhrases(...lists: string[][]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const l of lists) {
    for (const raw of l) {
      const item = raw.trim()
      const key = item.toLocaleLowerCase()
      if (!item || seen.has(key)) continue
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

export function effectiveStyle(prefs: WritingPrefs, world: StyleGuide, story: Partial<StyleGuide>): StyleGuide {
  const p: Partial<WritingPrefs> = prefs ?? {}
  const w: Partial<StyleGuide> = world ?? {}
  const s: Partial<StyleGuide> = story ?? {}
  const out = {} as StyleGuide
  for (const key of TEXT_KEYS) out[key] = text(s[key]) || text(w[key]) || prefText(p, key)
  out.spelling = spelling(s.spelling) || spelling(w.spelling) || spelling(p.spelling)
  out.avoidPhrases = mergePhrases(list(p.avoidWords), list(w.avoidPhrases), list(s.avoidPhrases))
  return out
}
