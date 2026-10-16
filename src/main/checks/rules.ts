// Free rule-based checks (long story memory fix 8): some slips need no AI to spot, only the app's own records. Broad AI
// critics over-flag (FlawedFictions), and Story Skills runs rules like these over its story files; as long as the record
// is right, a rule never raises a false alarm. So each rule here is narrow, and says nothing when the record is unsure:
// no date, no stage that still stands, a fact whose words were edited (the memory as the writer is given it), a death
// only presumed, a time of day that may be the same hour as another. Each is read over one scene (RuleScene, gathered by
// ruleChecks.ts) with no AI call:
//   dead          someone the memory has dead before this scene (in reading order: an undated scene after the death
//                 counts) speaks a line, is up and about on the stage, or is on the scene card. Being remembered or spoken
//                 of is fine; a flashback, a scene dated before the death, and a dream, a ghost, a memory or a vision (in
//                 the line's paragraph, on the card or in the When) are exempt.
//   gone-item     something the memory has destroyed or lost is held here (the stage, from this scene's words).
//   two-hands     the same thing is in two living people's hands at the end of the scene (the stage, this scene's words).
//   pov-elsewhere the card's point of view is on another scene's card or stage at this very clock time, somewhere else.
//   pov-unnamed   a scene of real length, told in the third person, never names its point of view.
//   time-back     the scene is dated before the scene before it, and its When doesn't say it's a flashback.
//   age           an age set in this scene, or given on its card, a year or more from what the memory works out.
//   knows-early   someone tells a secret the memory has no sign they learned (only when the memory says they said it),
//                 in no scene before this one in reading order or dated before it; never in a flashback.
// A promise long overdue is not here: Worth a look already asks about it (fix 10), and a rule finding would say it twice.
// Pure.

import type { IssueKind, IssueSeverity, IssueSource } from '@shared/contracts/checks'
import type { Change, EntryState, FactState, ID, RelationshipState, SceneCard } from '@shared/types'
import { calledFor, findName, foldApostrophes, type CalledName } from '@shared/names'
import { saysGone, sourceKey, type CharacterState, type SceneState, type StateField } from '@shared/continuity'
import { deathRecord, surelyDied } from '../ai/deaths'
import { isPerson, namesPerson, namesUpTo } from '../ai/mustStay'
import { itemHeads, itemName, nameIn, namesOf } from '../memory/items'
import { learnedHow, type Ledger } from '../memory/ledger'
import {
  ageWords,
  dateLabel,
  elapsedBetween,
  elapsedWords,
  readAge,
  timeOrder,
  type AgeAt,
  type AgeHere,
  type Elapsed,
  type StoryDate
} from '../memory/calendar'
import { findQuote, wordCount } from '../keeper/text'
import { narratorI, spokenLines } from './speakers'

/** Which rule found something. */
export type RuleId = 'dead' | 'gone-item' | 'two-hands' | 'pov-elsewhere' | 'pov-unnamed' | 'time-back' | 'age' | 'knows-early'

/** One thing a rule found in a scene. */
export interface RuleFinding {
  rule: RuleId
  /** What it is about, for its key: an entry id (or ids). */
  about: string
  kind: IssueKind
  severity: IssueSeverity
  /** The scene's own words it is about ('' when it is about the card or the dates). */
  quote: string
  message: string
  sources: IssueSource[]
  entryId?: ID
  field?: string
}

/** Another scene at this very clock time, somewhere else (both cards give their own day and the same exact time). */
export interface Meanwhile {
  sceneId: ID
  /** Where it is, in plain words ("Ch 2, Sc 4"). */
  label: string
  /** Who is on its card or its stage there. */
  people: ID[]
  /** Its place, in words. */
  place: string
}

