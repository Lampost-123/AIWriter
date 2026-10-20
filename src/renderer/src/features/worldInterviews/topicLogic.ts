// The interviews by topic, the pure part (contracts/worldInterviews.ts): what each topic is called and says, how each
// stands ("Done · 3 kept"), when How it all connects is offered, a round of answers as the interview records it, and
// how a suggestion reads on screen. No React, no store.

import type { InterviewProgress, InterviewTopic, TopicAsked, TopicEntry, TopicLink } from '@shared/contracts/worldInterviews'
import { TOPIC_FIELDS } from '@shared/contracts/worldInterviews'
import type { EntryKind } from '@shared/types'
import { FIELD_GROUPS } from '@shared/fields'

export const TOPIC_TEXT: Record<InterviewTopic, { title: string; line: string; empty: string }> = {
  characters: {
    title: 'Characters',
    line: 'Who they are, what they want and fear, how they talk.',
    empty: 'No characters suggested from these answers. Ask me more, or answer in a little more detail.'
  },
  places: {
    title: 'Places',
    line: 'Where it happens, how each place feels, what lies inside what.',
    empty: 'No places suggested from these answers. Ask me more, or answer in a little more detail.'
  },
  lore: {
    title: 'Lore and history',
    line: 'How the world works, its magic or technology, its past and beliefs.',
    empty: 'No lore suggested from these answers. Ask me more, or answer in a little more detail.'
  },
  connections: {
    title: 'How it all connects',
    line: 'Who lives and works where, who knows what, how they stand with each other.',
    empty: 'Nothing new to link from these answers. Ask me more, or answer in a little more detail.'
  }
}

/** The topics that suggest pages (the connections link them). */
export const PAGE_TOPICS: InterviewTopic[] = ['characters', 'places', 'lore']

/** How Undo-able each suggestion stands: kept (with the run Undo takes back) or discarded. Missing: still to decide. */
export type Decision = { status: 'kept'; runId: string; entryId: string | null } | { status: 'discarded' }

/** What a topic shows beside its name: done once something is kept from it, else how far it has gone. */
export function topicStatus(kept: number, started: boolean): { words: string; done: boolean } {
  if (kept > 0) return { words: `Done · ${kept} kept`, done: true }
  return { words: started ? 'Under way' : 'Not started', done: false }
}

/** How It all connects is offered once a topic has kept something here. */
export const connectionsOpen = (progress: InterviewProgress | null): boolean => !!progress && PAGE_TOPICS.some((t) => progress[t] > 0)

/** A round as the interview records it: every question, its answer in Adam's words, or skipped when its box is empty. */
export function roundAsked(questions: string[], answers: string[]): TopicAsked[] {
  return questions.map((question, i) => {
    const answer = (answers[i] ?? '').trim()
    return { question, answer, skipped: !answer }
  })
}

/** At least one question answered: the suggestions can be made. */
export const hasAnswers = (asked: TopicAsked[]): boolean => asked.some((a) => !a.skipped && a.answer.trim())

/** How many answered and how many skipped, in words ("3 answered, 1 skipped"). */
export function answeredWords(asked: TopicAsked[]): string {
  const answered = asked.filter((a) => !a.skipped && a.answer.trim()).length
  const skipped = asked.length - answered
  if (!asked.length) return ''
  return `${answered} answered${skipped ? `, ${skipped} skipped` : ''}`
}

/** A part's label ("What they want"), from shared/fields.ts. */
export function partLabel(kind: EntryKind, key: string): string {
  for (const g of FIELD_GROUPS[kind] ?? []) for (const f of g.fields) if (f.key === key) return f.label
  return key
}

/** The parts a page's Change form shows: those it suggests, then the rest a page of its kind may fill. */
export function partsToShow(e: Pick<TopicEntry, 'kind' | 'fields'>): string[] {
  const all = TOPIC_FIELDS[e.kind] ?? Object.keys(e.fields)
  return [...all.filter((k) => e.fields[k]?.trim()), ...all.filter((k) => !e.fields[k]?.trim())]
}

/** A suggested page's parts as lines to read ("What they want: To pay her debt"), in the order the kind lists them. */
export function entryLines(e: Pick<TopicEntry, 'kind' | 'fields' | 'in' | 'rule'>): string[] {
  const order = TOPIC_FIELDS[e.kind] ?? Object.keys(e.fields)
  const lines = order.filter((k) => e.fields[k]?.trim()).map((k) => `${partLabel(e.kind, k)}: ${e.fields[k].trim()}`)
  if (e.kind === 'place' && e.in.trim()) lines.unshift(`Inside ${e.in.trim()}`)
  if (e.kind === 'lore' && e.rule) lines.unshift('Always true, never to be broken')
  return lines
}

/** A link in plain words: "Mara Venn lives at Saltmarsh", "The Back Room is inside The Anchor Inn", "Mara Venn: Secrets". */
export function linkWords(l: Pick<TopicLink, 'link' | 'from' | 'to' | 'type' | 'field'>): string {
  if (l.link === 'inside') return `${l.from.name} is inside ${l.to?.name ?? ''}`
  if (l.link === 'detail') return `${l.from.name}: ${partLabel(l.from.kind, l.field)}`
  return `${l.from.name} ${l.type.trim() || 'is linked to'} ${l.to?.name ?? ''}`
}

/** What the batch head says: how many are left to decide, and how many were kept. */
export function batchWords(keys: string[], decisions: Record<string, Decision>, links: boolean): string {
  const kept = keys.filter((k) => decisions[k]?.status === 'kept').length
  const open = keys.filter((k) => !decisions[k]).length
  const noun = links ? 'link' : 'page'
  if (open) return `${open} ${noun}${open === 1 ? '' : 's'} to keep, change or discard${kept ? ` · ${kept} kept` : ''}`
  return kept ? `All decided · ${kept} kept` : 'All decided'
}

/** A suggested page with Adam's changes: the parts he changed become his (kept in his words). */
export function changedEntry(was: TopicEntry, next: Partial<Pick<TopicEntry, 'name' | 'summary' | 'fields' | 'in' | 'rule'>>): TopicEntry {
  const his = new Set(was.his)
  if (next.name !== undefined && next.name !== was.name) his.add('name')
  if (next.summary !== undefined && next.summary !== was.summary) his.add('summary')
  const fields = next.fields ? Object.fromEntries(Object.entries(next.fields).filter(([, v]) => v.trim())) : was.fields
  for (const [k, v] of Object.entries(fields)) if (v !== was.fields[k]) his.add(k)
  return { ...was, ...next, fields, his: [...his] }
}
