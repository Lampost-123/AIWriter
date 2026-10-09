// Who was there (World Memory Overhaul B5, 2026-10-08): the people on stage at one paragraph of a scene, so that when
// something is said or happens there, everyone who was there is marked as knowing it (keeper/apply.ts), and "X does
// not know it" can be told to the writer only when it rests on that (or on Adam). On stage at a paragraph:
// - the scene card's point of view, from the start,
// - the card's other people from the first paragraph that names them as there (someone who walks in late doesn't hear
//   what was said before), or all through the scene when it never does,
// - and anyone named as there in that paragraph or the two before it (someone who walks in, or speaks),
// - but not someone who left or died at an earlier paragraph of the scene (a change read there says so).
// Named "as there": not only thought of, remembered, missed or dreamed of ("Mara thought of Anna"), nor told as far away
// ("Anna, back home", "three hundred miles away"). Such a name doesn't make them a knower.
// Only people: never an animal (mustStay.ts isPerson). Words said in a whisper or aside reach only those the memory
// model says heard them. Pure.

import type { EntryState, ID } from '@shared/types'
import type { Para } from './text'
import { isPerson } from '../ai/mustStay'

/** How many paragraphs before this one a name still puts someone on stage. */
export const NAMED_BEFORE = 2

/** Words said so only some of those there hear them. */
export const WHISPERED = /\b(whisper\w*|murmur\w*|under (?:his|her|their) breath|aside to|mouthed|into (?:his|her|their) ear)\b/i

/** A note saying someone left the place (not a thing they left behind) or died. */
export const LEFT_OR_DIED =
  /\b(?:left|leaves) (?:the (?:room|house|inn|hall|tavern|yard|kitchen|building|camp|ship|city|town|village|chapel|cottage|shop)|for|through|by|home|town)\b|\b(?:went|goes|walked|walks|ran|runs|stormed|storms|slipped|slips|hurried|hurries|stepped|steps) (?:out|off|away)\b|\b(?:departed|departs|fled|flees|rode (?:off|away|out)|set off|sets off)\b|\b(?:died|dies|is dead|was killed|is killed)\b/i

export type Person = Pick<EntryState, 'id' | 'name' | 'kind'> & Partial<Pick<EntryState, 'aliases' | 'summary' | 'tags' | 'fields'>>

export interface StageInput {
  paras: Para[]
  /** The paragraph the words are in. */
  index: number
  /** The scene card's point of view and those present. */
  onCard: ID[]
  /** The card's point of view: on stage from the start, named or not. */
  pov?: ID | null
  /** Everyone who could be there: the characters at this scene. */
  people: Person[]
  /** People who left or died at a paragraph of this scene, with its index. */
  gone: { id: ID; index: number }[]
}

// ---------- Named as there, or only thought of ----------

/** Up to two words between the verb and the name ("missed her sister Anna"). */
const FILL = "(?:[\\p{L}'’-]+\\s+){0,2}"
/** Just before a name, in its sentence: only thinking of them. */
const THOUGHT_OF = new RegExp(
  `\\b(?:(?:thought|thinks?|thinking|dream(?:ed|t|s|ing)?)\\s+(?:of|about)|remember(?:ed|s|ing)?|recall(?:ed|s|ing)?|miss(?:ed|es|ing)?|long(?:ed|s|ing)? for|pictur(?:ed|es|ing)|imagin(?:ed|es|ing)|wonder(?:ed|s|ing)?\\s+(?:about|where|whether|if|how|what)|no sign of)\\s+${FILL}$`,
  'iu'
)
/** After a name, anywhere in its sentence: told as somewhere far off. */
const FAR = /\b(?:miles|leagues|kilometres|kilometers|days?|weeks?|a world|half a world|an ocean) away\b|\bfar (?:away|off|from (?:here|there|them|us|her|him))\b|\bacross the (?:sea|ocean|water|world)\b|\b(?:was|is|were|had been)(?:n't| not) (?:there|here|with (?:them|us|her|him))\b|\b(?:was|is) away\b/iu
/** After a name and a comma (said of them, not what they do): "Anna, back home, ...". */
const FAR_ASIDE = /^\s*,[^.!?…]*?\b(?:back home|in the capital|overseas|abroad)\b/iu
/** Words that bring someone in, before a far-off phrase ("Anna came back home"): they are there. */
const ARRIVES = /\b(?:came|comes|coming|arrived|arrives|arriving|returned|returns|walked|walks|stepped|steps|entered|enters|burst|ran|runs|hurried|hurries|sat|sits|stood|stands|is back|was back)\b/iu

const patterns = new Map<string, RegExp>()
function nameRe(name: string): RegExp {
  let re = patterns.get(name)
  if (!re) {
    if (patterns.size > 5_000) patterns.clear()
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
    re = new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, `g${/\s/.test(name) || !/^\p{Lu}/u.test(name) ? 'iu' : 'u'}`)
    patterns.set(name, re)
  }
  re.lastIndex = 0
  return re
}

