// Pure helpers for the memory parts of an entry page: who made it, its relationships from either
// side, what it knows, how it has changed, and where each fact came from, all in plain words. No
// React and no API calls here, so they're easy to test (see memoryLogic.test.ts).

import type {
  ChangeInput,
  ChangeView,
  Entry,
  EntryKind,
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

/** "the start of Book 2" -> "The start of Book 2", for the start of a line. */
export const upperFirst = (s: string): string => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s)

/** "Sister of" -> "sister of", for the middle of a sentence. Leaves names and capitals alone ("MI6", "Dark Lord"). */
function lowerFirst(s: string): string {
  const [first = '', second = ''] = s.split(' ')
  if (!/^\p{Lu}\p{Ll}*$/u.test(first) || /^\p{Lu}/u.test(second)) return s
  return s[0].toLocaleLowerCase() + s.slice(1)
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

/** The note on an entry Adam made himself. */
export const YOU_WROTE = "You wrote this. AI Write won't change what you've written."

/** The note on an entry Adam made with fields drafted by AI (as the builders make them). */
export const YOU_MADE = 'You made this. What you wrote stays as you wrote it; fields marked Drafted by AI can change with your story.'

/**
 * Whether an entry is all Adam's writing: he made it and none of its fields was drafted by AI. Only
 * then does it say once, at the top, that he wrote it.
 */
export const allAdams = (e: Pick<Entry, 'origin' | 'fieldOrigins'>): boolean =>
  e.origin === 'adam' && !Object.values(e.fieldOrigins ?? {}).includes('ai')

// ---------- Where a fact came from ----------

export type SourceNote =
  /**
   * Read from the text: the words (the first that are still there), the scene and paragraph they're in (for Jump to
   * source, World Memory Overhaul B2), and whether they were edited since.
   */
  | { kind: 'words'; quote: string; sceneId: ID; paragraphId: string | null; changed: boolean; more: number }
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
    return {
      kind: 'words',
      quote: first.quote.trim(),
      sceneId: first.sceneId,
      paragraphId: first.paragraphId ?? null,
      changed: first.state === 'changed',
      more: live.length - 1
    }
  }
  return links.length ? { kind: 'gone', sceneId: links[0].sceneId } : null
}

/** Links for one of an entry's own facts: the field key, or 'entry' for the entry itself (where it was found). */
export function linksFor(links: SourceLink[], key: string): SourceLink[] {
  if (key === 'entry') return links.filter((l) => l.factKind === 'entry')
  return links.filter((l) => (l.factKind === 'field' || l.factKind === 'voice' || l.factKind === 'summary') && l.field === key)
}

/** Who a field's value comes from: its own origin, or the entry's when it has none. */
export const fieldOrigin = (e: Pick<Entry, 'origin' | 'fieldOrigins'>, key: string): Origin => e.fieldOrigins?.[key] ?? e.origin

/** A field's value as text: the entry's own aliases, summary, description and tags, or one of its kind's fields. */
export function fieldText(e: Pick<Entry, 'aliases' | 'summary' | 'description' | 'tags' | 'fields'>, key: string): string {
  if (key === 'aliases' || key === 'tags') return e[key].join(', ')
  if (key === 'summary' || key === 'description') return e[key]
  return e.fields[key] ?? ''
}

/**
 * The copy an entry page reads its "where this came from" lines from, after a newer save arrives
 * (the memory changed the entry while its page was open). Fields AI Write filled in that Adam has
 * since made his keep their old value and origin here, so their line goes on saying "Changed by you"
 * rather than vanishing (and moving everything under it) while the page is open.
 */
export function notesSource(prev: Entry, saved: Entry, keys: string[]): Entry {
  const out: Entry = { ...saved, fields: { ...saved.fields }, fieldOrigins: { ...saved.fieldOrigins } }
  for (const key of keys) {
    const was = fieldOrigin(prev, key)
    if (was === 'adam' || fieldOrigin(saved, key) !== 'adam' || !fieldText(prev, key).trim()) continue
    if (key === 'aliases' || key === 'tags') out[key] = prev[key]
    else if (key === 'summary' || key === 'description') out[key] = prev[key]
    else out.fields[key] = prev.fields[key] ?? ''
    out.fieldOrigins[key] = was
  }
  return out
}

// ---------- Relationships ----------

export type RelationshipChange = Extract<ChangeView, { kind: 'relationship' }>

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

/** What a relationship row on an entry's page edits, read from that entry's side. */
export interface RelationEdit {
  type: string
  selfFeels: string
  otherFeels: string
}

/** A copy of a relationship read from the same side as `view` (a newer copy of the same one, say). */
export function relationEditOf(view: Pick<RelationView, 'mine'>, c: RelationshipChange): RelationEdit {
  const p = c.payload
  return {
    type: p.type ?? '',
    selfFeels: (view.mine ? p.feels : p.otherFeels) ?? '',
    otherFeels: (view.mine ? p.otherFeels : p.feels) ?? ''
  }
}

