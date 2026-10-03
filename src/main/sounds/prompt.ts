// What the AI is asked when it marks the sounds of a part of a scene (AI sound effects under Read aloud), and how its
// reply is read. The call is one of Read aloud's (its marker, the Read aloud model, job 'speech'), with the Thinking
// set for sound effects. Pure.
import type { CueAnchor, SoundKind } from '@shared/contracts/sounds'
import { MARKER } from '../readAloud/speakers'

/** The paragraphs of a part: numbered ones the AI may mark ([P1]...), and Adam's, shown for the story only ([--]). */
export interface PromptParagraph {
  pid: string
  text: string
  /** Adam's: the AI adds nothing here. */
  owned: boolean
}

/** A library sound the AI is shown, to reuse word for word. */
export interface ShownSound {
  kind: SoundKind
  description: string
}

/** Instructions for marking a passage's sounds. */
export const SOUNDS_PROMPT = `${MARKER} sounds
You are the sound designer for the audiobook of a novel. Sound effects and ambience play quietly under the narrator's voice, as a well-made audiobook uses them: sparingly and subtly, so they never distract from the story.

The passage comes in numbered paragraphs, like [P3]. Paragraphs shown as [--] already have their sounds: add nothing in them.

Mark only concrete, clearly audible sounds that happen in the scene at that moment:
- An effect: a one-off sound (a door slamming, a glass shattering, a gunshot, a horse whinnying). It plays on the word where it happens.
- An ambience: the steady background sound of a place (rain on a roof, a crackling fire, a busy tavern, wind over moorland, waves on a shore). It loops from where it starts until it is ended or another ambience starts, which replaces it. Start one only where the place has a sound of its own, and change it when the place or the weather changes.
Never music, singing, speech, voices or words of any kind. Never a sound that is only remembered, imagined, thought of, talked about or compared to ("a voice like thunder"), and never a metaphor. Leave out the sounds a listener takes for granted (ordinary footsteps, breathing, people talking).
Keep it sparse: at most about one effect every few paragraphs, many paragraphs with none, and no effect for what the ambience already gives. When in doubt, leave it out. No sounds at all is a fine answer.

Describe each sound for a sound generator: concrete and acoustic, 3 to 10 words, what makes it and how it sounds ("a heavy wooden door slamming shut", "steady rain drumming on a tin roof"); no names of people or places, nothing that can't be heard. When one of the library's sounds fits, use its description word for word.

Reply with only a JSON object, like:
{"sounds":[{"type":"effect","sound":"a heavy wooden door slamming shut","p":3,"at":"the door slammed shut","word":"slammed","seconds":2},{"type":"ambience","sound":"steady rain on a tin roof","p":1,"at":"rain hammered the roof","word":"rain","until":{"p":6,"at":"stepped into the warm kitchen","word":"stepped"}}]}
- "p": the paragraph's number. "at": a few words copied exactly from that paragraph where the sound happens. "word": the one word among them where it is heard.
- "seconds" (effects): how long it lasts, 1 to 10.
- "until" (ambience): where it stops, in the same form; null keeps it going.
- To stop the ambience already playing without starting another: {"type":"stop","p":5,"at":"...","word":"..."}.
- Nothing to add: {"sounds":[]}.`

/** Characters of the scene before a part, sent for context. */
export const CONTEXT = 1500

/** What the AI is sent for one part. */
export function soundsUser(o: {
  before: string
  playing: string | null
  library: ShownSound[]
  paragraphs: PromptParagraph[]
}): string {
  const out: string[] = []
  if (o.before.trim()) out.push(`Earlier in the scene, for context only:\n${o.before.slice(-CONTEXT)}\n\n---`)
  out.push(o.playing ? `Playing as this passage starts: the ambience "${o.playing}".` : 'No ambience is playing as this passage starts.')
  out.push(
    o.library.length
      ? `Sounds already in the library (reuse a description word for word when it fits):\n${o.library.map((s) => `- ${s.kind}: ${s.description}`).join('\n')}`
      : 'The library has no sounds yet.'
  )
  let n = 0
  const passage = o.paragraphs.map((p) => `${p.owned ? '[--]' : `[P${++n}]`} ${p.text}`).join('\n\n')
  out.push(`The passage:\n${passage}`)
  return out.join('\n\n')
}

/** The paragraph each number in a part stands for ([P1] is the first that isn't Adam's). */
export const numberedPids = (paragraphs: PromptParagraph[]): string[] => paragraphs.filter((p) => !p.owned).map((p) => p.pid)

/** A place the AI named: a paragraph's number, words in it, and the word where it happens. */
export interface SaidPlace {
  p: number
  at: string
  word: string
}