/** What the rules read of one scene. */
export interface RuleScene {
  sceneId: ID
  text: string
  card: Pick<SceneCard, 'povId' | 'presentIds' | 'notes' | 'beats' | 'goal' | 'conflict' | 'outcome'> & Partial<Pick<SceneCard, 'when' | 'mood'>>
  /** Where the scene happens, in words ('' when the card doesn't say). */
  placeName: string
  /** Every entry that exists as the scene begins, as the writer is given it (facts whose words were edited left out). */
  entries: EntryState[]
  relationships: RelationshipState[]
  /** Every character in the world, here or not, so names two people go by are told apart. */
  people: { id: ID; name: string; aliases: string[] }[]
  /** What this scene's words call someone (fix 12). */
  called: CalledName[]
  /** The changes the memory pinned to this scene, in order (those whose words were edited left out). */
  here: Change[]
  facts: FactState[]
  ledger: Ledger
  /** Where things stand as the scene ends, while that still stands; null when it isn't known. */
  stage: SceneState | null
  /** The style guide's point of view ("Third person, close on one character"); '' when it doesn't say. */
  pov: string
  /** A place on the line in plain words, as read from this scene ("Ch 18, Sc 2"; another story's with its title). */
  place: (where: string) => string
  /** A scene, the same way. */
  sceneLabel: (sceneId: ID) => string
  /** This scene's date on the story calendar (fix 11); null when it isn't known. */
  date: StoryDate | null
  /** The scene at a place in words ("Book 1, Ch 18, Sc 2"), on this scene's calendar. */
  sceneAt: (where: string) => ID | null
  dateOf: (sceneId: ID) => StoryDate | null
  /** This scene goes back without saying so (memory/calendar.ts goingBack): the dated scene before it, and how far. */
  back: { beforeId: ID; elapsed: Elapsed } | null
  /** How old a character is as the scene begins, worked out by the memory; null when it can't be told. */
  age: (e: EntryState) => AgeHere | null
  /** Other scenes at this very clock time, somewhere else. */
  meanwhile: Meanwhile[]
  /**
   * The other scenes where the memory has a character learn (or say) a fact, wherever they are in reading order, so one
   * dated before this scene counts (knows-early). Left out: none.
   */
  learnedIn?: (entryId: ID, factId: ID) => ID[]
}