/**
 * Adam's edit laid over a newer copy: each box he changed since `base` (the copy his edit started
 * from) keeps his words; every other box takes what `fresh` has, such as a feeling the memory filled in.
 */
export function mergeRelationEdit(base: RelationEdit, mine: RelationEdit, fresh: RelationEdit): RelationEdit {
  const pick = (k: keyof RelationEdit): string => (mine[k] !== base[k] ? mine[k] : fresh[k])
  return { type: pick('type'), selfFeels: pick('selfFeels'), otherFeels: pick('otherFeels') }
}

/** The change to save after editing a relationship on this entry's page: still written from the side it was written from. */
export function relationshipInput(view: RelationView, edit: RelationEdit): ChangeInput {
  const c = view.change
  const payload: RelationshipPayload = {
    ...c.payload,
    type: edit.type,
    feels: view.mine ? edit.selfFeels : edit.otherFeels,
    otherFeels: view.mine ? edit.otherFeels : edit.selfFeels
  }
  return { entryId: c.entryId, anchor: c.anchor, storyId: c.storyId, sceneId: c.sceneId, kind: 'relationship', payload }
}

/**
 * Saves Adam's edit to a relationship without writing over what changed since his edit started.
 * The memory can fill in how the other one feels while he types the type: the newest copy is read
 * first, and only the boxes he changed since `base` replace what it has. Returns the copy saved and
 * the relationship as saved, read from this page's side (the next save's `base`).
 */
export async function saveRelationOverNewer(
  view: RelationView,
  mine: RelationEdit,
  base: RelationEdit,
  io: { get: (c: RelationshipChange) => Promise<RelationshipChange | null>; put: (id: ID, input: ChangeInput) => Promise<ChangeView> }
): Promise<{ saved: ChangeView; now: RelationEdit }> {
  const fresh = (await io.get(view.change)) ?? view.change
  const sent = mergeRelationEdit(base, mine, relationEditOf(view, fresh))
  const saved = await io.put(fresh.id, relationshipInput({ ...view, change: fresh }, sent))
  return { saved, now: saved.kind === 'relationship' ? relationEditOf(view, saved) : sent }
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

// Words that already say which one ("the leader", "her sister", "Tobin's rival"), so no "a" goes before them.
const DETERMINERS = new Set('a an the his her their its my our your one some no this that'.split(' '))

/** "a rival", "an enemy", "an heir", "a one-time ally". */
function withArticle(phrase: string): string {
  const w = phrase.toLocaleLowerCase()
  const an = /^(heir|hono|hour|hones)/.test(w) || (/^[aeiou]/.test(w) && !/^(one|onc|uni|use|usu|eu|ur[ai])/.test(w))
  return `${an ? 'an' : 'a'} ${phrase}`
}

/**
 * A relationship type joined to the other entry in plain words: "enemies with Tobin", "holds the Sword",
 * "member of The Guild (lieutenant)", "married to Tobin", "involved in the Fall". With `article`, a role
 * gets "a" or "an", for after "Now" or "No longer": "an enemy of Mara", "a member of The Guild".
 */
export function relationPhrase(type: string, other: string, opts: { article?: boolean } = {}): string {
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
  // A role ("enemy", "old friend") reads best with an article; a name or a "the ..." already has one.
  const role = link === 'of' && opts.article && !DETERMINERS.has(first) && !/'s$|’s$/.test(first) && !/^\p{Lu}/u.test(core)
  return `${role ? withArticle(core) : core}${link ? ` ${link}` : ''} ${other}${tail}`
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
  /** A second, quieter line: how each feels, for relationships; the line itself, for something said. */
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
        return { text: `${ended ? 'No longer' : 'Now'} ${relationPhrase(v.type, other, { article: true })}`, detail }
      }
      if (!v.type.trim()) return { text: ended ? `${other}: no longer linked to ${self}` : `${other}: things change with ${self}`, detail }
      return { text: `${other}: ${ended ? 'no longer' : 'now'} ${relationPhrase(v.type, self, { article: true })}`, detail }
    }
    case 'knowledge': {
      // Something said (0.6.29): the line itself, word for word, under it.
      const said = c.payload.said && !c.payload.forgets ? c.payload.said : null
      const line = said?.words.trim() ?? ''
      const words = line ? (/^["“'‘]/.test(line) ? line : `“${line}”`) : null
      const what = said ? { promise: 'A promise', threat: 'A threat', secret: 'A secret told' }[said.kind] : c.payload.forgets ? 'Forgets' : 'Learns'
      return { text: `${what}: ${c.payload.fact.trim()}`, detail: words }
    }
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
