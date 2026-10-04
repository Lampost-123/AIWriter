// Adapted from mcreader-v2, src/lib/speech/speakers.ts (reading aloud's own text-to-speech code; Adam's rule,
// 2 October 2026). In AI Write a mark is kept per paragraph with a hash of its words (marks.ts) and dropped when
// they change, so a mark is looked up by its line's own words only.
//
// Who says each quoted line, and how each line is said, marked by the AI with the scene in view where the rules
// (cast.ts) can't tell: "she said" three lines into a conversation takes a reader who has followed the scene.
// "Mark who says what" also has it note each line's tone and pace, a part of the scene at a time, a little ahead of
// the reading.
import { memberNamed, type CastMember } from './cast'
import { besideSound, BREEZE_TAGS, canonicalTag } from './perform'
import type { LineDelivery, ParagraphMarks } from './types'

/** Every AI call of reading aloud starts its instructions with this, then the job's name. */
export const MARKER = '[AIWRITE-READ-ALOUD v1]'

/** A paragraph with its marks. */
export interface Para extends ParagraphMarks {
  id: string
  text: string
}

/** A quoted line: straight or curly doubles. One left open runs to the end of its paragraph. */
export const QUOTE = /["“][^"”\n]*(?:["”]|(?=\n)|$)/g

/** What a mark can say besides a name. */
export const NARRATOR = 'narrator'
export const UNKNOWN = '?'

/** The key a quote's mark is kept under: its words, without case or punctuation. */
export function quoteKey(quote: string): string {
  return quote
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 80)
}

/** The quotes in a paragraph's text, in order. */
export function quotesIn(text: string): string[] {
  return [...text.matchAll(new RegExp(QUOTE.source, 'g'))].map((m) => m[0]).filter((q) => quoteKey(q))
}

/** A sentence of narration is marked under its own words with this in front, so no quote's key is ever a narration's. */
export const NARRATION = '~'

/** A sentence, with the space before it: the pieces reading aloud splits text into (segment.ts). */
export const SENTENCE = /\s*[^.!?…\n]+(?:[.!?…]+[)"'”’\]]*)?/g

/** A quote, or a sentence of the narration between quotes: where it is, and the key its marks are kept under. */
export interface Span {
  at: number
  end: number
  key: string
  quote: boolean
}

/**
 * A paragraph's quotes and the sentences of narration around them, in order, split as reading aloud splits it. A
 * line break ends a sentence too. Spans with no words are left out.
 */
export function spansIn(text: string): Span[] {
  const out: Span[] = []
  const push = (at: number, end: number, quote: boolean): void => {
    const k = quoteKey(text.slice(at, end))
    if (k) out.push({ at, end, key: quote ? k : NARRATION + k, quote })
  }
  const narration = (from: number, to: number): void => {
    for (const m of text.slice(from, to).matchAll(new RegExp(SENTENCE.source, 'g'))) {
      const lead = m[0].length - m[0].trimStart().length
      push(from + m.index! + lead, from + m.index! + m[0].length, false)
    }
  }
  let last = 0
  for (const m of text.matchAll(new RegExp(QUOTE.source, 'g'))) {
    narration(last, m.index!)
    push(m.index!, m.index! + m[0].length, true)
    last = m.index! + m[0].length
  }
  narration(last, text.length)
  return out
}

/** What is kept for one quote (a speaker, or how it is said), or with `narration` for a sentence of narration. */
export function savedFor<T>(saved: Record<string, T> | undefined, words: string, narration = false): T | undefined {
  if (!saved) return undefined
  const key = (narration ? NARRATION : '') + quoteKey(words)
  return key in saved ? saved[key] : undefined
}

/**
 * The paragraph with these speakers kept, only on quotes it still has. A name already kept stays; new ones fill
 * the gaps and replace a "?".
 */
export function withLabels<B extends Para>(block: B, labels: Record<string, string>): B {
  const keys = new Set(quotesIn(block.text).map(quoteKey))
  const merged: Record<string, string> = { ...labels }
  for (const [k, v] of Object.entries(block.speakers ?? {})) if (v !== UNKNOWN || !(k in labels)) merged[k] = v
  const kept = Object.fromEntries(Object.entries(merged).filter(([k]) => keys.has(k)))
  return { ...block, speakers: Object.keys(kept).length ? kept : undefined }
}

/** A sound mark's tag: one or two words naming a sound Breeze knows ("sniffing", "deep breath", "(sob)"). */
function soundTag(body: string): string | null {
  const bare = body
    .trim()
    .toLowerCase()
    .replace(/^\((.*)\)$/, '$1')
    .replace(/[.]+$/, '')
  return bare && bare.split(/\s+/).length <= 2 ? canonicalTag(bare) : null
}

const PACES: Record<string, 'slow' | 'fast' | ''> = {
  slow: 'slow',
  slowly: 'slow',
  fast: 'fast',
  quick: 'fast',
  quickly: 'fast',
  rushed: 'fast',
  normal: '',
  steady: ''
}

/**
 * A mark read: the speaker ("narrator" in any case as NARRATOR, "narration" as NARRATION), then, in any order, a
 * pace, a sound and a tone. A field of one or two words that names a sound Breeze knows is the sound, and also tone
 * when it says how ("nervous laugh"); "slow" or "fast" is the pace; the rest is tone.
 */
export function readMark(raw: string): { who: string; how?: LineDelivery } {
  const [first, ...rest] = raw.split('|').map((f) => f.trim().replace(/\s+/g, ' '))
  const name = (first ?? '').slice(0, 60)
  const who = /^(?:the )?narrator$/i.test(name) ? NARRATOR : /^(?:the )?narration$/i.test(name) ? NARRATION : name
  const how: LineDelivery = {}
  const tone: string[] = []
  const bareOf = (f: string): string =>
    f
      .toLowerCase()
      .replace(/[.]+$/, '')
      .replace(/^\((.*)\)$/, '$1')
  // A sound on its own ("chuckle") is the line's sound before one inside a note on how it sounds ("nervous laugh").
  const alone = (f: string): boolean => !!soundTag(bareOf(f)) && !besideSound(bareOf(f))
  const fields = rest.filter(Boolean)
  for (const f of [...fields.filter(alone), ...fields.filter((f) => !alone(f))]) {
    const word = f.toLowerCase().replace(/[.]+$/, '')
    const bare = bareOf(f)
    if (word in PACES) {
      if (PACES[word]) how.pace = PACES[word] as 'slow' | 'fast'
      continue
    }
    const sound = soundTag(bare)
    if (sound && !how.sound) {
      how.sound = sound
      // "frightened whisper", "furious, shouting": the sound, and the rest is how it sounds, which is tone too.
      if (besideSound(bare)) tone.push(f)
    } else tone.push(f)
  }
  // "frightened and angry, fast": a pace written into the note, as a model tends to, is the pace.
  const said = tone
    .join(', ')
    .split(/\s*,\s*/)
    .filter((w) => {
      const p = w.toLowerCase().replace(/[.]+$/, '')
      if (!/^(?:slow|slowly|fast|quickly)$/.test(p)) return !!w
      how.pace ??= PACES[p] as 'slow' | 'fast'
      return false
    })
  if (said.length) how.tone = said.join(', ').slice(0, 200)
  return Object.keys(how).length ? { who, how } : { who }
}

const castLines = (cast: CastMember[]): string =>
  cast
    .map(
      (c) =>
        `- ${c.name}${c.names.length > 1 ? ` (also ${c.names.filter((n) => n !== c.name).join(', ')})` : ''}${c.here ? ' [in this scene]' : ''}${c.about ? `: ${c.about}` : ''}`
    )
    .join('\n') || '- (none listed)'

/** Said when the scene's card says who is in it: someone only mentioned or remembered isn't speaking. */
const hereNote = (cast: CastMember[]): string =>
  cast.some((c) => c.here)
    ? '\nThose marked [in this scene] are the ones there. Someone only mentioned, remembered or thought about does not speak in it, unless the text shows them arriving or quotes them (a memory, a letter, a call).'
    : ''

/** Instructions for marking who says each quote. */
export const LABEL_PROMPT = (cast: CastMember[]): string => `${MARKER} speakers
You mark who speaks each line of dialogue in a scene from a novel, so an audiobook can read each character's lines in their own voice.
Every quoted line in the scene has a number in square brackets just before it, like [3]“Get out.”

Characters in this story:
${castLines(cast)}${hereNote(cast)}

Reply with only a JSON object mapping every number to who says that line, like {"1": "${cast[0]?.name ?? 'Mara'}", "2": "the guard"}.
- Use a listed character's name exactly as written above.
- Someone who is not listed: a few plain words ("the guard", "a waiter").
- Work it out the way a careful reader would: the dialogue tag and any action next to the line, who "he" or "she" is at that point in the scene, who is being answered, and whose turn it is in a back-and-forth where lines have no tag.
- A quote nobody says aloud (a sign, a title, a word being talked about, a thought written in quotes): "${NARRATOR}".
- Only when the text truly gives no way to tell: "${UNKNOWN}".`

/** Characters sent per call. A long scene is marked in parts, each with the end of the part before for context. */
export const PART = 12000
const CONTEXT = 1500

export interface Numbered {
  blockId: string
  key: string
}

/** The scene's prose with every quote that needs a speaker numbered, split into parts of a size one call can take. */
export function numbered(
  blocks: Para[],
  wanted: (b: Para, key: string) => boolean
): { parts: { text: string; before: string }[]; quotes: Numbered[] } {
  const quotes: Numbered[] = []
  const parts: { text: string; before: string }[] = []
  let text = ''
  let plain = ''
  for (const b of blocks) {
    if (!b.text.trim()) continue
    const marked = b.text.replace(new RegExp(QUOTE.source, 'g'), (q) => {
      const key = quoteKey(q)
      if (!key || !wanted(b, key)) return q
      quotes.push({ blockId: b.id, key })
      return `[${quotes.length}]${q}`
    })
    if (text && text.length + marked.length > PART) {
      parts.push({ text, before: parts.length ? plain.slice(-CONTEXT) : '' })
      plain = text.replace(/\[\d+\]/g, '')
      text = ''
    }
    text += (text ? '\n\n' : '') + marked
  }
  if (text) parts.push({ text, before: parts.length ? plain.slice(-CONTEXT) : '' })
  return { parts: parts.filter((p) => /\[\d+\]/.test(p.text)), quotes }
}

/** The reply as number → speaker; anything unreadable is left out. */
export function parseLabels(reply: string): Record<string, string> {
  return parseNumbered(reply, 60)
}

/** A reply that maps numbers to strings, each cut to `max` characters; anything unreadable is left out. */
export function parseNumbered(reply: string, max: number): Record<string, string> {
  const body = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([k, v]) => /^\d+$/.test(k.trim()) && typeof v === 'string' && v.trim())
        .map(([k, v]) => [k.trim(), (v as string).trim().slice(0, max)])
    )
  } catch {
    return {}
  }
}

