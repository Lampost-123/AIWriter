// Pure helpers for the memory parts of an entry page: where it first exists, its relationships
// from either side, what it knows, how it has changed, and where each fact came from, all in
// plain words. No React and no API calls here, so they're easy to test (see memoryLogic.test.ts).

import type {
  ChangeInput,
  ChangeView,
  Entry,
  EntryKind,
  ExistsPoint,
  ID,
  Origin,
  Outline,
  RelationshipPayload,
  SourceLink
} from '@shared/types'

// ---------- Places in plain words ----------

/** Each scene of a story in plain words: "Book 1, Ch 3, Sc 2". Chapters and scenes count from 1, in order. */
export function sceneLabels(outline: Pick<Outline, 'story' | 'chapters' | 'scenes'>): Map<ID, string> {
  const title = outline.story.title.trim() || 'Untitled story'
  const chapters = [...outline.chapters].sort((a, b) => a.position - b.position)
  const out = new Map<ID, string>()
  chapters.forEach((ch, ci) => {
    outline.scenes
      .filter((s) => s.chapterId === ch.id)
      .sort((a, b) => a.position - b.position)
      .forEach((s, si) => out.set(s.id, `${title}, Ch ${ci + 1}, Sc ${si + 1}`))
  })
  return out
}

/** Looks up story titles and scene places. Undefined while unknown (still loading, or deleted). */
export interface PlaceNames {
  story(id: ID): string | undefined
  scene(id: ID): string | undefined
}

/** "the start of Book 2" -> "The start of Book 2", for the start of a line. */
export const upperFirst = (s: string): string => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s)

/** "Sister of" -> "sister of", for the middle of a sentence. Leaves names and capitals alone ("MI6", "Dark Lord"). */
function lowerFirst(s: string): string {
  const [first = '', second = ''] = s.split(' ')
  if (!/^\p{Lu}\p{Ll}*$/u.test(first) || /^\p{Lu}/u.test(second)) return s
  return s[0].toLocaleLowerCase() + s.slice(1)
}

// ---------- Where it first exists ----------

/**
 * One quiet line for the entry page: "In the world from the start", "First appears in Book 1, Ch 3, Sc 2",
 * "From the start of Kell's Road", or several joined ("From the start of Mara's Youth, and from Book 3, Ch 1, Sc 2").
 * Null while a place isn't known yet, so the line appears whole rather than in pieces.
 */
export function existsLine(points: ExistsPoint[], names: PlaceNames): string | null {
  if (!points.length) return null
  if (points.some((p) => p.kind === 'world')) return 'In the world from the start'
  const parts: { text: string; scene: boolean }[] = []
  for (const p of points) {
    if (p.kind === 'scene') {
      const where = p.sceneId ? names.scene(p.sceneId) : undefined
      if (!where) return null
      parts.push({ text: where, scene: true })
    } else {
      const title = p.storyId ? names.story(p.storyId) : undefined
      if (!title) return null
      parts.push({ text: `the start of ${title}`, scene: false })
    }
  }
  const unique = parts.filter((p, i) => parts.findIndex((q) => q.text === p.text) === i)
  if (unique.length === 1) return unique[0].scene ? `First appears in ${unique[0].text}` : `From ${unique[0].text}`
  return upperFirst(unique.map((p) => `from ${p.text}`).join(', and '))
}

// ---------- Made by AI Write ----------

/**
 * The quiet note on an entry AI Write made itself and Adam hasn't touched:
 * "Added by AI Write from Book 1, Ch 2, Sc 1. Edit anything and it's yours."
 * `where` is the scene it was found in, when known. Null for Adam's own entries.
 */
export function madeByNote(entry: Pick<Entry, 'origin' | 'byHand'>, where: string | null): string | null {
  if (entry.byHand || entry.origin === 'adam') return null
  if (entry.origin === 'ai') return "Drafted by AI. Edit anything and it's yours."
  return `Added by AI Write from ${where ?? 'your story'}. Edit anything and it's yours.`
}

/** What the note says once Adam has made the entry his. */
export const MADE_YOURS = "Yours now. AI Write won't change what you've written."

// ---------- Where a fact came from ----------

export type SourceNote =
  /** Read from the text: the words (the first that are still there) and the scene they're in. */
  | { kind: 'words'; quote: string; sceneId: ID; changed: boolean; more: number }
  /** Read from the text, but every passage it came from has been deleted. */
  | { kind: 'gone'; sceneId: ID | null }
  | { kind: 'ai' }
  | { kind: 'adam' }

