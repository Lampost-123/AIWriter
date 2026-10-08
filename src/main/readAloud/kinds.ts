// The director's rules half (director.ts): what a line is (a thought, a text message, a chat line, a
// letter, a sign) and whose it is, where the page says so plainly, with no AI call. The director (director.ts) is
// asked about the rest, and its marks win over these where both speak; the writer's own tags come before either.
//
// The rules (each tested in kinds.test.ts):
// - A thought: words in italics with a thinking verb beside them ("*Not again,* she thought"), or a whole sentence in
//   italics standing alone; a quote tagged with a thinking verb. Whose: the name in the tag, "I" for the one telling
//   the story in the first person, else the one character the paragraph (or the one before it) names.
// - A message: a quote tagged with a writing verb ("she texted", "he typed", "Mara messaged"); a line written as
//   `Name: words` (a chat line) when the name is a character's, or the paragraph has two or more such lines.
// - A letter: a quoted passage set apart on the page (a blockquote), or a paragraph opening "Dear ...,", up to its
//   sign-off ("Love, Mara", "— Mara"). Whose: the name it is signed with, else the one the narration before names.
// - A sign: a quote beside a sign, a screen or a label that "reads" or "says", or a quote in capitals. Nobody's.
// Pure, so it is tested on its own.
import type { ReadParagraph } from '@shared/contracts/readAloud'
import { memberNamed, namedIn, type CastMember, type SceneCast } from './cast'
import { NARRATOR, spansIn, type Span } from './speakers'
import type { LineKind, ParagraphMarks } from './types'

/** A paragraph as the rules read it: with whether it is set apart on the page (a blockquote). */
export interface KindParagraph extends ReadParagraph {
  block?: 'quote'
}