/** One sound in the AI's reply, as read. */
export interface SaidSound extends SaidPlace {
  type: SoundKind | 'stop'
  sound: string
  seconds?: number
  until?: SaidPlace | null
}

/** Descriptions of sounds a listener would hear as words or music: never made. */
const NOT_A_SOUND = /\b(?:music|musical|song|songs|singing|sings|sung|melody|tune|speech|speaking|talking|voice|voices|words|narrat\w*|chatter\w*|conversation)\b/i

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')

function placeOf(v: unknown): SaidPlace | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const p = typeof o.p === 'number' ? o.p : typeof o.p === 'string' ? Number(o.p.replace(/^\s*P/i, '')) : NaN
  const at = str(o.at, 300)
  const word = str(o.word, 60)
  if (!Number.isInteger(p) || p < 1 || (!at && !word)) return null
  return { p, at, word }
}

const TYPES: Record<string, SoundKind | 'stop'> = {
  effect: 'effect',
  sfx: 'effect',
  'sound effect': 'effect',
  ambience: 'ambience',
  ambiance: 'ambience',
  ambient: 'ambience',
  background: 'ambience',
  stop: 'stop',
  end: 'stop'
}

/**
 * The AI's reply, read forgivingly: a JSON object with "sounds", or a bare list; a sound that can't be used is left
 * out. Null when the reply isn't one at all (cut off, empty, prose): the part is asked about again later, not kept as
 * having no sounds.
 */
export function parseSounds(reply: string): SaidSound[] | null {
  const text = reply.replace(/```(?:json)?/gi, '')
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s)
    } catch {
      return undefined
    }
  }
  let parsed = tryParse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
  if (parsed === undefined || (typeof parsed === 'object' && parsed && !Array.isArray(parsed) && !('sounds' in parsed))) {
    const list = tryParse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1))
    if (Array.isArray(list)) parsed = list
  }
  const items = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { sounds?: unknown })?.sounds) ? (parsed as { sounds: unknown[] }).sounds : null
  if (!items) return null
  const out: SaidSound[] = []
  for (const item of items.slice(0, 200)) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const type = TYPES[str(o.type ?? o.kind, 30).toLowerCase()]
    const place = placeOf(o)
    if (!type || !place) continue
    if (type === 'stop') {
      out.push({ type, sound: '', ...place })
      continue
    }
    const sound = str(o.sound ?? o.description, 120)
    if (!sound || /^none$/i.test(sound) || NOT_A_SOUND.test(sound)) continue
    const said: SaidSound = { type, sound, ...place }
    if (type === 'effect') {
      const seconds = Number(o.seconds)
      if (Number.isFinite(seconds) && seconds > 0) said.seconds = seconds
    } else said.until = placeOf(o.until)
    out.push(said)
  }
  return out
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A pattern for words as written, forgiving case, spacing and the kind of quote mark or dash. */
function looseWords(words: string): RegExp | null {
  const parts = words
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) =>
      escape(w)
        .replace(/['‘’]/g, "['‘’]")
        .replace(/["“”]/g, '["“”]')
        .replace(/[-–—]/g, '[-–—]')
    )
  return parts.length ? new RegExp(parts.join('\\s+'), 'iu') : null
}

/** A whole word, forgiving case. */
const wholeWord = (word: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])${escape(word.trim())}(?![\\p{L}\\p{N}])`, 'iu')

/** The first word in a stretch of text, as [from, to) of `text`. */
function firstWord(text: string, from: number, to: number): [number, number] | null {
  const m = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/u.exec(text.slice(from, to))
  return m ? [from + m.index, from + m.index + m[0].length] : null
}

/**
 * Where in a paragraph a sound happens: `at` found in it (case and spacing forgiven), then `word` inside that (else
 * its first word); else `word` alone, the first whole-word match; else null (the sound is dropped).
 */
export function locate(text: string, pid: string, at: string, word: string): CueAnchor | null {
  const anchor = (from: number, to: number): CueAnchor => ({ pid, from, to, words: text.slice(from, to) })
  const re = at ? looseWords(at) : null
  const m = re ? re.exec(text) : null
  if (m) {
    const inside = word ? wholeWord(word).exec(m[0]) : null
    if (inside) return anchor(m.index + inside.index, m.index + inside.index + inside[0].length)
    const first = firstWord(text, m.index, m.index + m[0].length)
    if (first) return anchor(...first)
  }
  if (word) {
    const w = wholeWord(word).exec(text)
    if (w) return anchor(w.index, w.index + w[0].length)
  }
  return null
}