/**
 * The quotes and sentences of narration in a paragraph reading aloud has no note for: a quote with nothing kept on
 * how it is said or on who says it (unless it is marked as nobody's words), and every sentence of narration none of
 * which has a note. A note left empty, or a speaker kept as unknown, counts as one: it was asked about.
 */
export function unmarkedIn(text: string, speakers?: Record<string, string>, delivery?: Record<string, LineDelivery>): Span[] {
  const spans = spansIn(text)
  const has = (x: Span): boolean => savedFor(delivery, text.slice(x.at, x.end), !x.quote) !== undefined
  const told = spans.some((x) => !x.quote && has(x))
  return spans.filter((x) => {
    if (!x.quote) return !told
    const who = savedFor(speakers, text.slice(x.at, x.end))
    return who !== NARRATOR && (!has(x) || who === undefined)
  })
}

/** One line in a part sent to be marked: the paragraph it is in, and the key its note is kept under. */
interface Ask {
  blockId: string
  key: string
  quote: boolean
  /** A quote whose speaker is known already: asked about how it is said for the second time. */
  again?: boolean
}

/** Part of a scene to mark: its paragraphs as sent, a number before each line that needs a note, and the text before it. */
export interface MarkPart {
  blockIds: string[]
  text: string
  before: string
  asks: Ask[]
}

