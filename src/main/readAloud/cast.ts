// Adapted from mcreader-v2, src/lib/speech/cast.ts (reading aloud's own text-to-speech code; Adam's rule,
// 2 October 2026). AI Write adds the scene's own cast (its card) narrowing the choice, and "I said" for the
// viewpoint character.
//
// Who says a line of dialogue, so reading aloud can give it that character's voice. The rules come first:
// - a speech tag naming a character ("said Mara", "Mara whispered"), or "I said" for the viewpoint character;
// - a paragraph whose narration names one character of the scene and no other;
// - the same speaker carrying on within a paragraph;
// - turn-taking in a back-and-forth between two characters.
// A tag naming someone the cast doesn't have ("someone muttered", "said the driver") is nobody's turn. What the
// rules can't tell is left to the AI's marks (speakers.ts), or to the dialogue voice. Names are found the way the
// memory keeper finds them (keeper/text.ts, mentionAt): whole words in any alphabet ("Zoë"), and a single
// capitalised name only when written with its capital, so "will" is never Will.
import type { CharacterVoice } from '@shared/contracts/readAloud'
import type { CastEntry } from './types'

/** Speech verbs a dialogue tag uses. */
export const VERBS =
  'said|says|asked|asks|replied|replies|answered|whispered|whispers|muttered|mutters|murmured|called|shouted|snapped|added|told|tells|laughed|sighed|growled|hissed|breathed|admitted|agreed|insisted|yelled|screamed|shrieked|bellowed|roared|cried|sobbed|wept|pleaded|begged|demanded|ordered|barked|mumbled|stammered|stuttered|gasped|giggled|chuckled|groaned|whimpered|teased|warned|snarled|scoffed|sneered|exclaimed|repeated|continued'

/** A name after a title: "Anselm" in "Brother Anselm". */
const TITLED =
  /^(Magistrate|Captain|Brother|Sister|Father|Mother|Doctor|Inspector|Sergeant|Lieutenant|Commander|Colonel|General|Admiral|Professor|Lord|Lady|Sir|King|Queen|Prince|Princess|Duke|Duchess|Baron|Baroness|Count|Countess|Abbot|Abbess|Bishop|Mayor|Judge|Master|Mistress)\s+([A-Z][\p{L}-]+)/u

/** Every way the page may name this character, longest first: "Ines Varga", "the captain", "Ines". */
export function namesFor(e: Pick<CastEntry, 'name' | 'aliases'>): string[] {
  // The short form: the name after a title ("Anselm" in "Brother Anselm"), else the first name.
  const titled = e.name.trim().match(TITLED)
  const short = titled ? titled[2]! : e.name.trim().split(/\s+/)[0]!
  const all = [e.name, ...e.aliases, short].map((n) => n.trim()).filter((n) => n.length >= 3)
  return [...new Set(all)].sort((a, b) => b.length - a.length)
}

export interface CastMember {
  id: string
  name: string
  names: string[]
  voice?: CharacterVoice
  about?: string
  /** Told to the AI: on this scene's card, so in the scene (not only mentioned or remembered). */
  here?: boolean
}

/** A name as a pattern: its own characters, and any run of spaces where it has one. */
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
/** A name's edges: no letter or number either side, in any alphabet (`\b` knows only "a" to "z"). */
const START = '(?<![\\p{L}\\p{N}])'
const END = '(?![\\p{L}\\p{N}])'

/**
 * Names in two groups, as the memory keeper reads them: a single capitalised word ("Will", "Rose") only as written,
 * so ordinary words don't count; a phrase or a lower-case alias ("the captain") in any case.
 */
function nameGroups(names: string[]): { any: string; flags: string }[] {
  const exact = names.filter((n) => !/\s/.test(n) && /^\p{Lu}/u.test(n))
  // "the ring" is the character Ring, in any case (a character who is a thing or an animal is written so).
  const folded = [...names.filter((n) => !exact.includes(n)), ...exact.map((n) => `the ${n}`)]
  return [
    { list: exact, flags: 'u' },
    { list: folded, flags: 'iu' }
  ]
    .filter((g) => g.list.length)
    .map((g) => ({ any: `(?:${g.list.map(esc).join('|')})`, flags: g.flags }))
}

