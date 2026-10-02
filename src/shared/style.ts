// How the style guide that applies to a story is worked out.
// Adam's own writing preferences sit underneath, then the world's style guide,
// then the story's overrides on top. The context assembly and the Style guide
// screen both use this, so what Adam sees is what the AI is given.

import type { Spelling, StyleGuide, WritingPrefs } from './types'

export type StyleSource = 'prefs' | 'world' | 'story' | 'none'

export type EffectiveStyle = StyleGuide & { sources: Record<keyof StyleGuide, StyleSource> }

/** The plain-text fields of a style guide (everything except spelling and phrases to avoid). */
export const STYLE_TEXT_KEYS = ['pov', 'tense', 'proseStyle', 'samplePassage', 'contentLimits', 'notes'] as const
export type StyleTextKey = (typeof STYLE_TEXT_KEYS)[number]

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const spelling = (v: unknown): Spelling | '' => (v === 'UK' || v === 'US' ? v : '')
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** The value Adam's preferences give each text field, if any. */
function prefText(prefs: Partial<WritingPrefs>, key: StyleTextKey): string {
  if (key === 'pov') return text(prefs.pov)
  if (key === 'tense') return text(prefs.tense)
  if (key === 'notes') return text(prefs.voiceNotes)
  return ''
}

/** Joins lists, trimming each item and dropping blanks and repeats (ignoring case). The first spelling wins. */
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

/**
 * The style guide in effect for a story: story overrides, then the world's guide,
 * then Adam's preferences. Empty strings and empty lists mean "not set".
 * Phrases to avoid are combined from all three levels (Adam's words to avoid first).
 * `sources` says where each value came from; for phrases to avoid it is the
 * highest level that added any.
 */
export function effectiveStyle(prefs: WritingPrefs, world: StyleGuide, story: Partial<StyleGuide>): EffectiveStyle {
  const p: Partial<WritingPrefs> = prefs ?? {}
  const w: Partial<StyleGuide> = world ?? {}
  const s: Partial<StyleGuide> = story ?? {}
  const out = {} as EffectiveStyle
  const sources = {} as Record<keyof StyleGuide, StyleSource>

  for (const key of STYLE_TEXT_KEYS) {
    const fromStory = text(s[key])
    const fromWorld = text(w[key])
    const fromPrefs = prefText(p, key)
    if (fromStory) [out[key], sources[key]] = [fromStory, 'story']
    else if (fromWorld) [out[key], sources[key]] = [fromWorld, 'world']
    else if (fromPrefs) [out[key], sources[key]] = [fromPrefs, 'prefs']
    else [out[key], sources[key]] = ['', 'none']
  }

  const sp = [spelling(s.spelling), spelling(w.spelling), spelling(p.spelling)]
  const spIndex = sp.findIndex(Boolean)
  out.spelling = spIndex >= 0 ? sp[spIndex] : ''
  sources.spelling = (['story', 'world', 'prefs'] as const)[spIndex] ?? 'none'

  const prefList = list(p.avoidWords)
  const worldList = list(w.avoidPhrases)
  const storyList = list(s.avoidPhrases)
  out.avoidPhrases = mergePhrases(prefList, worldList, storyList)
  const has = (l: string[]): boolean => l.some((x) => x.trim())
  sources.avoidPhrases = has(storyList) ? 'story' : has(worldList) ? 'world' : has(prefList) ? 'prefs' : 'none'

  out.sources = sources
  return out
}