/** Characters per part: about a minute of reading, noted in one quick call. */
export const MARK_PART = 3000
/** The part a reading starts in: small, so its notes come back while the first clip plays. */
export const MARK_FIRST = 1200

/**
 * The paragraphs among `ids` that need notes, and the ones between them, in parts from the first that needs one,
 * each with the scene's text before it for context. `busy`: paragraphs being marked already, left out. `first`:
 * the size of the first part; `size`: of the rest.
 */
export function markParts(blocks: Para[], ids: string[], busy: Set<string> = new Set(), first = MARK_FIRST, size = MARK_PART): MarkPart[] {
  const run = new Set(ids)
  const parts: MarkPart[] = []
  let plain = ''
  let part: (MarkPart & { kept: number }) | null = null
  // A part ends with its last paragraph that needs notes: the ones after it would only be read, not marked.
  const close = (p: MarkPart & { kept: number }): void => {
    if (p.asks.length) parts.push({ blockIds: p.blockIds, text: p.text.slice(0, p.kept), before: p.before, asks: p.asks })
  }
  for (const b of blocks) {
    if (!b.text.trim()) continue
    const spans = run.has(b.id) && !busy.has(b.id) ? unmarkedIn(b.text, b.speakers, b.delivery) : []
    // A part ends where the run does, and when it is full.
    if (part && (!run.has(b.id) || part.text.length + b.text.length > (parts.length ? size : first))) {
      close(part)
      part = null
    }
    if (spans.length || (part && run.has(b.id))) {
      part ??= { blockIds: [], text: '', before: plain.slice(-CONTEXT), asks: [], kept: 0 }
      let text = b.text
      for (let k = spans.length - 1; k >= 0; k--)
        text = `${text.slice(0, spans[k].at)}[${part.asks.length + k + 1}]${text.slice(spans[k].at)}`
      part.asks.push(
        ...spans.map((x) => ({
          blockId: b.id,
          key: x.key,
          quote: x.quote,
          ...(x.quote && b.speakers?.[x.key] !== undefined ? { again: true } : {})
        }))
      )
      part.text += (part.text ? '\n\n' : '') + text
      if (spans.length) {
        part.blockIds.push(b.id)
        part.kept = part.text.length
      }
    }
    plain += (plain ? '\n\n' : '') + b.text
  }
  if (part) close(part)
  return parts
}

