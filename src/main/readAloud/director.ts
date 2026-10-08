// Adapted from mcreader-v2, src/lib/speech/script.ts (DIRECT_PROMPT, contextBlock, numberWindow, windowsOf,
// parseDirection, marksOfScript) and src/server/speech/director.ts (its windows and state) (reading aloud's own
// text-to-speech code; Adam's rule, 2 October 2026).
//
// The director: one AI call over a stretch of a scene that decides, for every line, what it is (spoken aloud, a
// thought, a text message, a chat line, a letter, a sign, narration), whose it is, the feeling and how strongly, and a
// short note for the voice. A character's thoughts, messages and letters are theirs: read in their voice (`voiced`),
// not the narrator's. Signs and words nobody owns stay the narrator's. It reads in order, a window at a time, carrying
// what it knows (who is here, who tells the story, people met) from one window to the next.
//
// Pure: the prompt, the numbering and the reading of the reply. The call is the Marker's (marks.ts).
import { EMOTIONS, type Emotion } from './emotion'
import type { CastMember } from './cast'
import { BREEZE_TAGS } from './perform'
import { MARKER, NARRATOR, spansIn, type Para } from './speakers'
import { LINE_KINDS, type LineDelivery, type LineKind, type ParagraphMarks } from './types'

export const PAUSES = ['none', 'short', 'beat', 'long'] as const
export type Pause = (typeof PAUSES)[number]

/** One line as the director reads it. `who`: a cast member's name, "narrator", or "new:<label>" for someone else. */
export interface ScriptLine {
  kind: LineKind
  who: string
  emotion: Emotion
  intensity: 1 | 2 | 3
  note: string
  pace?: 'lively' | 'fast'
  pause?: Pause
  sound?: string
  unsure?: boolean
}

export interface Person {
  label: string
  gender?: 'male' | 'female'
  age?: string
  about?: string
}

/** What the director carries from one window to the next. */
export interface ScriptState {
  present: string[]
  lastSpeakers: string[]
  mood?: { emotion: Emotion; intensity: 1 | 2 | 3 }
  pov?: string | null
  newPeople: Person[]
}

export const EMPTY_STATE: ScriptState = { present: [], lastSpeakers: [], newPeople: [] }

/** Words a line is, that a character owns: read in their voice when the director names them. */
export const OWNED: ReadonlySet<LineKind> = new Set(['speech', 'thought', 'text_message', 'chat', 'letter'])
/** Written or thought, not said aloud: the kinds read as narration today. */
export const UNSPOKEN: ReadonlySet<LineKind> = new Set(['thought', 'text_message', 'chat', 'letter'])

const SOUNDS = BREEZE_TAGS.map((t) => t.slice(1, -1)).filter((t) => !['whisper', 'shout', 'sing', 'pause', 'stutter'].includes(t))