/** Where a fact came from, for a quiet line under it. Null when there is nothing to say. */
export function sourceNote(origin: Origin, links: SourceLink[]): SourceNote | null {
  if (origin === 'ai') return { kind: 'ai' }
  if (origin === 'adam') return { kind: 'adam' }
  const live = links.filter((l) => l.state !== 'gone' && l.quote.trim())
  if (live.length) {
    const first = live.find((l) => l.state === 'ok') ?? live[0]
    return { kind: 'words', quote: first.quote.trim(), sceneId: first.sceneId, changed: first.state === 'changed', more: live.length - 1 }
  }
  return links.length ? { kind: 'gone', sceneId: links[0].sceneId } : null
}

/** Links for one of an entry's own facts: the field key, or 'entry' for the entry itself (where it was found). */
export function linksFor(links: SourceLink[], key: string): SourceLink[] {
  if (key === 'entry') return links.filter((l) => l.factKind === 'entry')
  return links.filter((l) => (l.factKind === 'field' || l.factKind === 'voice') && l.field === key)
}

/** Who a field's value comes from: its own origin, or the entry's when it has none. */
export const fieldOrigin = (e: Pick<Entry, 'origin' | 'fieldOrigins'>, key: string): Origin => e.fieldOrigins?.[key] ?? e.origin

// ---------- Relationships ----------

type RelationshipChange = Extract<ChangeView, { kind: 'relationship' }>

/** A relationship as one entry's page shows it, whichever side it was written from. */
export interface RelationView {
  change: RelationshipChange
  /** True when it belongs to this entry; false when it was written on the other entry and points here. */
  mine: boolean
  otherId: ID
  /** The entry its type is written from ("Mara" in "How Mara is linked to Tobin: sister"). */
  fromId: ID
  type: string
  /** How this page's entry feels about the other. */
  selfFeels: string
  /** How the other feels about this page's entry. */
  otherFeels: string
}

/** Reads a relationship from this entry's point of view. Null when it doesn't involve the entry. */
export function orientRelationship(c: RelationshipChange, selfId: ID): RelationView | null {
  const p = c.payload
  if (c.entryId === selfId && p.otherId !== selfId) {
    return {
      change: c,
      mine: true,
      otherId: p.otherId,
      fromId: selfId,
      type: p.type ?? '',
      selfFeels: p.feels ?? '',
      otherFeels: p.otherFeels ?? ''
    }
  }
  if (p.otherId === selfId && c.entryId !== selfId) {
    return {
      change: c,
      mine: false,
      otherId: c.entryId,
      fromId: c.entryId,
      type: p.type ?? '',
      selfFeels: p.otherFeels ?? '',
      otherFeels: p.feels ?? ''
    }
  }
  return null
}

/** The change to save after editing a relationship on this entry's page: still written from the side it was written from. */
export function relationshipInput(view: RelationView, edit: { type: string; selfFeels: string; otherFeels: string }): ChangeInput {
  const c = view.change
  const payload: RelationshipPayload = {
    ...c.payload,
    type: edit.type,
    feels: view.mine ? edit.selfFeels : edit.otherFeels,
    otherFeels: view.mine ? edit.otherFeels : edit.selfFeels
  }
  return { entryId: c.entryId, anchor: c.anchor, storyId: c.storyId, sceneId: c.sceneId, kind: 'relationship', payload }
}

const PREPOSITIONS = new Set(
  'of to in with from for on at by about against under over into towards toward behind after before within without among between beside near like as'.split(
    ' '
  )
)
// Verbs that take the other entry straight after them: "holds the Sword", "loves Tobin".
const VERBS = new Set(
  (
    'holds owns carries wields keeps leads rules serves guards protects loves hates fears trusts distrusts owes knows follows hunts ' +
    'commands worships mentors teaches employs betrays admires resents envies seeks wants needs controls guides haunts blames avoids pities ' +
    'raised killed made forged founded created built stole found lost won caused started witnessed survived rescued saved betrayed ' +
    'remembers obeys defends imprisoned freed adopted involved involves'
  ).split(' ')
)
const TO_WORDS = new Set(
  (
    'mentor apprentice servant heir successor bodyguard adviser advisor counsellor counselor nurse tutor squire stranger threat host ' +
    'engaged betrothed related devoted promised pledged sworn loyal close bound indebted attached kind cruel'
  ).split(' ')
)
const FROM_WORDS = new Set('estranged separated divorced banished exiled outcast apart free hidden'.split(' '))
const WITH_WORDS = new Set('obsessed infatuated besotted friendly angry furious familiar allied connected partnered'.split(' '))

