// The World builder page's words and lists, worked out from what a build reports: what it made, grouped
// by kind in the order it makes them; how it ended, in plain words; what it would cost; and when the
// summary is true. Pure, so it is unit-tested; WorldBuilderView.tsx shows it.

import type { WorldBuildDone, WorldBuildEstimate, WorldBuildItem } from '@shared/contracts/worldBuilder'
import type { EntryKind, ID, Story } from '@shared/types'
import type { SelectOption } from '@/components/ui'
import { formatCost, shortModelName } from '@/features/generate/format'

// ---------- What a build made ----------

/** The kinds in the order a build lays them out (characters and places first), as the page heads them. */
const KINDS: { kind: EntryKind; label: string }[] = [
  { kind: 'character', label: 'Characters' },
  { kind: 'place', label: 'Places' },
  { kind: 'group', label: 'Groups' },
  { kind: 'item', label: 'Items' },
  { kind: 'lore', label: 'Lore and rules' },
  { kind: 'event', label: 'Events' },
  { kind: 'thread', label: 'Plot threads' },
  { kind: 'glossary', label: 'Glossary' }
]

export interface MadeSection {
  key: string
  label: string
  /** The kind of entry it lists; null for relationships, and for the world's themes and tone. */
  kind: EntryKind | null
  items: WorldBuildItem[]
}

/**
 * What a build made, by kind, then its relationships, then the world's themes and tone: the order it
 * makes them in, so while it runs, each thing it saves goes at the end of the list. Empty kinds are left out.
 */
export function madeSections(made: WorldBuildItem[]): MadeSection[] {
  const sections: MadeSection[] = KINDS.map(({ kind, label }) => ({
    key: kind,
    label,
    kind,
    items: made.filter((m) => m.what === 'entry' && m.kind === kind)
  }))
  sections.push({ key: 'relationships', label: 'Relationships', kind: null, items: made.filter((m) => m.what === 'relationship') })
  sections.push({
    key: 'themes',
    label: 'Themes and tone',
    kind: null,
    items: made.filter((m) => m.what === 'themes' || m.what === 'tone')
  })
  return sections.filter((s) => s.items.length)
}

/** True when everything a build made has been undone or deleted since (and it made something). */
export const allUndone = (made: WorldBuildItem[]): boolean => made.length > 0 && made.every((m) => m.undone)

/** "a, b and c". */
export function listWords(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** What is still there of what a build made: "10 entries, 1 relationship and the world's themes and tone". */
export function madeWords(made: WorldBuildItem[]): string {
  const live = made.filter((m) => !m.undone)
  const entries = live.filter((m) => m.what === 'entry').length
  const relationships = live.filter((m) => m.what === 'relationship').length
  const themes = live.some((m) => m.what === 'themes')
  const tone = live.some((m) => m.what === 'tone')
  const parts: string[] = []
  if (entries) parts.push(count(entries, 'entry', 'entries'))
  if (relationships) parts.push(count(relationships, 'relationship', 'relationships'))
  if (themes && tone) parts.push("the world's themes and tone")
  else if (themes) parts.push("the world's themes")
  else if (tone) parts.push("the world's tone")
  return listWords(parts)
}

/** How the last build ended, in plain words, for the line under the buttons. Empty when the problem notice says it all. */
export function doneWords(done: Pick<WorldBuildDone, 'status' | 'made'>): string {
  const what = madeWords(done.made)
  if (allUndone(done.made)) return 'The build was undone. Nothing it made is in your world now.'
  if (done.status === 'complete') {
    if (!what) return 'Everything in your summary is in your world already, so nothing was added.'
    return `Built and saved ${what}. Your words are kept as you wrote them; the rest is drafted by AI.`
  }
  if (done.status === 'cancelled') return what ? `Cancelled. What was made before is kept: ${what}.` : 'Cancelled before anything was made.'
  return what ? `It stopped part way. What was made before is kept: ${what}.` : ''
}

/** What a build cost, once it has ended: "It cost about $0.08." Empty when not known. */
export function costWords(cost: number | null): string {
  if (cost == null || !Number.isFinite(cost)) return ''
  if (cost < 0.01) return 'It cost less than a cent.'
  return `It cost about ${formatCost(cost)}.`
}

// ---------- Before a build ----------

/** Roughly what building would cost: "Estimated cost: about $0.12, with Claude Sonnet 4.5." Empty when there is no model to say it for. */
export function estimateWords(e: WorldBuildEstimate | null): string {
  if (!e || e.problem) return ''
  const model = e.model ? shortModelName(e.model) : 'the world builder model'
  if (e.cost == null) return `The cost isn't known for ${model}.`
  if (e.cost < 0.01) return `Estimated cost: less than a cent, with ${model}.`
  return `Estimated cost: about ${formatCost(e.cost)}, with ${model}.`
}

/** The choice for the start of the world in "When is this true?" (a story's choice is its id). */
export const WORLD_START = 'world-start'

/** "When is this true?": the start of the world, or the start of one of the stories. */
export function whenOptions(stories: Pick<Story, 'id' | 'title'>[]): SelectOption[] {
  return [
    { value: WORLD_START, label: 'From the start of the world' },
    ...stories.map((s) => ({ value: s.id, label: `From the start of ${s.title.trim() || 'Untitled story'}` }))
  ]
}

/** The story a choice stands for, or null for the start of the world (and for a story that is gone). */
export function storyOf(value: string | null, stories: Pick<Story, 'id'>[]): ID | null {
  return value && value !== WORLD_START && stories.some((s) => s.id === value) ? value : null
}