/** The speech verbs, also with a capital ("Said Mara."), for the patterns that keep a name's case. */
const VERB = VERBS.split('|')
  .map((v) => `[${v.charAt(0)}${v.charAt(0).toUpperCase()}]${v.slice(1)}`)
  .join('|')
/** The end of a name a tag gives the line to: "said Mara", not "said Mara's brother". */
const OWN = `(?![\\p{L}\\p{N}]|['’]s${END})`
const tagAfter = (who: string, flags: string): RegExp =>
  new RegExp(`^\\s*,?\\s*(?:${who}\\s+(?:${VERB})${END}|(?:${VERB})\\s+(?:[Tt]he\\s+)?${who}${OWN})`, flags)
const tagBefore = (who: string, flags: string): RegExp => new RegExp(`${START}${who}\\s+(?:${VERB})${END}[^.!?"“”]{0,40}[,:]?\\s*$`, flags)

/** The patterns that find one character: a tag after a quote, a tag before one, and their name anywhere. */
interface NamePatterns {
  after: RegExp[]
  before: RegExp[]
  named: RegExp[]
  /** Their name opening a sentence of the narration: "Jane set the cup down." (the one doing something). */
  subject: RegExp[]
}

/** A sentence's start: the paragraph's, or after a full stop (with any closing quote or bracket) and a space. */
const SENTENCE_START = String.raw`(?:^|[.!?…]["”’)\]]*\s+)(?:(?:Then|But|And|So|Now|Still|Slowly|Finally|Instead),?\s+)?`

/** Made once for each cast member (a plan reads every quote against every character). */
const patterns = new WeakMap<CastMember, NamePatterns>()
function patternsOf(c: CastMember): NamePatterns {
  let p = patterns.get(c)
  if (!p) {
    const groups = nameGroups(c.names)
    p = {
      after: groups.map((g) => tagAfter(g.any, g.flags)),
      before: groups.map((g) => tagBefore(g.any, g.flags)),
      named: groups.map((g) => new RegExp(`${START}${g.any}${END}`, g.flags)),
      subject: groups.map((g) => new RegExp(`${SENTENCE_START}${g.any}${END}`, g.flags))
    }
    patterns.set(c, p)
  }
  return p
}

/** True when the text names this character, by any of their names, as a whole word or phrase. */
export const namedIn = (c: CastMember, text: string): boolean => patternsOf(c).named.some((re) => re.test(text))

/** "I said": the viewpoint character, when the story is told in the first person. */
const I_AFTER = tagAfter('I', 'u')
const I_BEFORE = tagBefore('I', 'u')

/** The characters of a world, each with every name the page may use for them, longest first. */
export function castOf(entries: readonly CastEntry[] | undefined): CastMember[] {
  return (entries ?? [])
    .filter((e) => e.name.trim())
    .map((e) => ({
      id: e.id,
      name: e.name.trim(),
      names: namesFor(e),
      voice: e.voice,
      about: e.about.trim().replace(/\s+/g, ' ').slice(0, 160)
    }))
    .filter((c) => c.names.length)
}

/**
 * The characters reading aloud can name in a scene: anyone in the world when a tag names them outright, the scene's
 * own cast (from its card, when it lists anyone) for the rest, and the viewpoint character for "I said".
 */
export interface SceneCast {
  all: CastMember[]
  scene: CastMember[]
  pov: CastMember | null
}

/** A cast where the scene's own cast is everyone (tests, and scenes whose card lists nobody). */
export const everyone = (all: CastMember[], pov: CastMember | null = null): SceneCast => ({ all, scene: all, pov })

/** A letter or number in any alphabet. */
const NAME_CHAR = '[\\p{L}\\p{N}]'