/**
 * A relationship type joined to the other entry in plain words: "enemies with Tobin", "holds the Sword",
 * "member of The Guild (lieutenant)", "married to Tobin", "involved in the Fall".
 */
export function relationPhrase(type: string, other: string): string {
  const raw = type.trim().replace(/\s+/g, ' ')
  const aside = raw.match(/\s*\(([^)]*)\)\s*/)
  const core = lowerFirst((aside ? raw.replace(aside[0], ' ') : raw).trim())
  const tail = aside ? ` (${aside[1].trim()})` : ''
  if (!core) return `linked to ${other}${tail}`
  const words = core.toLocaleLowerCase().split(' ')
  const first = words[0]
  const last = words[words.length - 1]
  let link: string
  if (PREPOSITIONS.has(last)) link = ''
  else if (first === 'married') link = 'to'
  else if (first === 'owes' && words.length > 1) link = 'to'
  else if (VERBS.has(first)) link = ''
  else if (first === 'in' || first === 'at') link = 'with'
  else if (TO_WORDS.has(last)) link = 'to'
  else if (FROM_WORDS.has(last)) link = 'from'
  else if (WITH_WORDS.has(last)) link = 'with'
  else if (/[^s]s$/.test(last)) link = 'with'
  else link = 'of'
  return `${core}${link ? ` ${link}` : ''} ${other}${tail}`
}

/** Suggestions for a relationship's type, by what the two entries are ("How Mara is linked to The Guild"). */
export function relationPlaceholder(from: EntryKind, to: EntryKind): string {
  if (from === 'character') {
    if (to === 'character') return 'sister, rival, mentor, old friend'
    if (to === 'group') return 'member, leader, outcast'
    if (to === 'item') return 'holds, made, is searching for'
    if (to === 'event') return 'involved in, caused, witnessed'
    if (to === 'place') return 'lives in, rules, was born in'
    return 'believes in, knows of'
  }
  if (from === 'group') {
    if (to === 'character') return 'led by, hunts, protects'
    if (to === 'group') return 'rival of, ally of, part of'
    if (to === 'place') return 'based in, rules'
    return 'guards, caused, follows'
  }
  if (from === 'item') return to === 'character' ? 'held by, made by' : 'kept in, belongs to'
  if (from === 'event') return 'happened in, involved, led to'
  if (from === 'place') return 'home of, part of, ruled by'
  return 'linked to, part of'
}

/** The kinds a relationship picker offers to create from a typed name, most likely first. */
export function createKindsFor(kind: EntryKind): EntryKind[] {
  switch (kind) {
    case 'character':
      return ['character', 'group', 'item']
    case 'group':
      return ['character', 'group', 'place']
    case 'item':
      return ['character', 'group', 'item']
    case 'event':
      return ['character', 'place', 'group']
    case 'place':
      return ['character', 'group', 'place']
    default:
      return ['character', 'group', 'event']
  }
}

// ---------- An entry's changes, sorted for its page ----------

export interface EntryChanges {
  /** Relationships as they are at the start (baseline), from either side, one per other entry. */
  relationships: RelationView[]
  /** Facts the character knows from the start (baseline knowledge). */
  knows: Extract<ChangeView, { kind: 'knowledge' }>[]
  /** Everything else, in story order: how it changes over time. */
  history: ChangeView[]
}

export function splitChanges(changes: ChangeView[], selfId: ID): EntryChanges {
  const byOther = new Map<ID, RelationView>()
  const knows: EntryChanges['knows'] = []
  const history: ChangeView[] = []
  for (const c of changes) {
    if (c.anchor === 'baseline' && c.kind === 'relationship') {
      const v = orientRelationship(c, selfId)
      // One relationship per pair: a later one replaces an earlier one.
      if (v && !c.payload.ended) {
        byOther.delete(v.otherId)
        byOther.set(v.otherId, v)
      }
      continue
    }
    if (c.anchor === 'baseline' && c.kind === 'knowledge') {
      if (c.entryId === selfId && !c.payload.forgets) knows.push(c)
      continue
    }
    history.push(c)
  }
  return { relationships: [...byOther.values()], knows, history }
}

