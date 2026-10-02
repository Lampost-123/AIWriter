// Reading the World builder model's replies (whole, or a list still arriving), and the summary itself:
// cutting a long one into parts that fit the model, and finding the sentences about one thing. Adam's
// own words are told from the AI's with the same rules as Quick start (builder/profile.ts), so a field
// is his only when every part of it is copied from his summary. Pure, so every rule is unit-tested.

import type { EntryKind } from '@shared/types'
import type { BuilderKind, BuilderValues } from '@shared/contracts/builder'
import { bool, str, strList } from '../keeper/json'
import { estimateTokens, mentionAt, sentences, splitLong } from '../keeper/text'
import { hisWordsIn, quickStartView } from '../builder/profile'
import { bareName } from './names'

/** The kinds a build lays out, in the order it lays them out: characters and places first, so the rest can link to them. */
export const BUILD_KINDS: EntryKind[] = ['character', 'place', 'group', 'item', 'lore', 'event', 'thread', 'glossary']

/**
 * The builder's profile helpers read each kind's fields from FIELD_GROUPS, which has every kind of
 * entry, so they serve lore, events, plot threads and glossary words as well as the builder's own four.
 */
export const asProfileKind = (kind: EntryKind): BuilderKind => kind as BuilderKind

/** One thing the summary names, as the first look at it lists it. */
export interface PlanItem {
  kind: EntryKind
  name: string
  aliases: string[]
  /** What the summary says about it, in a few words. */
  about: string
  /** A place: the place it is inside, by name ('' when none). */
  in: string
  /** Lore the summary states as absolute: a rule never to break. */
  rule: boolean
  /** An event: when it happens, in the summary's words ('' when it doesn't say). */
  when: string
}

const loose = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '')

/** What a model may call each kind's list in its reply. */
const LIST_NAMES: Record<EntryKind, string[]> = {
  character: ['characters', 'character', 'people', 'cast'],
  place: ['places', 'place', 'locations', 'location', 'settings'],
  group: ['groups', 'group', 'factions', 'organisations', 'organizations'],
  item: ['items', 'item', 'objects', 'artefacts', 'artifacts'],
  lore: ['lore', 'rules', 'loreandrules', 'worldrules'],
  event: ['events', 'event'],
  thread: ['threads', 'plotthreads', 'thread', 'plotthread'],
  glossary: ['glossary', 'terms', 'glossarywords', 'words']
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A member of an object, found however the model spelled its name. */
function member(o: Record<string, unknown>, names: string[]): unknown {
  const key = Object.keys(o).find((k) => names.includes(loose(k)))
  return key === undefined ? undefined : o[key]
}

/** One listed thing, from an object or a bare name. Null when it has no name. */
function planItem(kind: EntryKind, raw: unknown): PlanItem | null {
  const o: Record<string, unknown> = isObject(raw) ? raw : { name: raw }
  const name = str(member(o, ['name', 'title', 'word', 'term']), 120)
  if (!name) return null
  const aliases = strList(member(o, ['aliases', 'alias', 'othernames']), 8).filter((a) => bareName(a) !== bareName(name))
  return {
    kind,
    name,
    aliases,
    about: str(member(o, ['about', 'summary', 'description', 'meaning']), 300),
    in: kind === 'place' ? str(member(o, ['in', 'inside', 'parent', 'within']), 120) : '',
    rule: kind === 'lore' && bool(member(o, ['rule', 'absolute', 'hardrule'])),
    when: kind === 'event' ? str(member(o, ['when', 'date', 'time']), 160) : ''
  }
}

/** Everything the first look at the summary listed, by kind; empty when the reply has none of the lists. */
export function overviewItems(value: unknown): PlanItem[] {
  if (!isObject(value)) return []
  const out: PlanItem[] = []
  for (const kind of BUILD_KINDS) {
    const list = member(value, LIST_NAMES[kind])
    if (!Array.isArray(list)) continue
    for (const raw of list.slice(0, 200)) {
      const item = planItem(kind, raw)
      if (item) out.push(item)
    }
  }
  return out
}

/** True when a reply has at least one of the kinds' lists (even an empty one): the model understood what was asked. */
export const hasOverviewLists = (value: unknown): boolean =>
  isObject(value) && BUILD_KINDS.some((kind) => Array.isArray(member(value, LIST_NAMES[kind])))

// ---------- The summary ----------

/** The summary's paragraphs: its lines with words on them. */
const paragraphs = (summary: string): string[] =>
  summary
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)

/** The summary in parts of whole paragraphs, each about `maxTokens` at most (a paragraph longer than that is cut between sentences). */
export function splitSummary(summary: string, maxTokens: number): string[] {
  const max = Math.max(200, maxTokens)
  if (estimateTokens(summary) <= max) return [summary.trim()].filter(Boolean)
  const out: string[] = []
  let cur: string[] = []
  let size = 0
  for (const p of paragraphs(summary).flatMap((x) => splitLong(x, max))) {
    const t = estimateTokens(p) + 1
    if (cur.length && size + t > max) {
      out.push(cur.join('\n\n'))
      cur = []
      size = 0
    }
    cur.push(p)
    size += t
  }
  if (cur.length) out.push(cur.join('\n\n'))
  return out
}