/** The names a person is found by: name, other names, and a capitalised first name of three letters or more. */
function namesOf(p: Person): string[] {
  const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()
  const names = [p.name, ...(p.aliases ?? [])].map(clean).filter((n) => n.length >= 2)
  const first = clean(p.name).split(' ')[0] ?? ''
  if (first.length >= 3 && /^\p{Lu}/u.test(first) && !names.includes(first)) names.push(first)
  return names
}

/** True when this mention only thinks of someone, or tells them as far away. */
function absentMention(text: string, start: number, end: number): boolean {
  const from = Math.max(text.slice(0, start).search(/[.!?…][^.!?…]*$/) + 1, 0)
  const tail = text.slice(end)
  const stop = tail.search(/[.!?…]/)
  const before = text.slice(from, start)
  const after = stop < 0 ? tail : tail.slice(0, stop)
  if (THOUGHT_OF.test(before)) return true
  if (FAR_ASIDE.test(after)) return true
  const far = after.search(FAR)
  return far >= 0 && !ARRIVES.test(after.slice(0, far))
}

/** How a paragraph names someone: as there, only as thought of or far away, or not at all. */
export function namedIn(text: string, p: Person): 'there' | 'away' | null {
  let seen = false
  for (const n of namesOf(p)) {
    for (const m of text.matchAll(nameRe(n))) {
      const at = m.index ?? 0
      if (!absentMention(text, at, at + m[0].length)) return 'there'
      seen = true
    }
  }
  return seen ? 'away' : null
}

// ---------- On stage ----------

/** The people on stage at a paragraph, card first, then in the order given. */
export function onStageAt(o: StageInput): ID[] {
  const people = o.people.filter(isPerson)
  const near = o.paras.slice(Math.max(0, o.index - NAMED_BEFORE), o.index + 1).map((p) => p.text)
  const left = new Set(o.gone.filter((g) => g.index < o.index).map((g) => g.id))
  const card = new Set(o.onCard)
  /** On the card: there from the start (the point of view, or never named as there), or from where they come in. */
  const cardThere = (p: Person): boolean => {
    if (p.id === o.pov) return true
    const first = o.paras.findIndex((x) => namedIn(x.text, p) === 'there')
    return first < 0 || first <= o.index
  }
  const out: ID[] = []
  for (const p of people) if (card.has(p.id) && !left.has(p.id) && cardThere(p)) out.push(p.id)
  for (const p of people) {
    if (card.has(p.id) || out.includes(p.id) || left.has(p.id)) continue
    if (near.some((t) => namedIn(t, p) === 'there')) out.push(p.id)
  }
  return out
}

/** The index of the paragraph holding a spot (by its paragraph id, or by where it starts in the scene's plain text). */
export function paraIndexOf(paras: Para[], spot: { paragraphId: string | null; start: number }): number {
  if (spot.paragraphId) return paras.findIndex((p) => p.pid === spot.paragraphId)
  return paras.findIndex((p) => p.offset != null && spot.start >= p.offset && spot.start <= p.offset + p.text.length)
}