const castLine = (c: CastMember): string => {
  const also = c.names.filter((n) => n !== c.name)
  return `- ${c.name}${also.length ? ` (also called ${also.map((a) => `"${a}"`).join(', ')})` : ''}${c.here ? ' [in this scene]' : ''}${c.about ? `: ${c.about.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`
}

/** The director's instructions. `pov`: who tells the story, when it is told in the first person. */
export const DIRECT_PROMPT = (cast: CastMember[], pov?: string): string => `${MARKER} director
You are the director of a full-cast audiobook. A passage of a novel follows, with a number in square brackets before each line: each quoted line of dialogue, and each sentence of narration. For each line you decide what it is, whose words they are, and how it is performed, so the right voice actor reads it the right way.

Characters (write their names exactly as here):
${cast.map(castLine).join('\n') || '- (none listed)'}${pov ? `\nThe story is told in the first person by ${pov}: the narrator's own dialogue ("I said"), thoughts and messages are ${pov}'s.` : ''}

Reply with one JSON object and nothing else:
{"lines": {"<number>": {"kind": ..., "who": ..., "emotion": ..., "intensity": ..., "note": ..., "pace": ..., "pause": ..., "sound": ..., "unsure": true}}, "state": {...}}
Leave out any field that is not needed ("pace", "pause", "sound", "unsure" usually are not). A narration entry is only {"kind": "narration", "emotion": ..., "note": ...}: no "who" or "intensity".

For each line:
- "kind": "speech" (said aloud), "thought" (a character's unspoken thought: often in *italics*, or with "she thought", "he wondered"), "text_message" (a text, an email, a DM or a note shown as written; "she texted", "he typed"), "chat" (a line of a chat or group thread written as Name: words), "letter" (a letter, a diary entry or a written note shown in the text, often set apart as a block), "sign" (words on a sign, a screen, a title, a word being talked about: nobody's words), or "narration".
  A letter, note, notice or message that someone in the scene reads out loud ("he read", "she read it aloud") is "speech", and its "who" is the one reading it, whoever wrote it.
- "who": whose words they are. A listed character's name exactly as written above. Someone not listed: "new:" and a short label, like "new:the guard", always the same label for the same person. Narration and signs: "narrator". A thought, message, chat line or letter is the character who thinks or wrote it, even when it is not in quotes.
  Work out the speaker as a careful reader would: the dialogue tag; the character whose action is in the same paragraph as the line (the one acting, not the one acted on or spoken to); who "he" or "she" must be from who is present; who is being answered; whose turn it is. A paragraph usually holds one speaker, but not always: look for a second tag. A quotation that runs over several paragraphs is the same speaker going on. In a conversation of three or more, never assume the turns simply alternate.
- "emotion": one of ${EMOTIONS.join(', ')}. For narration, the mood of the telling at that point. When the words, the tag or the action show a feeling (anger, fear, warmth, grief, teasing), name that feeling rather than neutral; neutral is for lines that truly carry none.
- "intensity": 1 (a hint of it), 2 (clear), 3 (strong: shouting, sobbing, terror). Match the strength the text shows; don't play it down.
- "note": a direction to the actor, under 12 words: the feeling and what it does to the voice (hushed, clipped, a smile in it, breaking, through clenched teeth, breathless). Never describe the voice itself (age, gender, accent): it is fixed. Never ask for slow or drawn-out delivery.
- "pace": only "lively" or "fast", only when the line is hurried.
- "pause": "beat" or "long" only when the moment needs silence after the line.
- "sound": only when the speaker audibly makes one as the line starts: one of ${SOUNDS.join(', ')}.
- "unsure": true when you could not tell whose words they are.
Every quoted line, thought, message, chat line and letter line must have an entry. For other narration, give an entry only for the passage's first sentence and wherever the mood of the telling turns; every sentence with no entry is read like the one before it, across paragraphs. A sentence that only says who spoke ("she said") never needs one.

"state" describes the end of the passage, for the next passage: {"present": [names in the scene], "lastSpeakers": [the last two who spoke, latest first], "mood": {"emotion": ..., "intensity": ...}, "pov": name of the first-person narrator or null, "newPeople": [{"label": "new:the guard", "gender": "male", "age": "adult", "about": "a few words"}]}.`

/** Where a window starts: what came before it, as context, and what the window before it ended on. */
export function contextBlock(state: ScriptState, before: string): string {
  const parts: string[] = []
  if (state.present.length || state.pov || state.newPeople.length || state.mood) parts.push(`So far: ${JSON.stringify(state)}`)
  if (before) parts.push(`The passage just before, for context only (no numbers to answer):\n${before}`)
  return parts.length ? `${parts.join('\n\n')}\n\n---\n\n` : ''
}

export interface NumberedLine {
  n: number
  /** The paragraph's id. */
  pid: string
  key: string
  at: number
  end: number
  quote: boolean
}

/**
 * Paragraphs with a number before each line (quotes and sentences of narration, as `spansIn` splits them). A
 * paragraph set apart on the page (a blockquote) is shown with "> " before each of its lines.
 */
export function numberWindow(
  paragraphs: readonly { id: string; text: string; block?: 'quote'; italics?: [number, number][] }[],
  first = 1
): { text: string; lines: NumberedLine[] } {
  const lines: NumberedLine[] = []
  const out: string[] = []
  for (const p of paragraphs) {
    // What goes in between the words: a number before each line, and asterisks around the words in italics (a thought
    // is often only told apart by them). At one place, a closing asterisk comes first, then the number, then an opening one.
    const marks: { at: number; order: number; put: string }[] = []
    for (const span of spansIn(p.text)) {
      const n = first + lines.length
      lines.push({ n, pid: p.id, key: span.key, at: span.at, end: span.end, quote: span.quote })
      marks.push({ at: span.at, order: 1, put: `[${n}]` })
    }
    for (const [a, b] of p.italics ?? []) {
      if (b <= a || !/[\p{L}\p{N}]/u.test(p.text.slice(a, b))) continue
      marks.push({ at: a, order: 2, put: '*' }, { at: b, order: 0, put: '*' })
    }
    marks.sort((x, y) => x.at - y.at || x.order - y.order)
    let marked = ''
    let last = 0
    for (const m of marks) {
      marked += p.text.slice(last, m.at) + m.put
      last = m.at
    }
    // A passage set apart on the page (a letter, a sign) is shown so, as a quoted block.
    const whole = marked + p.text.slice(last)
    out.push(
      p.block === 'quote'
        ? whole
            .split('\n')
            .map((l) => `> ${l}`)
            .join('\n')
        : whole
    )
  }
  return { text: out.join('\n\n'), lines }
}

/** Paragraph ranges [from, to) of about `size` characters each, never splitting a paragraph. */
export function windowsOf(paragraphs: readonly { text: string }[], size: number): [number, number][] {
  const out: [number, number][] = []
  let start = 0
  let length = 0
  paragraphs.forEach((p, i) => {
    if (i > start && length + p.text.length > size) {
      out.push([start, i])
      start = i
      length = 0
    }
    length += p.text.length + 2
  })
  if (start < paragraphs.length) out.push([start, paragraphs.length])
  return out
}

/** Names a model may give a kind (MCreader's own, and near misses), as reading aloud's kinds. */
const KIND_ALIASES: Record<string, LineKind> = {
  dialogue: 'speech',
  spoken: 'speech',
  speech: 'speech',
  thought: 'thought',
  thinking: 'thought',
  message: 'text_message',
  text: 'text_message',
  text_message: 'text_message',
  textmessage: 'text_message',
  email: 'text_message',
  sms: 'text_message',
  chat: 'chat',
  letter: 'letter',
  note: 'letter',
  diary: 'letter',
  sign: 'sign',
  narration: 'narration'
}

const kindOf = (v: unknown): LineKind => {
  const k = typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s-]+/g, '_') : ''
  return KIND_ALIASES[k] ?? KIND_ALIASES[k.replace(/_/g, '')] ?? 'speech'
}
const emotionOf = (v: unknown): Emotion =>
  typeof v === 'string' && (EMOTIONS as readonly string[]).includes(v.trim().toLowerCase()) ? (v.trim().toLowerCase() as Emotion) : 'neutral'
const intensityOf = (v: unknown): 1 | 2 | 3 => {
  const n = Math.round(Number(v))
  return n === 1 || n === 3 ? n : 2
}
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export interface Direction {
  lines: Map<number, ScriptLine>
  state: ScriptState | null
  /** Entries that could not be read. */
  bad: number
}

/** A director's reply read: its lines by number and the state it ended on. Null when there is no JSON object in it. */
export function parseDirection(reply: string): Direction | null {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: unknown
  try {
    raw = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const body = raw as { lines?: unknown; state?: unknown }
  const lines = new Map<number, ScriptLine>()
  let bad = 0
  const entries = body.lines && typeof body.lines === 'object' ? Object.entries(body.lines as Record<string, unknown>) : []
  for (const [k, v] of entries) {
    const n = Number(k)
    const r0 = v && typeof v === 'object' ? (v as Record<string, unknown>) : null
    // Narration and signs need no "who": they are the narrator's.
    const who = r0 ? str(r0.who, 80) || (['narration', 'sign'].includes(kindOf(r0.kind)) && r0.kind != null ? NARRATOR : '') : ''
    if (!Number.isInteger(n) || n < 1 || !who) {
      bad++
      continue
    }
    const r = v as Record<string, unknown>
    const kind = kindOf(r.kind)
    const sound = str(r.sound, 30).toLowerCase().replace(/[()]/g, '').trim()
    const pace = r.pace === 'lively' || r.pace === 'fast' ? r.pace : undefined
    const pause = (PAUSES as readonly string[]).includes(String(r.pause)) && r.pause !== 'none' ? (r.pause as Pause) : undefined
    lines.set(n, {
      kind,
      who: kind === 'narration' || kind === 'sign' ? NARRATOR : who,
      emotion: emotionOf(r.emotion),
      intensity: intensityOf(r.intensity),
      note: str(r.note, 200),
      ...(pace ? { pace } : {}),
      ...(pause ? { pause } : {}),
      ...(sound && SOUNDS.includes(sound) ? { sound } : {}),
      ...(r.unsure === true ? { unsure: true } : {})
    })
  }
  return { lines, state: stateOf(body.state), bad }
}

function stateOf(v: unknown): ScriptState | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const names = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(0, 20) : [])
  const mood = r.mood && typeof r.mood === 'object' ? (r.mood as Record<string, unknown>) : null
  const people = Array.isArray(r.newPeople) ? r.newPeople : []
  return {
    present: names(r.present),
    lastSpeakers: names(r.lastSpeakers),
    ...(mood ? { mood: { emotion: emotionOf(mood.emotion), intensity: intensityOf(mood.intensity) } } : {}),
    pov: typeof r.pov === 'string' && r.pov.trim() ? r.pov.trim() : null,
    newPeople: people.flatMap((p): Person[] => {
      const x = (p ?? {}) as Record<string, unknown>
      const label = str(x.label, 80)
      if (!label) return []
      const gender = x.gender === 'male' || x.gender === 'female' ? x.gender : undefined
      return [{ label, ...(gender ? { gender } : {}), ...(str(x.age, 20) ? { age: str(x.age, 20) } : {}), ...(str(x.about, 200) ? { about: str(x.about, 200) } : {}) }]
    })
  }
}

/** A label the director gave someone not in the cast, without its "new:". */
export const newLabel = (who: string): string | null => (who.startsWith('new:') ? who.slice(4).trim() || null : null)

/** How a director's line is said, as a mark (MCreader never asks for slow: Breeze drags). */
function deliveryOf(line: ScriptLine): LineDelivery {
  return {
    ...(line.note ? { tone: line.note } : {}),
    ...(line.pace ? { pace: 'fast' as const } : {}),
    ...(line.sound ? { sound: `(${line.sound})` } : {}),
    feeling: line.emotion,
    intensity: line.intensity,
    by: 'director'
  }
}

/**
 * A paragraph's script as reading aloud's marks: each quote's speaker and note, each noted sentence of narration's
 * note, what each line is, and the thoughts, messages and letters a character voices. A quote nobody says aloud (a
 * sign) is the narrator's. A paragraph whose narration got no note gets an empty one, so it isn't asked about again.
 * `pov`: a first-person narrator's own "narrator" lines that are thoughts or messages are theirs.
 */
export function marksOfScript(text: string, lines: Record<string, ScriptLine> | undefined, pov?: string): ParagraphMarks {
  const speakers: Record<string, string> = {}
  const delivery: Record<string, LineDelivery> = {}
  const voiced: Record<string, string> = {}
  const kinds: Record<string, LineKind> = {}
  const spans = spansIn(text)
  for (const span of spans) {
    const line = lines?.[span.key]
    if (!line) continue
    let who = newLabel(line.who) ?? line.who
    if (who === NARRATOR && pov && UNSPOKEN.has(line.kind)) who = pov
    kinds[span.key] = line.kind
    if (span.quote) {
      const nobody = line.kind === 'sign' || line.kind === 'narration' || who === NARRATOR
      speakers[span.key] = nobody ? NARRATOR : who
      delivery[span.key] = nobody ? {} : deliveryOf(line)
    } else {
      if (UNSPOKEN.has(line.kind) && who !== NARRATOR) voiced[span.key] = who
      delivery[span.key] = deliveryOf(line)
    }
  }
  const narration = spans.filter((s) => !s.quote)
  if (narration.length && !narration.some((s) => s.key in delivery)) delivery[narration[0].key] = {}
  return {
    ...(Object.keys(speakers).length ? { speakers } : {}),
    ...(Object.keys(delivery).length ? { delivery } : {}),
    ...(Object.keys(kinds).length ? { kinds } : {}),
    ...(Object.keys(voiced).length ? { voiced } : {})
  }
}

/**
 * The lines of a window's reply, by paragraph id and then line key. The director notes narration only where its mood
 * turns: a paragraph whose narration it gave no entry takes the mood the telling had before it (without its sound or
 * pause, which happen once), on its first sentence of narration, so the mood carries across paragraphs.
 */
export function linesByParagraph(numbered: NumberedLine[], got: Direction): Map<string, Record<string, ScriptLine>> {
  const out = new Map<string, Record<string, ScriptLine>>()
  let mood: ScriptLine | undefined
  let pid: string | undefined
  let told = false
  const carry = (): void => {
    if (pid === undefined || told || !mood) return
    const first = numbered.find((l) => l.pid === pid && !l.quote && !got.lines.has(l.n))
    if (!first) return
    const { sound: _sound, pause: _pause, ...still } = mood
    ;(out.get(pid) ?? out.set(pid, {}).get(pid)!)[first.key] = still
  }
  for (const l of numbered) {
    if (l.pid !== pid) {
      carry()
      pid = l.pid
      told = false
    }
    const line = got.lines.get(l.n)
    if (!line) continue
    if (!l.quote && line.kind === 'narration') {
      mood = line
      told = true
    }
    const of = out.get(l.pid) ?? out.set(l.pid, {}).get(l.pid)!
    of[l.key] = line
  }
  carry()
  return out
}

/**
 * A paragraph's marks with the director's laid over them where nothing is kept yet: the writer's own tags (and any
 * mark kept before) come first (the hybrid: the writer knows who it made say what), and the director fills the rest,
 * and says what each line is. A quote the writer gave a speaker keeps it, but a director's "sign" or a thought the
 * writer left untagged is the director's.
 */
export function withDirection<B extends Para>(block: B, got: ParagraphMarks): B & ParagraphMarks {
  const keys = new Set(spansIn(block.text).map((x) => x.key))
  const keep = <T>(had: Record<string, T> | undefined, add: Record<string, T> | undefined): Record<string, T> | undefined => {
    const out: Record<string, T> = { ...(had ?? {}) }
    for (const [k, v] of Object.entries(add ?? {})) if (keys.has(k) && (!(k in out) || (out[k] as unknown) === '?')) out[k] = v
    return Object.keys(out).length ? out : undefined
  }
  const speakers = keep(block.speakers, got.speakers)
  // A quote's note the writer gave stays, with the director's feeling and strength added to it.
  const delivery: Record<string, LineDelivery> = { ...(block.delivery ?? {}) }
  for (const [k, v] of Object.entries(got.delivery ?? {})) {
    if (!keys.has(k)) continue
    const had = delivery[k]
    // (Still the writer's note: Emotion and tone off reads its tone, not the director's feeling.)
    delivery[k] = had && Object.keys(had).length ? { ...v, ...had, by: had.by } : v
    if (delivery[k]!.by === undefined) delete delivery[k]!.by
  }
  const kinds = keep(block.kinds, got.kinds)
  const voiced = keep(block.voiced, got.voiced)
  return {
    ...block,
    ...(speakers ? { speakers } : {}),
    ...(Object.keys(delivery).length ? { delivery } : {}),
    ...(kinds ? { kinds } : {}),
    ...(voiced ? { voiced } : {})
  }
}

/**
 * A paragraph's marks with Emotion and tone off: the director's notes on how lines are said are left out (a line it
 * noted reads evenly), and so are the feeling and strength it added to the writer's own notes, which stay. Who says
 * each line and what it is stay too.
 */
export function withoutDirectorTone(m: ParagraphMarks): ParagraphMarks {
  if (!m.delivery) return m
  const delivery = Object.fromEntries(
    Object.entries(m.delivery).flatMap(([k, how]): [string, LineDelivery][] => {
      if (how.by === 'director') return []
      const { feeling: _feeling, intensity: _intensity, ...plain } = how
      return [[k, plain]]
    })
  )
  return { ...m, delivery }
}

/** True when a paragraph has been read by the director (any line has a kind): it isn't asked about again. */
export const directed = (m: ParagraphMarks | undefined): boolean => !!m?.kinds && Object.keys(m.kinds).length > 0

export { LINE_KINDS }