const mentions = (text: string, names: string[]): boolean => names.some((n) => n.trim().length >= 2 && mentionAt(text, n.trim()))

/**
 * What the model is given of the summary about some things: all of it when it fits in `maxTokens`, else
 * its paragraphs that name any of them, in order, as many as fit (the opening ones when none do).
 */
export function textAbout(summary: string, names: string[], maxTokens: number): string {
  const all = summary.trim()
  if (estimateTokens(all) <= maxTokens) return all
  const paras = paragraphs(all).flatMap((p) => splitLong(p, Math.max(200, maxTokens)))
  const named = paras.filter((p) => mentions(p, names))
  const out: string[] = []
  let size = 0
  for (const p of named.length ? named : paras) {
    const t = estimateTokens(p) + 1
    if (out.length && size + t > maxTokens) break
    out.push(p)
    size += t
  }
  return out.join('\n\n')
}

/** The summary's sentences that name any of these, exactly as written. */
export const sentencesNaming = (summary: string, names: string[]): string[] => sentences(summary).filter((s) => mentions(s, names))

// ---------- Profiles ----------

/** Every object in the first list of a reply ({"places": [...]}), or the reply itself when it is one object without a list. */
export function replyItems(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isObject)
  if (!isObject(value)) return []
  const list = Object.values(value).find(Array.isArray)
  return list ? list.filter(isObject) : []
}

/** A profile laid out from the summary: its fields, which of them are Adam's own words, and its name. */
export interface Profile {
  values: BuilderValues
  /** The fields copied word for word from the summary: his. */
  his: string[]
}

/**
 * Reads one profile ({"fromNotes": {...}, "drafted": {...}}, with the name beside them or in them) as
 * Quick start does: a field whose words really are copied from the summary is Adam's, wherever the
 * model put it, and kept whole; the rest are the AI's, tidied. A name only beside the two parts counts
 * too, and is his when it is in the summary.
 */
export function readProfile(kind: EntryKind, summary: string, item: Record<string, unknown>): Profile {
  const view = quickStartView(asProfileKind(kind), summary, { value: item, open: null })
  const values = { ...view.values }
  const his = [...view.fromNotes]
  if (!values.name?.trim()) {
    const name = str(member(item, ['name', 'title', 'word', 'term']), 120)
    if (name) {
      values.name = name
      if (hisWordsIn(summary)(name)) his.push('name')
    }
  }
  return { values, his }
}

/** A place's parent, a lore entry's "never to break" and an event's people, from beside a profile. */
export function profileExtras(item: Record<string, unknown>): { in: string; rule: boolean | null; involved: string[] } {
  const rule = member(item, ['rule', 'absolute', 'hardrule'])
  return {
    in: str(member(item, ['in', 'inside', 'parent', 'within']), 120),
    rule: rule === undefined ? null : bool(rule),
    involved: strList(member(item, ['involved', 'people', 'characters', 'who']), 20)
  }
}

// ---------- Relationships, themes and tone, and disagreements ----------

export interface RelationshipReply {
  from: string
  to: string
  type: string
  feels: string
  otherFeels: string
}

export function relationshipItems(value: unknown): RelationshipReply[] {
  return replyItems(value)
    .map((o) => ({
      from: str(member(o, ['from', 'a', 'who', 'character']), 120),
      to: str(member(o, ['to', 'b', 'with', 'other']), 120),
      type: str(member(o, ['type', 'relationship', 'is']), 80),
      feels: str(member(o, ['feels', 'fromfeels', 'afeels']), 160),
      otherFeels: str(member(o, ['otherfeels', 'tofeels', 'bfeels']), 160)
    }))
    .filter((r) => r.from && r.to)
}

export function themesReply(value: unknown): { themes: string; tone: string } {
  if (!isObject(value)) return { themes: '', tone: '' }
  return { themes: str(member(value, ['themes', 'theme']), 600), tone: str(member(value, ['tone']), 600) }
}

export interface ConflictReply {
  name: string
  field: string
  /** What the summary says, in a few of its words. */
  says: string
  /** The summary's sentence, as the model copied it. */
  quote: string
}

export function conflictItems(value: unknown): ConflictReply[] {
  return replyItems(value)
    .map((o) => ({
      name: str(member(o, ['name', 'page', 'entry']), 120),
      field: str(member(o, ['field', 'key']), 60),
      says: str(member(o, ['summary', 'says', 'summarysays']), 300),
      quote: str(member(o, ['quote', 'sentence']), 600)
    }))
    .filter((c) => c.name && c.field && c.says)
}