/** A name as the AI might write it, for comparing: no case, "the", notes in brackets or end punctuation. */
const bareName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[\s"“”'’.,!?;:—–-]+$/u, '')
    .replace(/^[\s"“”'’]+/u, '')
    .replace(/^the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * A name the AI gave back ("Ines", "the captain") as a cast member. The AI doesn't always write a name exactly as the
 * page has it: "Adam (whispering)" or "Adam." is Adam, and so is "Adam Reyes" for a page called "Adam", when only one
 * character's name is in it ("Adam's brother" is not Adam), and "Wen" is Old Wen when no one else's name has it.
 */
export function memberNamed(cast: CastMember[], who: string | undefined): CastMember | null {
  const w = bareName(who ?? '')
  if (!w || w === 'narrator') return null
  const exact = cast.find((c) => c.names.some((n) => bareName(n) === w))
  if (exact) return exact
  const within = cast.filter((c) =>
    c.names.some((n) => {
      const name = bareName(n)
      return name.length >= 3 && new RegExp(`${START}${esc(name)}(?!${NAME_CHAR}|['’]s${END})`, 'iu').test(w)
    })
  )
  if (within.length === 1) return within[0]
  // One word of a longer name ("Wen" for Old Wen), when nobody else's name has it.
  const part = /^\S{3,}$/u.test(w) ? cast.filter((c) => c.names.some((n) => bareName(n).split(/\s+/).length > 1 && bareName(n).split(/\s+/).includes(w))) : []
  return within.length === 0 && part.length === 1 ? part[0] : null
}

/**
 * The speaker of the quote at `[at, at + len)` in `para`: `tagged` when a dialogue tag names them (or "I said", the
 * viewpoint character), `named` when the paragraph's narration names only them of the scene's cast, or null.
 */
export function speakerOf(para: string, at: number, len: number, cast: SceneCast): { who: CastMember; how: 'tagged' | 'named' } | null {
  const after = para.slice(at + len, at + len + 60)
  const before = para.slice(Math.max(0, at - 80), at)
  const tagged = cast.all.filter((c) => {
    const p = patternsOf(c)
    return p.after.some((re) => re.test(after)) || p.before.some((re) => re.test(before))
  })
  // Two characters can share a name ("Ines" and "Ines Varga" as separate pages); the longest match wins.
  if (tagged.length) return { who: tagged.sort((a, b) => b.names[0].length - a.names[0].length)[0], how: 'tagged' }
  // Told in the first person: "I said" is the viewpoint character.
  if (cast.pov && (I_AFTER.test(after) || I_BEFORE.test(before))) return { who: cast.pov, how: 'tagged' }
  // Named in the narration as the one doing something, a sentence opening with their name ("Jane set the cup down."),
  // not inside a quote ("Where's Tomas?" is not Tomas talking) or as who someone thinks of ("She thought of Laura.").
  const narration = para.replace(/["“][^"”]*["”]/g, '. ')
  const named = cast.scene.filter((c) => patternsOf(c).subject.some((re) => re.test(narration)))
  if (named.length === 1) return { who: named[0], how: 'named' }
  // A scene whose card has one character in it: an untagged line is theirs.
  if (cast.scene !== cast.all && cast.scene.length === 1) return { who: cast.scene[0], how: 'named' }
  return null
}

/** A word of a tag's subject: letters and numbers in any alphabet, with an apostrophe or a hyphen inside. */
const WORD = "[\\p{L}\\p{N}][\\p{L}\\p{N}’'-]*"
/** A tag after a quote, its subject first: "someone muttered", "the old man said". */
const SUBJECT_AFTER = new RegExp(`^\\s*,?\\s*((?:${WORD}\\s+){0,3}${WORD})\\s+(?:${VERBS})${END}`, 'iu')
/** A tag after a quote, its verb first: "said the driver". */
const SUBJECT_LATER = new RegExp(`^\\s*,?\\s*(?:${VERBS})\\s+((?:(?:the|a|an|another|one|some)\\s+)?${WORD})`, 'iu')
/** A tag opening the sentence a quote follows: "The driver said, “Out.”" */
const SUBJECT_BEFORE = new RegExp(
  `(?:^|[.!?…]["”’)]*\\s+|["”]\\s+)((?:${WORD}\\s+){0,2}${WORD})\\s+(?:${VERBS})${END}[^.!?"“”]{0,40}[,:]?\\s*$`,
  'iu'
)
/** Who a tag's "he" or "she" is, the rules leave to turn-taking. */
const PRONOUN = /^(?:he|she|they|i|we|you|it)$/i

/**
 * True when a dialogue tag gives the quote to someone the cast doesn't have: "someone muttered", "said the driver",
 * "her brother said". A tag with "he" or "she", or naming anyone in the cast, isn't one.
 */
export function strangerTag(para: string, at: number, len: number, cast: SceneCast): boolean {
  const after = para.slice(at + len, at + len + 60)
  // The whole paragraph before the quote, so a tag is read from the start of its sentence.
  const subject = SUBJECT_AFTER.exec(after)?.[1] ?? SUBJECT_LATER.exec(after)?.[1] ?? SUBJECT_BEFORE.exec(para.slice(0, at))?.[1]
  if (!subject) return false
  const words = subject.split(/\s+/)
  if (words.some((w) => PRONOUN.test(w))) return false
  // "Mara's brother" is not Mara.
  const named = words.filter((w) => !/['’]s$/i.test(w)).join(' ')
  return !cast.all.some((c) => namedIn(c, named))
}

export interface Attribution {
  who: CastMember
  how: 'tagged' | 'label' | 'named' | 'turn'
}

/**
 * A piece of a run, in reading order: its paragraph, where it starts in it and how long it is. `label` is the
 * speaker the AI marked for a quote (speakers.ts): a cast member, null for someone not in the cast, or undefined
 * for none.
 */
export interface RunPiece {
  /** The paragraph's id (two paragraphs can have the same words). */
  block?: string
  para?: string
  at?: number
  len: number
  quote: boolean
  label?: CastMember | null
}

/**
 * Speakers for a whole run of pieces, in order, so one character keeps one voice through a conversation, not
 * only on the lines that carry a tag:
 * - a tag naming a character decides, as in `speakerOf`;
 * - then the speaker the AI marked for the quote with the whole scene in view, when there is one;
 * - then a paragraph naming only one character;
 * - a later quote in the same paragraph is the same speaker as the one before it (one speaker per paragraph);
 * - an untagged quote opening a new paragraph, in the middle of a back-and-forth between two characters, is the
 *   other one's turn.
 * Someone the cast doesn't have (marked so by the AI, or named by a tag: "someone muttered") says their lines, and
 * the untagged ones after them in their paragraph, as nobody the rules know: those are left to the AI, and the
 * back-and-forth carries on around them. Two paragraphs with no dialogue end the conversation.
 */
export function attributeRun(pieces: RunPiece[], cast: SceneCast): (Attribution | null)[] {
  let last: CastMember | null = null
  let other: CastMember | null = null
  let lastPara: string | undefined
  let quiet = 0
  let seenPara: string | undefined
  let paraHasQuote = false
  let lastHow: Attribution['how'] = 'turn'
  /** The paragraph someone outside the cast is talking in. */
  let strangerIn: string | undefined
  return pieces.map((p) => {
    const block = p.block ?? p.para
    if (block !== seenPara) {
      if (seenPara !== undefined && !paraHasQuote && ++quiet >= 2) {
        last = other = null
        lastPara = strangerIn = undefined
      }
      seenPara = block
      paraHasQuote = false
    }
    if (!p.quote || p.para == null || p.at == null) return null
    paraHasQuote = true
    quiet = 0
    let found: Attribution | null = speakerOf(p.para, p.at, p.len, cast)
    const tagged = found?.how === 'tagged'
    // Someone the cast does not have: their own line, and no guess from turns.
    const stranger =
      !tagged && (p.label === null || (p.label === undefined && (block === strangerIn || strangerTag(p.para, p.at, p.len, cast))))
    if (stranger) {
      lastPara = strangerIn = block
      return null
    }
    // Inside one paragraph, the speaker of a tagged quote keeps the untagged ones after it.
    const sameTagged = last && block === lastPara && lastHow === 'tagged'
    if (!tagged && p.label) found = { who: p.label, how: 'label' }
    else if (sameTagged && !tagged) found = { who: last!, how: 'tagged' }
    else if (!found && last && block === lastPara) found = { who: last, how: lastHow }
    // A turn goes back only to someone in the scene: a character who spoke only in a memory or a call isn't here.
    else if (!found && last && other && block !== lastPara && cast.scene.includes(other)) found = { who: other, how: 'turn' }
    if (found) {
      strangerIn = undefined
      if (found.who !== last) {
        other = last
        last = found.who
      }
      lastHow = found.how
    }
    lastPara = block
    return found
  })
}
