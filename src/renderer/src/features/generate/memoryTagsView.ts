// Origin tags in "What the AI saw" (World Memory Overhaul B6), in plain words: what each memory line in a part of the
// briefing rested on (from your story, yours, or a guess) and how it stood (fine, words edited since, being updated),
// so Adam can see why an old or guessed fact was sent. Pure, so it is unit-tested (memoryTagsView.test.ts).

import type { MemoryTag, MemoryTagCounts } from '@shared/types'

export interface TagBadge {
  text: string
  /** 'ai' (amber) for what is a guess or out of date; 'plain' otherwise. */
  tone: 'plain' | 'ai'
}

/** What a tag's line is about: "Kell", "Kell: Hair", or a scene's place. */
export function tagLabel(t: MemoryTag): string {
  return t.field && t.fieldLabel ? `${t.label}: ${t.fieldLabel}` : t.label
}

/** Where the line came from and how it stood, as small badges. */
export function tagBadges(t: MemoryTag): TagBadge[] {
  const out: TagBadge[] = []
  if (t.origin === 'guess') out.push({ text: 'Guess', tone: 'ai' })
  else out.push({ text: t.origin === 'yours' ? 'Yours' : 'From your story', tone: 'plain' })
  if (t.health === 'changed') out.push({ text: 'Words edited since', tone: 'ai' })
  else if (t.health === 'updating') out.push({ text: 'Being updated', tone: 'ai' })
  return out
}

const notable = (t: MemoryTag): boolean => t.origin === 'guess' || t.health !== 'ok'

/** Guesses and out-of-date lines first, then the rest, each in the order they were sent. */
export function tagsInOrder(tags: MemoryTag[]): MemoryTag[] {
  return [...tags.filter(notable), ...tags.filter((t) => !notable(t))]
}

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** A few words for a part's heading ("1 guess, 1 edited since"); null when nothing in it is a guess or out of date. */
export function blockTagNote(tags: MemoryTag[] | undefined): string | null {
  if (!tags?.length) return null
  const guesses = tags.filter((t) => t.origin === 'guess').length
  const edited = tags.filter((t) => t.health === 'changed').length
  const updating = tags.filter((t) => t.health === 'updating').length
  const parts = [guesses ? count(guesses, 'guess', 'guesses') : '', edited ? `${edited} edited since` : '', updating ? `${updating} being updated` : '']
  const text = parts.filter(Boolean).join(', ')
  return text || null
}

/** The notice at the top of the record; null when the AI was given no guess and nothing out of date. */
export function recordTagNote(c: MemoryTagCounts): string | null {
  if (!c.guesses && !c.stale) return null
  const parts = [
    c.guesses ? count(c.guesses, 'guess', 'guesses') : '',
    c.stale ? `${count(c.stale, 'fact')} that ${c.stale === 1 ? 'was' : 'were'} out of date or being updated` : ''
  ].filter(Boolean)
  const many = c.guesses + c.stale > 1
  return `The AI was given ${parts.join(' and ')}. ${many ? 'They’re' : 'It’s'} marked below.`
}