const SOUND_NAMES = BREEZE_TAGS.map((t) => t.slice(1, -1)).join(', ')

/** How a line of dialogue is said, as the marker and the writer (ai/speakerTags.ts) are both told to note it. */
export const HOW_NOTE =
  'a note to the voice actor, under 15 words: the feeling and how strong it is, the intent behind it, and what the listener hears when the feeling changes the voice (loud or hushed, breathy, trembling, cracking, thick with tears, a smile in it, through clenched teeth). Fit each line to its moment, so the lines of a scene do not all sound alike. Never describe the voice itself (no age, gender or accent): it is fixed.'

/** How the narrator reads, as the marker and the writer are both told to note it. */
export const MOOD_NOTE =
  'The narrator performs the telling as a good audiobook narrator does, following the scene closely: tense and quick in a chase, soft and aching in grief, dry in a joke, low and slow in a tender moment, savouring or urgent and rising as it goes. Say how it sounds as well as the mood (low and hushed, a catch in the voice, a smile in it, breathless).'

/** Instructions for "Mark who says what": who says each line and how, and how the narration is read. */
export const MARK_PROMPT = (cast: CastMember[], pov?: string): string => `${MARKER} marks
You mark a passage of a novel for its audiobook, read by an expressive text-to-speech voice that follows a short note on how each line is said. Each line that needs a note has a number in square brackets just before it: a quoted line of dialogue, like [3]“Get out.”, or a sentence of narration, like [4]He turned back to the window.

Characters in this story:
${castLines(cast)}${hereNote(cast)}${pov ? `\nThe story is told by ${pov}: lines the narrator says aloud are ${pov}'s.` : ''}

Reply with only a JSON object from each number to its note, like {"1": "${cast[0]?.name ?? 'Mara'} | coldly, barely above a whisper, daring him to argue | slow | sigh", "2": "hushed, dread building | slow"}.

A line of dialogue: who says it | how it is said | pace | sound.
- Who: a listed character's name exactly as written above; someone not listed, a few plain words (the guard). Work it out as a careful reader would: the dialogue tag and the action beside the line, who "he" or "she" is at that point, who is being answered, and whose turn it is in a back-and-forth. A quote nobody says aloud (a sign, a title, a word being talked about): ${NARRATOR}.
- How: ${HOW_NOTE} Read it from the dialogue tag, what the speaker is doing, and what has happened in the scene so far.
- Pace, only when it is not ordinary: slow or fast.
- Sound, only when the speaker makes one as the line starts: crying, laughing, a gasp, a sigh, a breath before something hard to say.
Every number gets a note, in order: never skip a number or renumber.

A sentence of narration: how the narrator reads it | pace | sound.
- ${MOOD_NOTE}
- Where the mood carries on from the sentence before, or the sentence only says who spoke (she said), the note is just: same
- A sound, where the sentence has the narrator's subject make one: an inhale as they breathe something in, a sigh, gasp or exhale where it happens.