/** How long a scene must be before its point of view is expected to be named in it. */
export const POV_NAMED_WORDS = 500
/** How often the narration may say "I", "me" or "my" before a scene counts as told in the first person. */
export const FIRST_PERSON_I = 3

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
const upper = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)
const curly = (s: string): string => s.replace(/'/g, '’')

/** How the card says to refer to someone: by their pronouns (Pronouns: "she/her"), or by name when it doesn't say. */
interface Pronoun {
  they: string
  them: string
  plural: boolean
}
function pronounOf(e: Pick<EntryState, 'fields'>): Pronoun | null {
  const p = (e.fields?.pronouns ?? '').trim().toLowerCase()
  if (/^she\b/.test(p)) return { they: 'she', them: 'her', plural: false }
  if (/^he\b/.test(p)) return { they: 'he', them: 'him', plural: false }
  if (/^they\b/.test(p)) return { they: 'they', them: 'them', plural: true }
  return null
}

/** Everything a character goes by in this scene: name, other names, and what the scene's words call them. */
const namesHere = (s: Pick<RuleScene, 'called'>, e: { id: ID; name: string; aliases?: string[] }): string[] =>
  [e.name, ...(e.aliases ?? []), ...calledFor(s.called, e.id)].map(clean).filter((n) => n.length >= 2)

/** The scene's own words for a quote, and where they are; null when they aren't in it. */
function placeOf(text: string, quote: string | undefined): { words: string; start: number } | null {
  const q = clean(quote)
  const at = q ? findQuote(text, q) : null
  return at ? { words: text.slice(at.start, at.end), start: at.start } : null
}

const entrySource = (e: Pick<EntryState, 'id' | 'name'>, field: string | null = null): IssueSource => ({ kind: 'entry', entryId: e.id, name: e.name, field })

// ---------- Dreams, ghosts and memories ----------

/** Words that say something isn't the waking present: a dream, a ghost, a memory, a vision, a flashback. */
export const DREAMLIKE =
  /\b(dream(?:s|ed|t|ing|like)?|nightmares?|ghost(?:s|ly)?|spirits?|shades?|apparitions?|phantoms?|haunt(?:s|ed|ing)?|visions?|memor(?:y|ies)|remember(?:s|ed|ing)?|recall(?:s|ed|ing)?|flashbacks?|hallucinat\w*|imagin(?:es|ed|ing)|s[ée]ances?)\b/i
/** Words that make someone on the stage no one acting: a body, or any of those. */
const NOT_ALIVE = new RegExp(
  String.raw`\b(dead|died|death|body|corpse|lifeless|remains|grave|portrait|painting|statue|photograph)\b|${DREAMLIKE.source}`,
  'i'
)

/** The paragraph the words at `at` are in. */
export function paragraphOf(text: string, at: number): string {
  const start = text.lastIndexOf('\n', Math.max(0, at - 1)) + 1
  const end = text.indexOf('\n', at)
  return text.slice(start, end < 0 ? text.length : end)
}

/** True when the scene card (its When, notes, beats, goal, conflict, outcome or mood) says it is a dream, a memory or the like. */
export function dreamlikeCard(card: RuleScene['card']): boolean {
  return DREAMLIKE.test([card.when, card.notes, ...(card.beats ?? []), card.goal, card.conflict, card.outcome, card.mood].filter(Boolean).join('\n'))
}

/** True when the scene isn't the waking present: a flashback (fix 11: its When says so), or a dream and the like on its card. */
const notThePresent = (s: RuleScene): boolean => !!s.date?.back || dreamlikeCard(s.card)

/** True when the words of a quote are in a paragraph that says it is a dream, a memory or the like. */
function inDreamlike(text: string, start: number): boolean {
  return DREAMLIKE.test(paragraphOf(text, start))
}

// ---------- Who is who on the stage ----------

/** Each name (lower case) and the characters who go by it. */
function nameIndex(people: RuleScene['people']): Map<string, ID[]> {
  const out = new Map<string, ID[]>()
  for (const p of people) {
    for (const n of [p.name, ...(p.aliases ?? [])].map((x) => clean(x).toLowerCase()).filter(Boolean)) {
      const ids = out.get(n) ?? []
      if (!ids.includes(p.id)) ids.push(p.id)
      out.set(n, ids)
    }
  }
  return out
}

/** The one character a name on the stage is; null when no one, or two people, go by it. */
function stageEntry(c: Pick<CharacterState, 'name'>, index: Map<string, ID[]>): ID | null {
  const ids = index.get(clean(c.name).toLowerCase())
  return ids?.length === 1 ? ids[0] : null
}

/** True when the stage has someone as no one acting: a body, a ghost, a dream or a memory. */
const notAlive = (c: CharacterState): boolean => [c.condition, c.where, c.posture].some((v) => NOT_ALIVE.test(v ?? ''))

/** Who the stage has in a scene by that scene's own words (any value of theirs read from them), as characters. */
export function onStage(stage: SceneState, sceneId: ID, people: RuleScene['people']): ID[] {
  const index = nameIndex(people)
  const out = new Set<ID>()
  for (const c of stage.characters) {
    const id = stageEntry(c, index)
    if (!id || notAlive(c)) continue
    const fields: StateField[] = ['where', 'posture', 'lastAction', 'holding', 'sees', 'touching', 'mood']
    if (fields.some((f) => ownValue(stage, sceneId, c, f))) out.add(id)
  }
  return [...out]
}

/** A value on the stage the scene's own words gave ('' when it came from an earlier scene, or says nothing). */
function ownValue(stage: SceneState, sceneId: ID, c: CharacterState, field: StateField): { value: string; quote: string } | null {
  const value = clean(c[field] as string | undefined)
  const said = stage.said?.[sourceKey(c.name, field)]
  if (!value || said?.sceneId !== sceneId) return null
  return { value, quote: said.quote }
}

/** What someone does, not how they lie: what a body or a ghost can't do. */
const DOING: StateField[] = ['lastAction', 'holding', 'sees', 'touching', 'mood']

// ---------- Dates ----------

/**
 * True when this scene is certainly set before another: both dated, an earlier day, or the same day with times of day
 * whose spans don't meet (timeOrder: "night" and "11pm" may be the same hour, so neither is first).
 */
function setBefore(s: RuleScene, sceneId: ID): boolean {
  const other = s.dateOf(sceneId)
  const e = elapsedBetween(other, s.date)
  if (!e) return false
  if (e.days !== 0 || e.months !== undefined) return e.days < 0
  return timeOrder(s.date, other) === 1
}

/** True when this scene is certainly set after another (the same rule the other way round). */
function setAfter(s: RuleScene, sceneId: ID): boolean {
  const other = s.dateOf(sceneId)
  const e = elapsedBetween(other, s.date)
  if (!e) return false
  if (e.days !== 0 || e.months !== undefined) return e.days > 0
  return timeOrder(other, s.date) === 1
}

/** True when the memory has someone surely dead as the scene begins (whatever its date). */
const surelyDead = (e: EntryState): boolean => {
  const d = deathRecord(e)
  return !!d && surelyDied(d.note)
}

// ---------- The dead ----------

/** A death the memory is sure of, as the scene begins, unless the scene is certainly set before it. */
function deathHere(s: RuleScene, e: EntryState): { where: string; sceneId: ID | null } | null {
  const d = deathRecord(e)
  if (!d || !surelyDied(d.note)) return null
  const sceneId = d.where ? s.sceneAt(d.where) : null
  if (sceneId && setBefore(s, sceneId)) return null
  return { where: d.where, sceneId }
}

/**
 * Someone the memory has dead speaks, is up and about on the stage, or is on the card. One finding a person, from the
 * strongest sign: a line they speak, the stage, the point of view, the card's list of who is there. With no dates, reading
 * order decides: an undated scene after the death counts.
 */
export function deadHere(s: RuleScene): RuleFinding[] {
  // A flashback, or a dream, a memory or a vision on the card or in the When, may have anyone in it.
  if (notThePresent(s)) return []
  const dead = s.entries.flatMap((e) => {
    if (e.kind !== 'character') return []
    const d = deathHere(s, e)
    return d ? [{ e, d }] : []
  })
  if (!dead.length) return []
  const spoken = spokenLines(
    s.text,
    s.people.map((p) => ({ id: p.id, names: namesHere(s, p) }))
  )
  const index = nameIndex(s.people)
  const out: RuleFinding[] = []
  for (const { e, d } of dead) {
    const pro = pronounOf(e)
    const died = d.where ? `${e.name} died in ${s.place(d.where)}` : `${e.name} is dead from the start of the story`
    const verb = (one: string, many: string): string => (pro ? `; ${pro.they} ${pro.plural ? many : one}` : `, but ${one}`)
    let found: { quote: string; message: string; severity: IssueSeverity } | null = null
    // A line of theirs, outside a paragraph that says it is a dream, a memory or a ghost.
    const line = spoken.find((l) => l.entryId === e.id && !inDreamlike(s.text, l.start))
    if (line) found = { quote: line.quote, message: `${died}${verb('speaks', 'speak')} here.`, severity: 'must-fix' }
    if (!found && s.stage) {
      const c = s.stage.characters.find((x) => stageEntry(x, index) === e.id)
      const doing =
        !c || notAlive(c)
          ? null
          : DOING.map((f) => ownValue(s.stage!, s.sceneId, c, f))
              .map((v) => (v ? { ...v, at: placeOf(s.text, v.quote) } : null))
              .find(
                (v) =>
                  !!v &&
                  !NOT_ALIVE.test(v.value) &&
                  !/^(?:nothing|nobody|no one|none)\b/i.test(v.value) &&
                  !saysGone('holding', v.value) &&
                  !(v.at && inDreamlike(s.text, v.at.start))
              )
      if (doing) found = { quote: doing.at?.words ?? '', message: `${died}${verb('is up and about', 'are up and about')} here.`, severity: 'must-fix' }
    }
    if (!found && s.card.povId === e.id) found = { quote: '', message: `${died}, but is this scene’s point of view.`, severity: 'warning' }
    if (!found && (s.card.presentIds ?? []).includes(e.id)) found = { quote: '', message: `${died}, but is on this scene’s card.`, severity: 'warning' }
    if (!found) continue
    out.push({
      rule: 'dead',
      about: e.id,
      kind: 'fact',
      ...found,
      sources: [entrySource(e), ...(d.sceneId ? [{ kind: 'scene' as const, sceneId: d.sceneId, label: s.sceneLabel(d.sceneId) }] : [])],
      entryId: e.id
    })
  }
  return out
}

// ---------- Things in hand ----------

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu
const wordsOf = (s: string): string[] => (foldApostrophes(s.toLowerCase()).match(WORD) ?? []).map((w) => w.replace(/'s$/, ''))

/**
 * The words each item is found by in what someone holds (memory/items.ts namesOf), less a bare one-word name in small
 * letters that another item has in its own name: "letter" for "The letter" would find "Bryn's letter" too, and "key" "the
 * cellar key". A name of its own ("Stormbringer") stays.
 */
export function itemWords(items: EntryState[], heads: Map<ID, string[]>): Map<ID, string[]> {
  const out = new Map<ID, string[]>()
  for (const item of items) {
    const others = new Set(items.filter((o) => o.id !== item.id).flatMap((o) => [o.name, ...(o.aliases ?? [])].flatMap(wordsOf)))
    out.set(
      item.id,
      namesOf(item, heads).filter((n) => /\s/.test(n.trim()) || /^\p{Lu}/u.test(n.trim()) || !others.has(wordsOf(n)[0] ?? ''))
    )
  }
  return out
}

const BEFORE_NEXT = String.raw`(?=\s+(?:in|by|during|on|at|against|into|onto|under|when|while|after|before|beyond)\b|\s*[.;,:]|\s*$)`
/** An item's own note that it was destroyed: "destroyed in the fire", "was smashed against the wall", "melted down". */
const DESTROYED = new RegExp(
  String.raw`^\s*(?:(?:was|is|got|been|then|later|finally)\s+)?(?:destroyed|smashed|shattered|burn(?:ed|t)(?:\s+(?:up|away|to\s+ash(?:es)?))?|melted(?:\s+down)?|crushed|blown\s+(?:up|apart)|torn\s+(?:up|apart|to\s+pieces)|broken\s+(?:beyond\s+repair|to\s+pieces|apart|in\s+(?:two|half|pieces))|ground\s+to\s+dust|dissolved)` +
    BEFORE_NEXT,
  'i'
)
/** An item's own note that it was lost, to no one: "lost in the river", "went missing". Not "lost to Bryn at cards". */
const LOST = new RegExp(String.raw`^\s*(?:(?:was|is|got|been|then|later)\s+)?(?:lost|went\s+missing|gone\s+missing|missing)(?!\s+to\b)` + BEFORE_NEXT, 'i')
/** A character's own note that they destroyed it: "smashed the brass compass", "burned the letter". */
const DESTROYS = /^\s*(?:(?:then|later|finally)\s+)?(?:destroyed|smashed|shattered|burned|burnt|melted(?:\s+down)?|crushed|tore\s+up)\s+(.{1,80})/i
/** A later note that it is back, or someone has it. */
const BACK =
  /\b(found|finds|recovered|retrieved|returned|restored|repaired|mended|reforged|re-?made|rebuilt|got\s+back|turned\s+up|dug\s+up|fished\s+out|given\s+(?:back|to)|taken\s+by|stolen\s+by|held\s+by|kept\s+by|carried\s+by|owned\s+by|in\s+the\s+hands\s+of)\b/i
/** A character's note that they have it. */
const GOT = /\b(got|gets|took|takes|picked\s+up|found|finds|has|holds|carries|keeps|kept|retrieved|recovered|received|bought|stole|now\s+has)\b/i

/**
 * Whether the memory has an item destroyed or lost, to no one, as the scene begins: its own latest note saying so (or a
 * character's that they destroyed it), with nothing since bringing it back or giving it to anyone. `words`: what the item
 * is found by (itemWords).
 */
export function goneItem(item: EntryState, entries: EntryState[], relationships: RelationshipState[], words: string[]): {
  how: 'destroyed' | 'lost'
  where: string
} | null {
  const names = (note: string): boolean => words.some((w) => nameIn(note, w))
  type Note = { at: number; i: number; gone: 'destroyed' | 'lost' | null; back: boolean; where: string }
  const notes: Note[] = []
  ;(item.happened ?? []).forEach((h, i) =>
    notes.push({
      at: h.at ?? -1,
      i,
      gone: DESTROYED.test(h.note) ? 'destroyed' : LOST.test(h.note) ? 'lost' : null,
      back: BACK.test(h.note),
      where: h.where
    })
  )
  for (const c of entries) {
    if (c.kind !== 'character') continue
    ;(c.happened ?? []).forEach((h, i) => {
      if (!names(h.note)) return
      const m = DESTROYS.exec(h.note)
      const destroys = !!m && names(m[1])
      notes.push({ at: h.at ?? -1, i: 10_000 + i, gone: destroys ? 'destroyed' : null, back: !destroys && GOT.test(h.note), where: h.where })
    })
  }
  notes.sort((a, b) => a.at - b.at || a.i - b.i)
  let gone: Note | null = null
  for (const n of notes) {
    // "Lost in the river and found by Ash": back again in the same note.
    if (n.gone && !n.back) gone = n
    else if (n.back) gone = null
  }
  if (!gone) return null
  // Someone tied to it as holding it since.
  const held = relationships.some(
    (r) => (r.aId === item.id || r.bId === item.id) && (r.at ?? -1) > gone!.at && /\b(holds?|has|owns?|keeps?|carries|wields?|wears?|bearer|owner)\b/i.test(r.type)
  )
  return held ? null : { how: gone.gone!, where: gone.where }
}

/** Words that say a thing is held by two together: never one thing in two hands. */
const TOGETHER = /\b(together|between them|both|one end|other end|shar(?:e|es|ed|ing)|help(?:s|ed|ing)?)\b/i

/**
 * The things in people's hands at the end of the scene (the stage, from this scene's own words): one the memory has
 * destroyed or lost, or one in two people's hands at once. Never a body's grip, a ghost's or a dream's: someone dead,
 * a holding in a dream or a memory, or a scene that is one.
 */
export function inHand(s: RuleScene): RuleFinding[] {
  if (!s.stage || dreamlikeCard(s.card)) return []
  const items = s.entries.filter((e) => e.kind === 'item')
  if (!items.length) return []
  const index = nameIndex(s.people)
  const byId = new Map(s.entries.map((e) => [e.id, e]))
  const holders: { id: ID; name: string; pieces: string[]; quote: string }[] = []
  for (const c of s.stage.characters) {
    const id = stageEntry(c, index)
    const own = id ? ownValue(s.stage, s.sceneId, c, 'holding') : null
    if (!id || !own || saysGone('holding', own.value) || NOT_ALIVE.test(own.value) || notAlive(c)) continue
    const person = byId.get(id)
    if (person && surelyDead(person)) continue
    const at = placeOf(s.text, own.quote)
    if (at && inDreamlike(s.text, at.start)) continue
    const pieces = own.value.split(/\s*;\s*/).filter((p) => p && !saysGone('holding', p))
    holders.push({ id, name: person?.name ?? clean(c.name), pieces, quote: at?.words ?? '' })
  }
  if (!holders.length) return []
  const words = itemWords(items, itemHeads(s.entries))
  const out: RuleFinding[] = []
  for (const item of items) {
    const names = words.get(item.id) ?? []
    const holding = holders.filter((h) => h.pieces.some((p) => names.some((w) => nameIn(p, w))))
    if (!holding.length) continue
    const name = itemName(item.name)
    const gone = goneItem(item, s.entries, s.relationships, names)
    // The memory says what happened to it here (found, mended): this scene brings it back. A flashback, or a scene dated
    // before it went, has it as it was.
    const touched = s.here.some((c) => c.entryId === item.id || (c.kind === 'update' && names.some((w) => nameIn(c.payload.note, w))))
    const goneAt = gone?.where ? s.sceneAt(gone.where) : null
    const before = !!s.date?.back || (!!goneAt && setBefore(s, goneAt))
    if (gone && !touched && !before) {
      const h = holding[0]
      const where = gone.where ? ` in ${s.place(gone.where)}` : ''
      out.push({
        rule: 'gone-item',
        about: item.id,
        kind: 'fact',
        severity: 'warning',
        quote: h.quote,
        message:
          gone.how === 'destroyed'
            ? `${upper(name)} was destroyed${where}, but ${h.name} holds it here.`
            : `${upper(name)} was lost${where} and not found since, but ${h.name} holds it here.`,
        sources: [entrySource(item)],
        entryId: item.id
      })
      continue
    }
    if (holding.length < 2) continue
    const [a, b] = holding
    const others = (h: (typeof holding)[number], o: (typeof holding)[number]): boolean =>
      h.pieces.some((p) => TOGETHER.test(p) || namesHere(s, { id: o.id, name: o.name, aliases: byId.get(o.id)?.aliases }).some((n) => nameIn(p, n)))
    if (others(a, b) || others(b, a)) continue
    out.push({
      rule: 'two-hands',
      about: item.id,
      kind: 'continuity',
      severity: 'warning',
      quote: b.quote || a.quote,
      message: `${a.name} and ${b.name} both hold ${name} at the end of this scene.`,
      sources: [entrySource(item)],
      entryId: item.id
    })
  }
  return out
}

// ---------- The point of view ----------

/**
 * The card's point of view isn't in the scene: on another scene's card or stage at this very clock time, somewhere else;
 * or, in a scene of real length told in the third person, never named. (Dead: `deadHere` says so.)
 */
export function povHere(s: RuleScene): RuleFinding[] {
  const id = s.card.povId
  const e = id ? s.entries.find((x) => x.id === id) : undefined
  if (!e || e.kind !== 'character' || surelyDead(e)) return []
  const pro = pronounOf(e)
  const them = pro?.them ?? e.name
  if (!notThePresent(s)) {
    const other = s.meanwhile.find((m) => m.people.includes(e.id))
    if (other) {
      const here = s.placeName ? `, at ${s.placeName}` : ''
      const when = dateLabel(s.date)
      return [
        {
          rule: 'pov-elsewhere',
          about: `${e.id}:${other.sceneId}`,
          kind: 'timeline',
          severity: 'warning',
          quote: '',
          message: `${e.name} is the point of view here${here}, but ${other.label} has ${them} at ${other.place} at the same moment${when ? ` (${when})` : ''}.`,
          sources: [entrySource(e), { kind: 'scene', sceneId: other.sceneId, label: other.label }],
          entryId: e.id
        }
      ]
    }
  }
  const firstPerson = /\b(first|second|1st|2nd)\b/i.test(s.pov) || narratorI(s.text) >= FIRST_PERSON_I
  if (firstPerson || wordCount(s.text) < POV_NAMED_WORDS) return []
  if (namesHere(s, e).some((n) => findName(s.text, n))) return []
  return [
    {
      rule: 'pov-unnamed',
      about: e.id,
      kind: 'continuity',
      severity: 'minor',
      quote: '',
      message: `${e.name} is this scene’s point of view, but the scene never names ${them}.`,
      sources: [entrySource(e)],
      entryId: e.id
    }
  ]
}

// ---------- Time ----------

/** The scene is dated before the scene before it, and its When doesn't say it's a flashback. */
export function timeBack(s: RuleScene): RuleFinding[] {
  if (!s.back || !s.date) return []
  const here = dateLabel(s.date)
  const before = dateLabel(s.dateOf(s.back.beforeId))
  if (!here || !before) return []
  const gap = s.back.elapsed.days === 0 ? 'earlier that same day than' : `${elapsedWords(s.back.elapsed)} before`
  const label = s.sceneLabel(s.back.beforeId)
  return [
    {
      rule: 'time-back',
      about: s.back.beforeId,
      kind: 'timeline',
      severity: 'warning',
      quote: '',
      message: `This scene is dated ${here}, ${gap} the scene before it (${label}: ${before}). If it’s a flashback, start its When with “Flashback”.`,
      sources: [{ kind: 'scene', sceneId: s.back.beforeId, label }]
    }
  ]
}

/** True when an age is a year or more from what was worked out (`about`: a year either way is allowed). */
export function ageClashes(years: number, age: AgeAt): boolean {
  const off = years < age.lo ? age.lo - years : years > age.hi ? years - age.hi : 0
  return off - (age.about ? 1 : 0) >= 1
}

const AGE = String.raw`(\d{1,3}|[a-z]+(?:[- ][a-z]+)?)`
const AGE_END = String.raw`(?=\s*[,;.)!?]|\s*$|\s+(?:and|but|now|today|here|this)\b)`

/** An age a text gives someone now, by one of their names: "Mara, 17,", "Mara (17)", "Mara is 17", "17-year-old Mara". */
export function ageGiven(text: string, names: string[]): number | null {
  for (const n of names) {
    const name = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
    const forms = [
      new RegExp(String.raw`(?<![\p{L}\p{N}])${name},\s*(?:aged?\s+)?${AGE}(?:\s+years?\s+old)?${AGE_END}`, 'u'),
      new RegExp(String.raw`(?<![\p{L}\p{N}])${name}\s*\(\s*(?:aged?\s+)?${AGE}\s*\)`, 'u'),
      // As things are now: "Mara was 5 when the war began" is her past.
      new RegExp(String.raw`(?<![\p{L}\p{N}])${name}\s+(?:is|turns)\s+(?:now\s+)?${AGE}(?:\s+years?\s+old)?${AGE_END}`, 'u'),
      new RegExp(String.raw`(?<![\p{L}\p{N}])(\d{1,3}|[a-z]+(?:-[a-z]+)?)[- ]years?[- ]old\s+${name}(?![\p{L}\p{N}])`, 'iu')
    ]
    for (const re of forms) {
      const m = re.exec(text)
      const fact = m ? readAge(m[1]) : null
      if (fact?.kind === 'age' && !fact.at && !fact.start) return fact.years
    }
  }
  return null
}

/**
 * An age the memory set in this scene (the scene's words: "Mara, now twenty,"), or the scene card gives someone on it,
 * a year or more from what the memory works out for them as the scene begins (fix 11: a birth date, or an age at a date).
 */
export function agesHere(s: RuleScene): RuleFinding[] {
  const byId = new Map(s.entries.map((e) => [e.id, e]))
  const out: RuleFinding[] = []
  const said = (e: EntryState, years: number, intro: string): void => {
    const was = s.age(e)
    if (!was || !ageClashes(years, was.age)) return
    out.push({
      rule: 'age',
      about: e.id,
      kind: 'timeline',
      severity: 'warning',
      quote: '',
      message: `${intro}, but the memory says ${curly(was.basis)}, so ${ageWords(was.age)} by now.`,
      sources: [entrySource(e, 'age')],
      entryId: e.id,
      field: 'age'
    })
  }
  const done = new Set<ID>()
  for (const c of s.here) {
    if ((c.kind !== 'update' && c.kind !== 'full') || done.has(c.entryId)) continue
    const fact = readAge(c.payload.fields?.age)
    const e = byId.get(c.entryId)
    if (!e || e.kind !== 'character' || fact?.kind !== 'age' || fact.at || fact.start) continue
    done.add(e.id)
    said(e, fact.years, `${e.name} is ${fact.years} here`)
  }
  const cardText = [s.card.notes, ...(s.card.beats ?? []), s.card.goal, s.card.conflict, s.card.outcome].filter(Boolean).join('\n')
  if (cardText.trim()) {
    for (const id of new Set([s.card.povId, ...(s.card.presentIds ?? [])])) {
      const e = id ? byId.get(id) : undefined
      if (!e || e.kind !== 'character' || done.has(e.id)) continue
      const years = ageGiven(cardText, namesHere(s, e))
      if (years === null) continue
      done.add(e.id)
      said(e, years, `The scene card says ${e.name} is ${years}`)
    }
  }
  return out
}

// ---------- Who knows what ----------

/**
 * Someone tells a secret here that the memory has no sign they knew: they said it (the memory keeper's "said it"), and as
 * the scene begins others know it (who knows it rests on who was there: B5) and they don't, nor learn it earlier in the
 * scene, nor in any scene dated before this one (a scene told later that happened first). A secret about themselves, or
 * one they believe wrongly, is never asked about; a promise or a threat starts with whoever makes it; a flashback, a
 * dream or a memory is never asked about.
 */
export function knowsEarly(s: RuleScene): RuleFinding[] {
  if (notThePresent(s)) return []
  const byId = new Map(s.entries.map((e) => [e.id, e]))
  const knowing = s.here.filter((c): c is Extract<Change, { kind: 'knowledge' }> => c.kind === 'knowledge')
  const out: RuleFinding[] = []
  const done = new Set<string>()
  knowing.forEach((c, i) => {
    const p = c.payload
    const x = byId.get(c.entryId)
    if (!x || !isPerson(x) || p.forgets || p.wrong || p.said?.kind !== 'secret' || learnedHow(x.id, p).how !== 'said') return
    if (done.has(`${x.id}|${p.factId}`)) return
    const could = s.ledger.couldKnow(x.id, p.factId)
    if (could.knows || could.believesWrongly) return
    const f = s.facts.find((y) => y.factId === p.factId)
    const knowers = (f?.knownBy ?? []).map((id) => byId.get(id)).filter((k): k is EntryState => !!k && isPerson(k))
    if (!f || f.backed === false || !knowers.length) return
    const fact = clean(f.fact || p.fact).replace(/[.!]+$/, '')
    if (!fact || namesPerson(fact, x)) return
    // Learned earlier in this scene: told, overheard, seen.
    if (knowing.slice(0, i).some((o) => o.entryId === x.id && o.payload.factId === p.factId && !o.payload.forgets && learnedHow(x.id, o.payload).how !== 'said'))
      return
    // Learned in a scene told later that is dated before this one.
    if ((s.learnedIn?.(x.id, p.factId) ?? []).some((id) => id !== s.sceneId && setAfter(s, id))) return
    const quote = placeOf(s.text, p.said.words)
    if (quote && inDreamlike(s.text, quote.start)) return
    done.add(`${x.id}|${p.factId}`)
    const pro = pronounOf(x)
    const names = knowers.map((k) => k.name)
    out.push({
      rule: 'knows-early',
      about: `${x.id}:${p.factId}`,
      kind: 'knowledge',
      severity: 'warning',
      quote: quote?.words ?? '',
      message: `${x.name} says “${fact}” here, but nothing in the memory shows ${pro?.them ?? x.name} learning it first. ${namesUpTo(names)} ${names.length === 1 ? 'knows' : 'know'} it.`,
      sources: [entrySource(x)],
      entryId: x.id
    })
  })
  return out
}

// ---------- All of them ----------

/** Every rule, in the order their findings are listed. */
export const RULES: ((s: RuleScene) => RuleFinding[])[] = [deadHere, inHand, povHere, timeBack, agesHere, knowsEarly]

/** What every rule finds in a scene. A rule that fails says nothing; the others still run. */
export function ruleFindings(s: RuleScene): RuleFinding[] {
  const out: RuleFinding[] = []
  for (const rule of RULES) {
    try {
      out.push(...rule(s))
    } catch (e) {
      console.warn('A rule check failed; the others still ran', e)
    }
  }
  return out
}