const THINK = String.raw`(?:thought|thinks|think|wondered|wonders|wondering|told (?:herself|himself|myself|themselves)|reminded (?:herself|himself|myself)|prayed silently)`
const WRITE = String.raw`(?:texted|texts|typed|types|messaged|messages|wrote back|wrote|writes|emailed|emails|replied by text|sent back|sent)`
const SIGN_WORDS = String.raw`(?:sign|signs|placard|banner|screen|display|label|notice|poster|headline|plaque|board|caption|message on the screen)`
const THINK_RE = new RegExp(String.raw`(?<![\p{L}])${THINK}(?![\p{L}])`, 'iu')
const WRITE_RE = new RegExp(String.raw`(?<![\p{L}])${WRITE}(?![\p{L}])`, 'iu')
const SIGN_RE = new RegExp(String.raw`(?<![\p{L}])${SIGN_WORDS}(?![\p{L}])[^.!?"“”]{0,20}(?<![\p{L}])(?:read|reads|said|says|announced|declared)(?![\p{L}])|(?<![\p{L}])(?:read|reads|said|says)(?![\p{L}])[^.!?"“”]{0,10}(?:the |a )?${SIGN_WORDS}(?![\p{L}])`, 'iu')
/** "Dear Tomas," opening a letter. */
const DEAR = /^\s*(?:my )?(?:dear(?:est)?|to my|hi|hello)\s+[\p{L}][\p{L} .'’-]{0,40},/iu
/** A sign-off: "Love, Mara", "Yours, Mara", "— Mara". */
const SIGN_OFF_WORDS =
  /^\s*(?:(?:all my |with )?(?:love|yours(?: truly| always| ever)?|always|sincerely|regards|best|forever|your (?:friend|sister|brother|mother|father|son|daughter)|xo+)[,.!]?\s+|[—–-]+\s*)(.+)$/i
const SIGNED_NAME = /^([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?)\s*[.!x]*\s*$/u
/** The name a line signs off with ("Love, Mara" is Mara), or undefined. */
const signOff = (line: string): string | undefined => {
  const rest = SIGN_OFF_WORDS.exec(line)?.[1]
  return rest ? SIGNED_NAME.exec(rest)?.[1] : undefined
}
/** A phone or a screen showing something just came in. */
const PHONE_RE = /\b(?:buzz\w*|ping(?:ed)?|lit up|vibrat\w*|notification|chimed|a (?:new )?(?:text|message)|(?:text|message|email) from)\b/i
/** "A text from Priya": who sent the message that came in. */
const FROM_RE = /\b(?:text|message|email|note|reply) from\s+(.{1,40})/i
/** A quote read out: "he read", "she read aloud". */
const READ_RE = /(?<![\p{L}])(?:read|reads)(?: (?:it )?(?:aloud|out))?(?![\p{L}])/iu
/** Paragraphs a letter that isn't set apart on the page runs to, looking for its sign-off. */
const LETTER_MAX = 8
/** "Mara: on my way" (a chat line, or a message written out). */
const NAME_LINE = /^\s*([\p{Lu}][\p{L}'’-]*(?:\s+[\p{Lu}][\p{L}'’-]*){0,2})\s*:\s+\S/u

/** The text around a quote that tags it: the rest of its sentence after it, and the start of the sentence before. */
function tagsOf(text: string, at: number, end: number): { after: string; before: string } {
  const after = text.slice(end, end + 60)
  const lead = text.slice(Math.max(0, at - 80), at)
  const cut = Math.max(lead.lastIndexOf('.'), lead.lastIndexOf('!'), lead.lastIndexOf('?'), lead.lastIndexOf('”'))
  return { after: after.split(/[.!?…“"]/)[0] ?? '', before: cut >= 0 ? lead.slice(cut + 1) : lead }
}

/** Whose words a tag gives: the one character it names, "I" for the viewpoint character, else null. */
function ownerOfTag(tag: string, cast: SceneCast): CastMember | null {
  const named = cast.all.filter((c) => namedIn(c, tag))
  if (named.length === 1) return named[0]!
  if (cast.pov && /(?<![\p{L}])I(?![\p{L}])/u.test(tag)) return cast.pov
  return null
}

/** The one character of the scene a paragraph's narration names, or null. */
function onlyNamed(text: string, cast: SceneCast): CastMember | null {
  const narration = text.replace(/["“][^"”]*["”]/g, ' ')
  const named = cast.scene.filter((c) => namedIn(c, narration))
  return named.length === 1 ? named[0]! : null
}

/** How much of a span's letters are in italics, 0 to 1. */
function italicShare(text: string, span: Span, italics: readonly [number, number][]): number {
  let total = 0
  let inItalics = 0
  for (let i = span.at; i < span.end; i++) {
    if (!/[\p{L}\p{N}]/u.test(text[i]!)) continue
    total++
    if (italics.some(([a, b]) => i >= a && i < b)) inItalics++
  }
  return total ? inItalics / total : 0
}

/** A name a chat line or a letter is signed with, as a cast member's name or the words themselves. */
const nameFor = (name: string, cast: SceneCast): string => memberNamed(cast.all, name)?.name ?? name

/**
 * What each line of these paragraphs is, and whose, where the rules can tell: by paragraph id, marks with `kinds`,
 * `voiced` (a sentence of narration a character owns) and `speakers` (a quote that is a thought, a message, a letter
 * or a sign). Never notes on how a line is said: those stay the AI's to make.
 */
export function ruleKinds(paragraphs: readonly KindParagraph[], cast: SceneCast): Map<string, ParagraphMarks> {
  const out = new Map<string, ParagraphMarks>()
  const marksOf = (pid: string): Required<Pick<ParagraphMarks, 'kinds' | 'voiced' | 'speakers'>> => {
    const m = out.get(pid) ?? out.set(pid, { kinds: {}, voiced: {}, speakers: {} }).get(pid)!
    return m as Required<Pick<ParagraphMarks, 'kinds' | 'voiced' | 'speakers'>>
  }
  /** The letter being read, across paragraphs: who it is from (once known), its paragraphs, and whether it is set apart. */
  let letter: { pids: string[]; owner: string | null; set: boolean; signed: boolean } | null = null
  /** The paragraphs a letter read so far has: all of them, or only its "Dear ...," one when it was never signed. */
  const flush = (): void => {
    const l = letter
    letter = null
    if (!l?.owner) return
    const pids = l.set || l.signed ? l.pids : l.pids.slice(0, 1)
    for (const pid of pids) {
      const p = paragraphs.find((x) => x.pid === pid)!
      const m = marksOf(pid)
      for (const s of spansIn(p.text)) {
        m.kinds[s.key] = 'letter'
        if (s.quote) m.speakers[s.key] = l.owner
        else m.voiced[s.key] = l.owner
      }
    }
  }
  /** The character the narration last named on their own: who "he" or "she" most likely is. */
  let lastNamed: CastMember | null = null
  const noteNamed = (text: string): void => {
    const narration = text.replace(/["“][^"”]*["”]/g, ' ')
    const named = cast.scene.filter((c) => namedIn(c, narration))
    if (named.length === 1) lastNamed = named[0]!
    else if (named.length > 1) lastNamed = null
  }
  paragraphs.forEach((p, i) => {
    try {
      readParagraph(p, i)
    } finally {
      noteNamed(p.text)
    }
  })
  function readParagraph(p: KindParagraph, i: number): void {
    const text = p.text
    const spans = spansIn(text)
    const before = i > 0 ? paragraphs[i - 1]!.text : ''
    // A letter: a passage set apart on the page, or from "Dear ...," to its sign-off (a few paragraphs at most).
    const set = p.block === 'quote'
    if (letter && (letter.set ? !set : set || letter.pids.length >= LETTER_MAX)) flush()
    if (!letter && (set || DEAR.test(text))) {
      // Whose: the one character the narration before it names ("a letter from Mara", "Mara had written").
      const from = /letter|note|wrote|written|card|diary|journal|postcard|envelope|read/i.test(before) ? onlyNamed(before, cast) : null
      letter = { pids: [], owner: from?.name ?? null, set, signed: false }
    }
    if (letter) {
      letter.pids.push(p.pid)
      const signed = text
        .split('\n')
        .map(signOff)
        .find(Boolean)
      if (signed) {
        letter.owner = nameFor(signed, cast)
        letter.signed = true
        flush()
      }
      return
    }

    const m = (): ReturnType<typeof marksOf> => marksOf(p.pid)
    const subject = (): CastMember | null =>
      onlyNamed(text, cast) ?? (cast.pov && /(?<![\p{L}])I(?![\p{L}])/u.test(text) ? cast.pov : null) ?? lastNamed
    const chatLines = text.split('\n').filter((l) => NAME_LINE.test(l)).length
    // A message shown in italics on its own after the phone buzzes ("sorry, phone died"), or after someone types one:
    // the one who typed it wrote it; a message that came in is from someone the page doesn't say.
    const allItalic = spans.length > 0 && spans.every((x) => !x.quote && italicShare(text, x, p.italics ?? []) >= 0.8)
    if (allItalic && (WRITE_RE.test(before) || PHONE_RE.test(before))) {
      const from = FROM_RE.exec(before)?.[1]
      const sender = from ? cast.all.find((c) => namedIn(c, from)) : undefined
      const typed =
        sender ??
        (WRITE_RE.test(before) ? (ownerOfTag(before, cast) ?? (/^\s*(?:he|she|they|I)\b/i.test(before) ? lastNamed : null)) : null)
      for (const x of spans) {
        m().kinds[x.key] = 'text_message'
        if (typed) m().voiced[x.key] = typed.name
      }
      return
    }
    for (const s of spans) {
      const words = text.slice(s.at, s.end)
      if (s.quote) {
        const { after, before: lead } = tagsOf(text, s.at, s.end)
        const tag = `${lead} ${after}`
        const inner = words.replace(/["“”]/g, '')
        if (SIGN_RE.test(tag) || (/\p{Lu}{2}/u.test(inner) && !/\p{Ll}/u.test(inner))) {
          m().kinds[s.key] = 'sign'
          m().speakers[s.key] = NARRATOR
          continue
        }
        // "“Dear valued colleague,” he read": a letter or notice read out loud, said by its reader.
        const kind: LineKind | null = THINK_RE.test(tag) ? 'thought' : WRITE_RE.test(tag) ? 'text_message' : READ_RE.test(tag) ? 'speech' : null
        if (!kind) continue
        m().kinds[s.key] = kind
        const who = ownerOfTag(tag, cast) ?? subject()
        if (who) m().speakers[s.key] = who.name
        continue
      }
      // A chat line: "Mara: on my way".
      const line = NAME_LINE.exec(words)
      if (line) {
        const member = memberNamed(cast.all, line[1])
        if (member || chatLines >= 2) {
          m().kinds[s.key] = WRITE_RE.test(before) || /\b(?:phone|screen|text|message)s?\b/i.test(before) ? 'text_message' : 'chat'
          m().voiced[s.key] = member?.name ?? line[1]!.trim()
          continue
        }
      }
      // A thought: italics with a thinking verb in the sentence, or a whole sentence in italics on its own.
      const share = italicShare(text, s, p.italics ?? [])
      const tagged = share > 0 && THINK_RE.test(words)
      const alone = share >= 0.8
      if (tagged || alone) {
        const who = (tagged ? ownerOfTag(words, cast) : null) ?? subject()
        m().kinds[s.key] = 'thought'
        if (who) m().voiced[s.key] = who.name
      }
    }
  }
  flush()
  // Paragraphs given nothing are left out, and empty fields too.
  for (const [pid, m] of out) {
    const clean: ParagraphMarks = {}
    if (m.kinds && Object.keys(m.kinds).length) clean.kinds = m.kinds
    if (m.voiced && Object.keys(m.voiced).length) clean.voiced = m.voiced
    if (m.speakers && Object.keys(m.speakers).length) clean.speakers = m.speakers
    if (Object.keys(clean).length) out.set(pid, clean)
    else out.delete(pid)
  }
  return out
}

/**
 * Marks with the rules' kinds filling what they lack: what is kept (the writer's tags, the AI's marks) comes first.
 * A paragraph the rules said nothing of is unchanged.
 */
export function withRuleKinds(kept: ReadonlyMap<string, ParagraphMarks>, rules: ReadonlyMap<string, ParagraphMarks>): Map<string, ParagraphMarks> {
  const out = new Map(kept)
  for (const [pid, r] of rules) {
    const had = kept.get(pid) ?? {}
    const fill = <T>(a: Record<string, T> | undefined, b: Record<string, T> | undefined): Record<string, T> | undefined => {
      const merged = { ...(b ?? {}), ...(a ?? {}) }
      return Object.keys(merged).length ? merged : undefined
    }
    // A quote the AI already gave a speaker keeps it; a sentence it gave a kind keeps it and its owner.
    const kinds = fill(had.kinds, r.kinds)
    const voicedRules = Object.fromEntries(Object.entries(r.voiced ?? {}).filter(([k]) => !had.kinds?.[k] || had.voiced?.[k]))
    const voiced = fill(had.voiced, voicedRules)
    const speakers = fill(had.speakers, r.speakers)
    out.set(pid, { ...had, ...(speakers ? { speakers } : {}), ...(kinds ? { kinds } : {}), ...(voiced ? { voiced } : {}) })
  }
  return out
}