Sounds: ${SOUND_NAMES}.`

/** What a part's notes say for one paragraph: speakers and deliveries by key. */
export interface BlockMarks {
  speakers: Record<string, string>
  delivery: Record<string, LineDelivery>
}

/** A narration note that only says the mood carries on. */
const SAME = /^(?:same|same as before|as before|unchanged|carries on|continue[sd]?|-+)$/i

/**
 * A speaker that is really a note on how a line is said ("hushed, dread building"): what a reply gives when its
 * numbers have slipped. Never a cast member's name.
 */
export function looksLikeNote(who: string, cast: CastMember[] = []): boolean {
  if (!who || memberNamed(cast, who)) return false
  return who.includes(',') || who.split(/\s+/).length > 5
}

/** A narration note that is really a line of dialogue's ("Adam, shaky, ..."): it starts with a cast member's name. */
export function startsWithSpeaker(tone: string | undefined, cast: CastMember[], pov?: string): boolean {
  const first = (tone ?? '').split(/\s*[,|]\s*/)[0]?.trim() ?? ''
  if (!first) return false
  return !!memberNamed(cast, first) || (!!pov && first.toLowerCase() === pov.toLowerCase())
}

/**
 * The notes of a reply, by paragraph. A quote skipped, or said by nobody, gets an empty note (and an unknown
 * speaker when none was named), and so does the first sentence of narration a paragraph got no note for, so
 * neither is asked about again. A note that has slipped onto the wrong line (a model that skipped or renumbered:
 * a quote "said by" a mood, narration "said by" a character) is left out, and the rules decide who speaks.
 */
export function marksFrom(part: MarkPart, said: Record<string, string>, pov?: string, cast: CastMember[] = []): Map<string, BlockMarks> {
  const out = new Map<string, BlockMarks>()
  const of = (id: string): BlockMarks => out.get(id) ?? out.set(id, { speakers: {}, delivery: {} }).get(id)!
  const told = new Set<string>()
  // The last narration note so far: "same" carries it on (its tone and pace; a sound happens once).
  let last: LineDelivery | undefined
  part.asks.forEach((a, i) => {
    const raw = said[String(i + 1)]?.trim() ?? ''
    const m = of(a.blockId)
    if (a.quote) {
      const { who, how } = readMark(raw)
      if (looksLikeNote(who, cast)) {
        m.speakers[a.key] = UNKNOWN
        m.delivery[a.key] = {}
        return
      }
      const name = who === NARRATION ? NARRATOR : pov && /^(?:i|me|myself)$/i.test(who) ? pov : who
      m.speakers[a.key] = name || UNKNOWN
      // A line given a speaker but no note on how it is said is asked about once more.
      if (how && name !== NARRATOR) m.delivery[a.key] = how
      else if (!name || name === NARRATOR || a.again) m.delivery[a.key] = {}
      return
    }
    if (SAME.test(raw.replace(/[."']/g, '').trim())) {
      if (!last || told.has(a.blockId)) return
      m.delivery[a.key] = { ...last }
      told.add(a.blockId)
      return
    }
    const { how } = readMark(/^\s*(?:the )?narrat(?:ion|or)\s*(?:\||$)/i.test(raw) ? raw : `narration | ${raw}`)
    if (!how || startsWithSpeaker(raw, cast, pov)) return
    m.delivery[a.key] = how
    told.add(a.blockId)
    last = { ...(how.tone ? { tone: how.tone } : {}), ...(how.pace ? { pace: how.pace } : {}) }
  })
  for (const a of part.asks) {
    if (a.quote || told.has(a.blockId)) continue
    of(a.blockId).delivery[a.key] = {}
    told.add(a.blockId)
  }
  return out
}

/**
 * The paragraph with a part's notes kept, only on quotes and sentences it still has and only where nothing is kept
 * yet: speakers already known stay (a "?" is replaced).
 */
export function withMarks<B extends Para>(block: B, got: BlockMarks): B {
  const keys = new Set(spansIn(block.text).map((x) => x.key))
  const delivery = { ...(block.delivery ?? {}) }
  for (const [k, v] of Object.entries(got.delivery)) if (keys.has(k) && !(k in delivery)) delivery[k] = v
  const out = Object.keys(got.speakers).length ? withLabels(block, got.speakers) : block
  return { ...out, delivery }
}