// ---------- Changes in plain words ----------

/** "Mara feels: protective · Tobin feels: resentful" (the page's entry first). */
function feelings(selfName: string, selfFeels: string, otherName: string, otherFeels: string): string | null {
  const parts = [
    selfFeels.trim() && `${selfName} feels: ${selfFeels.trim()}`,
    otherFeels.trim() && `${otherName} feels: ${otherFeels.trim()}`
  ]
  return parts.filter(Boolean).join(' · ') || null
}

const excerpt = (s: string, max = 90): string => {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

export interface ChangeWords {
  text: string
  /** A second, quieter line: how each feels, for relationships. */
  detail: string | null
}

/**
 * A change on the entry page, in plain words: "Lost her left hand", "Now enemies with Tobin",
 * "Tobin: no longer enemies with Mara", "Learns: Mara is the heir", "Thread resolved: the heir is found".
 * `nameOf` gives entry names (this entry's too); null when the other entry is unknown (deleted), and
 * then the change isn't listed.
 */
export function describeChange(
  c: ChangeView,
  selfId: ID,
  nameOf: (id: ID) => string | null,
  fieldLabel: (key: string) => string
): ChangeWords | null {
  const self = nameOf(selfId) ?? 'This entry'
  switch (c.kind) {
    case 'update': {
      const p = c.payload
      if (p.note?.trim()) return { text: upperFirst(p.note.trim()), detail: null }
      const parts = Object.entries(p.fields ?? {})
        .filter(([, v]) => (v ?? '').trim())
        .map(([k, v]) => `${fieldLabel(k)}: ${excerpt(v, 60)}`)
      if (p.summary?.trim()) parts.unshift(`In short: ${excerpt(p.summary, 60)}`)
      if (p.description?.trim()) parts.unshift('A new description')
      return { text: parts.join('; ') || 'Changed', detail: null }
    }
    case 'full': {
      const p = c.payload
      if (c.entryId === selfId) {
        const what = p.summary?.trim() || p.description?.trim()
        return { text: what ? `Described afresh: ${excerpt(what)}` : 'Described afresh', detail: null }
      }
      // Another entry's fresh description that sets its relationship with this one.
      const other = nameOf(c.entryId)
      const r = p.relationships.find((x) => x.otherId === selfId)
      if (!other || !r) return null
      return { text: `${other}: ${relationPhrase(r.type, self)}`, detail: feelings(self, r.otherFeels ?? '', other, r.feels ?? '') }
    }
    case 'relationship': {
      const v = orientRelationship(c, selfId)
      if (!v) return null
      const other = nameOf(v.otherId)
      if (!other) return null
      const ended = !!c.payload.ended
      const detail = ended ? null : feelings(self, v.selfFeels, other, v.otherFeels)
      if (v.mine) {
        if (!v.type.trim()) return { text: ended ? `No longer linked to ${other}` : `Things change with ${other}`, detail }
        return { text: `${ended ? 'No longer' : 'Now'} ${relationPhrase(v.type, other)}`, detail }
      }
      if (!v.type.trim()) return { text: ended ? `${other}: no longer linked to ${self}` : `${other}: things change with ${self}`, detail }
      return { text: `${other}: ${ended ? 'no longer' : 'now'} ${relationPhrase(v.type, self)}`, detail }
    }
    case 'knowledge':
      return { text: `${c.payload.forgets ? 'Forgets' : 'Learns'}: ${c.payload.fact.trim()}`, detail: null }
    case 'thread': {
      const note = c.payload.note?.trim()
      const what = c.payload.status === 'resolved' ? 'Thread resolved' : 'Thread opened'
      return { text: note ? `${what}: ${note}` : what, detail: null }
    }
  }
}

/** Where a change happened, for the start of its line: "Book 1, Ch 12, Sc 3", "The start of Book 2", "From the start". */
export function changeWhere(c: Pick<ChangeView, 'where' | 'anchor'>): string {
  const w = c.where.trim()
  if (w) return upperFirst(w)
  return c.anchor === 'baseline' ? 'From the start' : 'Somewhere in your story'
}

/** A short form of a fact or note for a toast: "Removed "Mara is the heir"." */
export const shortQuote = (s: string, max = 60): string => `“${excerpt(s, max)}”`
