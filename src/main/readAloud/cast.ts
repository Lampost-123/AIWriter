// Adapted from mcreader-v2, src/lib/speech/cast.ts (reading aloud's own text-to-speech code; Adam's rule,
// 2 October 2026). AI Write adds the scene's own cast (its card) narrowing the choice, and "I said" for the
// viewpoint character.
//
// Who says a line of dialogue, so reading aloud can give it that character's voice. The rules come first:
// - a speech tag naming a character ("said Mara", "Mara whispered"), or "I said" for the viewpoint character;
// - a paragraph whose narration names one character of the scene and no other;
// - the same speaker carrying on within a paragraph;
// - turn-taking in a back-and-forth between two characters.
// What the rules can't tell is left to the AI's marks (speakers.ts), or to the dialogue voice.
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
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const anyOf = (names: string[]): string => `(?:${names.map(esc).join('|')})`

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

/** A name the AI gave back ("Ines", "the captain") as a cast member. */
export function memberNamed(cast: CastMember[], who: string | undefined): CastMember | null {
  const w = (who ?? '')
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, '')
  if (!w || w === 'narrator') return null
  return cast.find((c) => c.names.some((n) => n.toLowerCase().replace(/^the\s+/, '') === w)) ?? null
}

const tagAfter = (who: string): RegExp => new RegExp(`^\\s*,?\\s*(?:${who}\\s+(?:${VERBS})\\b|(?:${VERBS})\\s+(?:the\\s+)?${who}\\b)`, 'i')
const tagBefore = (who: string): RegExp => new RegExp(`\\b${who}\\s+(?:${VERBS})\\b[^.!?"“”]{0,40}[,:]?\\s*$`, 'i')

/**
 * The speaker of the quote at `[at, at + len)` in `para`: `tagged` when a dialogue tag names them (or "I said", the
 * viewpoint character), `named` when the paragraph's narration names only them of the scene's cast, or null.
 */
export function speakerOf(para: string, at: number, len: number, cast: SceneCast): { who: CastMember; how: 'tagged' | 'named' } | null {
  const after = para.slice(at + len, at + len + 60)
  const before = para.slice(Math.max(0, at - 80), at)
  const tags = (who: string): boolean => tagAfter(who).test(after) || tagBefore(who).test(before)
  const tagged = cast.all.filter((c) => tags(anyOf(c.names)))
  // Two characters can share a name ("Ines" and "Ines Varga" as separate pages); the longest match wins.
  if (tagged.length) return { who: tagged.sort((a, b) => b.names[0].length - a.names[0].length)[0], how: 'tagged' }
  // Told in the first person: "I said" is the viewpoint character.
  if (cast.pov && tags('I')) return { who: cast.pov, how: 'tagged' }
  // Named in the narration, not inside a quote: "Where's Tomas?" is not Tomas talking.
  const narration = para.replace(/["“][^"”]*["”]/g, ' ')
  const named = cast.scene.filter((c) => new RegExp(`\\b${anyOf(c.names)}\\b`, 'i').test(narration))
  return named.length === 1 ? { who: named[0], how: 'named' } : null
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
 * Two paragraphs with no dialogue end the conversation.
 */
export function attributeRun(pieces: RunPiece[], cast: SceneCast): (Attribution | null)[] {
  let last: CastMember | null = null
  let other: CastMember | null = null
  let lastPara: string | undefined
  let quiet = 0
  let seenPara: string | undefined
  let paraHasQuote = false
  let lastHow: Attribution['how'] = 'turn'
  return pieces.map((p) => {
    const block = p.block ?? p.para
    if (block !== seenPara) {
      if (seenPara !== undefined && !paraHasQuote && ++quiet >= 2) {
        last = other = null
        lastPara = undefined
      }
      seenPara = block
      paraHasQuote = false
    }
    if (!p.quote || p.para == null || p.at == null) return null
    paraHasQuote = true
    quiet = 0
    let found: Attribution | null = speakerOf(p.para, p.at, p.len, cast)
    // Inside one paragraph, the speaker of a tagged quote keeps the untagged ones after it.
    const sameTagged = last && block === lastPara && lastHow === 'tagged'
    if (found?.how !== 'tagged' && p.label !== undefined) {
      // Someone the cast does not have: their own line, and no guess from turns.
      if (p.label === null) {
        lastPara = block
        return null
      }
      found = { who: p.label, how: 'label' }
    } else if (sameTagged && found?.how !== 'tagged') found = { who: last!, how: 'tagged' }
    else if (!found && last && block === lastPara) found = { who: last, how: lastHow }
    else if (!found && last && other && block !== lastPara) found = { who: other, how: 'turn' }
    if (found) {
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
