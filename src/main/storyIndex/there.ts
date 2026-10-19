// Who the words put on stage, and who they only mention (2026-10-19, two stand-in runs): the keeper's rule
// (keeper/presence.ts namedIn: not only thought of, talked of or far away), with the mentions it still took as "there"
// set aside first:
// - someone else's name that starts the same way: "Mother Rook" is not Mother Agate, "Master Edric" is not Master Gale;
//   a title alone ("Mother", "Warden") never names someone, only a name or other name does ("the Warden");
// - what is theirs, not them: "the Warden's men", "Oskar's ferry", "Oskar Venn's punt" (but "Ash's hand", "Gale's
//   voice" put them there);
// - what they said once, or may do: "Oskar had said", "Gale would be watching it".
// Used for who is in a scene in the story index (build.ts), the plan's "everyone in the scene" (plan/core.ts), Continue's
// list of people and where things stand as the writer is told it (ai/context.ts toldStage, edits/index.ts). Pure.

import type { SceneState } from '@shared/continuity'
import { namedIn, type Person } from '../keeper/presence'
import { stageFor, type StageScope } from '../ai/mustStay'

/** Words that only say what someone is (a title), never who: a first word like these is no name on its own. */
const TITLES = new Set(
  (
    'mother father master mistress warden magistrate captain sir lady lord doctor dr mr mrs miss ms madam dame aunt uncle ' +
    'brother sister old young king queen prince princess saint st general colonel major sergeant lieutenant professor ' +
    'judge reverend abbot abbess bishop granny grandma grandpa grandmother grandfather widow goodwife goody the'
  ).split(' ')
)

/** What of someone's after "'s" puts them there: their body, voice or step. */
const THEIR_OWN = new Set(
  (
    'hand hands arm arms face eye eyes voice shoulder shoulders back head hair mouth lip lips finger fingers fist knee knees ' +
    'foot feet leg legs breath gaze glance grip laugh smile shadow step steps footsteps tread jaw chin cheek cheeks neck ' +
    'chest elbow wrist brow whisper expression body'
  ).split(' ')
)

/** After a name: what they once said, or what they may be doing or may do. */
const NOT_NOW = /^\s+(?:had\s+(?:said|told|written|warned|promised|sworn|asked|sent|claimed|wanted|meant|thought|known|reckoned)|(?:would|might|may|must|should|could|will|shall)\s+(?:not\s+)?(?:be|have)|will|shall)\b/iu
/** After a name: another capitalised word (the rest of someone else's name). */
const NEXT_NAME = /^\s+(\p{Lu}[\p{L}'’-]*)/u
/** After a name: "'s" and the word after it. */
const THEIRS = /^(?:['’]s|['’])(?![\p{L}\p{N}])\s+([\p{L}'’-]+)/u

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

const patterns = new Map<string, RegExp>()
/** A name as the keeper finds it: whole words; one capitalised word as written, any other in any case. */
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

/** The forms a person is found by, as the keeper finds them (their names, then a capitalised first name). */
function formsOf(p: Person): { full: string[]; first: string } {
  const full = [...new Set([p.name, ...(p.aliases ?? [])].map(clean).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length)
  const first = clean(p.name).split(' ')[0] ?? ''
  return { full, first: first.length >= 3 && /^\p{Lu}/u.test(first) && !full.includes(first) ? first : '' }
}

/**
 * A line with each mention of `p` that doesn't put them on stage blanked out (the rules at the top of this file), so the
 * keeper's rule finds only the others.
 */
export function withoutMentions(line: string, p: Person): string {
  const { full, first } = formsOf(p)
  const own = new Set([...full, first].flatMap((n) => n.toLowerCase().split(/[^\p{L}\p{N}]+/u)).filter(Boolean))
  const out = line.split('')
  const taken: [number, number][] = []
  const blank = (s: number, e: number): void => {
    for (let i = s; i < e; i++) if (/[\p{L}\p{N}]/u.test(out[i])) out[i] = '_'
  }
  /** True when this mention only names someone else, what is theirs, or what they said or may do. */
  const mentionOnly = (end: number): boolean => {
    const after = line.slice(end)
    const next = NEXT_NAME.exec(after)?.[1]
    if (next && !own.has(next.toLowerCase().replace(/['’]s$/, ''))) return true
    const theirs = THEIRS.exec(after)
    if (theirs && !THEIR_OWN.has(theirs[1].toLowerCase())) return true
    return NOT_NOW.test(after)
  }
  for (const n of full) {
    for (const m of line.matchAll(nameRe(n))) {
      const s = m.index ?? 0
      const e = s + m[0].length
      if (taken.some(([a, b]) => s < b && e > a)) continue
      taken.push([s, e])
      if (mentionOnly(e)) blank(s, e)
    }
  }
  if (first) {
    for (const m of line.matchAll(nameRe(first))) {
      const s = m.index ?? 0
      const e = s + m[0].length
      if (taken.some(([a, b]) => s < b && e > a)) continue
      if (TITLES.has(first.toLowerCase()) || mentionOnly(e)) blank(s, e)
    }
  }
  return out.join('')
}

/**
 * True when some line of `words` puts `p` on stage: named as there by the keeper's rule (not only thought of, talked of
 * or far away), and not only by someone else's name, what is theirs, or what they once said or may do.
 */
export function onStageIn(words: string, p: Person): boolean {
  return words.split(/\n+/).some((line) => line.trim() && namedIn(withoutMentions(line, p), p) === 'there')
}

/**
 * Where things stand without anyone off the scene card whom the scene's words only mention (`scope.words`: the card's
 * words, Adam's direction, the scene so far): a stage read can list someone only named, and the keeper's rule took some
 * mentions as "there" (2026-10-19: "Gale would be watching it" put Gale "in the scene" of an inn he was days from).
 */
export function withoutMentioned(stand: SceneState | null, scope: Pick<StageScope, 'onCard' | 'cast' | 'words'>): SceneState | null {
  if (!stand) return stand
  const characters = stand.characters.filter((c) => {
    const one = { ...stand, characters: [c] }
    if (scope.onCard.some((e) => stageFor(e, one))) return true
    const e = scope.cast.find((x) => stageFor(x, one))
    const name = clean(e?.name ?? c.name)
    if (!name) return false
    return onStageIn(scope.words, { id: '', kind: 'character', name, aliases: [...new Set([c.name, ...(e?.aliases ?? [])])].filter((n) => n !== name) })
  })
  return characters.length === stand.characters.length ? stand : { ...stand, characters }
}
