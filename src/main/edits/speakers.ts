// Who says each line of dialogue, for Fix voice (milestone 4, "Editing with AI"). The rules are the
// spec's for reading aloud ("Who says each line, and how"): a speech tag naming a character ("said
// Mara"), the one character a paragraph names, the same speaker carrying on within a paragraph, and
// turn-taking in a two-person exchange. A tag with a pronoun ("she said") counts when only one of the
// people about fits it. The scene's cast narrows the choice: only its characters are looked for.
// Pure, so it can be tested.

import type { ID } from '@shared/types'
import { quoteSpans } from '@shared/contracts/edits'

/** A character who might be speaking. */
export interface Speaker {
  id: ID
  name: string
  aliases: string[]
  /** As the character's page has it ("she/her"); '' when it isn't filled in. */
  pronouns: string
}

/** How the speaker of a line was worked out. */
export type HowKnown = 'tag' | 'named' | 'carry' | 'turn' | 'pronoun'

export interface SpokenLine {
  /** The line as it is in the text, quotation marks included. */
  quote: string
  speakerId: ID | null
  how: HowKnown | null
}

/** Verbs that make a speech tag ("said Mara", "Mara whispered"). */
const VERBS = new Set(
  (
    'say says said ask asks asked reply replies replied answer answers answered whisper whispers whispered murmur murmurs murmured ' +
    'mutter mutters muttered shout shouts shouted yell yells yelled call calls called cry cries cried snap snaps snapped hiss hisses ' +
    'hissed growl growls growled add adds added continue continues continued tell tells told begin begins began insist insists ' +
    'insisted admit admits admitted agree agrees agreed laugh laughs laughed sigh sighs sighed breathe breathes breathed press ' +
    'presses pressed demand demands demanded warn warns warned offer offers offered repeat repeats repeated protest protests ' +
    'protested explain explains explained lie lied joke jokes joked retort retorts retorted bark barks barked croak croaks croaked ' +
    'grunt grunts grunted mumble mumbles mumbled snarl snarls snarled scoff scoffs scoffed tease teases teased promise promises ' +
    'promised whimper whimpers whimpered sob sobs sobbed chuckle chuckles chuckled gasp gasps gasped exclaim exclaims exclaimed ' +
    'interrupt interrupts interrupted correct corrects corrected concede concedes conceded counter counters countered observe ' +
    'observes observed remark remarks remarked suggest suggests suggested venture ventures ventured wonder wonders wondered ' +
    'declare declares declared announce announces announced spit spits spat drawl drawls drawled purr purrs purred rasp rasps ' +
    'rasped stammer stammers stammered stutter stutters stuttered blurt blurts blurted plead pleads pleaded pled beg begs begged ' +
    'groan groans groaned moan moans moaned shriek shrieks shrieked scream screams screamed roar roars roared boom booms boomed ' +
    'sneer sneers sneered smirk smirks smirked grin grins grinned smile smiles smiled nod nods nodded reason reasons reasoned ' +
    'object objects objected urge urges urged order orders ordered command commands commanded instruct instructs instructed ' +
    'prompt prompts prompted inquire inquires inquired enquire enquires enquired query queries queried note notes noted ' +
    'point points pointed state states stated confirm confirms confirmed manage manages managed finish finishes finished ' +
    'recall recalls recalled respond responds responded return returns returned shot'
  ).split(' ')
)

/** Pronouns a tag can use, and the pronouns field each fits. */
const PRONOUNS: Record<string, RegExp | null> = {
  she: /\b(she|her)\b/i,
  he: /\b(he|him)\b/i,
  they: /\b(they|them)\b/i,
  // First person: the point-of-view character.
  i: null,
  we: null
}

interface Word {
  text: string
  lower: string
  start: number
  end: number
}

const words = (text: string): Word[] =>
  [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)].map((m) => ({
    text: m[0],
    lower: m[0].toLowerCase(),
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length
  }))

const isAdverb = (w: Word | undefined): boolean => !!w && /ly$/.test(w.lower) && w.lower.length > 3

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

interface NameHit {
  id: ID
  start: number
  end: number
}

/** Each speaker's names: the name, its aliases, and a first name no one else here shares ("Mara" for "Mara Venn"). */
function nameList(cast: Speaker[]): { id: ID; name: string }[] {
  const firsts = new Map<string, ID[]>()
  for (const s of cast) {
    const first = s.name.trim().split(/\s+/)
    if (first.length > 1 && /^\p{Lu}/u.test(first[0]) && first[0].length >= 2) {
      firsts.set(first[0], [...(firsts.get(first[0]) ?? []), s.id])
    }
  }
  const out: { id: ID; name: string }[] = []
  for (const s of cast) {
    for (const n of [s.name, ...s.aliases]) if (n.trim().length >= 2) out.push({ id: s.id, name: n.trim() })
  }
  for (const [first, ids] of firsts) if (ids.length === 1 && !out.some((o) => o.name === first)) out.push({ id: ids[0], name: first })
  // Longer names first, so "Mara Venn" wins over "Mara" where both match.
  return out.sort((a, b) => b.name.length - a.name.length)
}

/**
 * Where the speakers' names appear in a text, as the memory reads names: a single capitalised word must
 * be capitalised there too ("Will", not "will"); phrases and lower-case aliases ignore case.
 */
function namesIn(text: string, names: { id: ID; name: string }[]): NameHit[] {
  const hits: NameHit[] = []
  for (const { id, name } of names) {
    const flags = /\s/.test(name) || !/^\p{Lu}/u.test(name) ? 'giu' : 'gu'
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, flags)
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0
      const end = start + m[0].length
      if (!hits.some((h) => h.start < end && start < h.end)) hits.push({ id, start, end })
    }
  }
  return hits.sort((a, b) => a.start - b.start)
}

type Tag = { id: ID } | { pronoun: string } | null

/** The word index each name starts and ends at. */
function hitWords(ws: Word[], hits: NameHit[]): { id: ID; first: number; last: number }[] {
  return hits
    .map((h) => ({ id: h.id, first: ws.findIndex((w) => w.start >= h.start), last: ws.findLastIndex((w) => w.end <= h.end) }))
    .filter((h) => h.first >= 0 && h.last >= h.first)
}

/** A speech tag just after a line: `, said Mara.`, ` Mara whispered.`, ` she said quietly.` */
function tagAfter(post: string, names: { id: ID; name: string }[]): Tag {
  // Only the words before the sentence ends (or the next line begins).
  const head = post.match(/^[\s,;:—–-]*([^.!?…“”"‘]*)/)?.[1] ?? ''
  const ws = words(head)
  const v = ws.findIndex((w, i) => i <= 3 && VERBS.has(w.lower))
  if (v < 0) return null
  const hits = hitWords(ws, namesIn(head, names))
  // "Mara said", "Mara quietly said" / "said Mara"
  const before = hits.find((h) => h.first <= 1 && (h.last === v - 1 || (h.last === v - 2 && isAdverb(ws[v - 1]))))
  if (before) return { id: before.id }
  const after = hits.find((h) => h.first === v + 1)
  if (after && v <= 1) return { id: after.id }
  const p = ws[v - 1]?.lower ?? ''
  const p2 = isAdverb(ws[v - 1]) ? (ws[v - 2]?.lower ?? '') : ''
  const pronoun = p in PRONOUNS ? p : p2 in PRONOUNS ? p2 : v === 0 && (ws[1]?.lower ?? '') in PRONOUNS ? ws[1].lower : null
  return pronoun && v <= 2 ? { pronoun } : null
}

/** A speech tag just before a line: `Mara said, “`, `Then she asked quietly: “`. */
function tagBefore(pre: string, names: { id: ID; name: string }[]): Tag {
  // Only the last sentence, and only when it leads into the line (no full stop before the quotation mark).
  if (/[.!?…]["”’)]?\s*$/.test(pre)) return null
  const tail = pre.split(/[.!?…]["”’)]?\s+/).pop() ?? ''
  const ws = words(tail)
  const n = ws.length
  const v = ws.findLastIndex((w, i) => i >= n - 3 && VERBS.has(w.lower))
  if (v < 0) return null
  const hits = hitWords(ws, namesIn(tail, names))
  const subject = hits.filter((h) => h.last < v).pop()
  if (subject && v - subject.last <= 3) return { id: subject.id }
  const after = hits.find((h) => h.first === v + 1)
  if (after) return { id: after.id }
  const p = ws[v - 1]?.lower ?? ''
  const p2 = isAdverb(ws[v - 1]) ? (ws[v - 2]?.lower ?? '') : ''
  const pronoun = p in PRONOUNS ? p : p2 in PRONOUNS ? p2 : null
  return pronoun ? { pronoun } : null
}

interface Line {
  start: number
  end: number
  tag: Tag
  speakerId: ID | null
  how: HowKnown | null
}

interface Para {
  start: number
  text: string
  lines: Line[]
  /** The characters the words outside the lines name, in order of first mention. */
  named: ID[]
  /** The narration says "I" (first person). */
  firstPerson: boolean
  /** The character the sentence just before the first line starts with (its subject). */
  leadSubject: ID | null
  /** That sentence starts with a pronoun instead ("She looked at Tobin."): 'she', 'he', 'they', 'i' or 'we'. */
  leadPronoun: string | null
  sceneBreak: boolean
}

function readParagraph(text: string, start: number, names: { id: ID; name: string }[]): Para {
  const spans = quoteSpans(text)
  const lines: Line[] = spans.map((s, i) => {
    const prevEnd = i > 0 ? spans[i - 1].end : 0
    const nextStart = i + 1 < spans.length ? spans[i + 1].start : text.length
    const tag = tagAfter(text.slice(s.end, nextStart), names) ?? tagBefore(text.slice(prevEnd, s.start), names)
    return { start: start + s.start, end: start + s.end, tag, speakerId: null, how: null }
  })
  // The narration: everything outside the lines.
  let narration = ''
  let at = 0
  for (const s of spans) {
    narration += `${text.slice(at, s.start)} `
    at = s.end
  }
  narration += text.slice(at)
  const named: ID[] = []
  for (const h of namesIn(narration, names)) if (!named.includes(h.id)) named.push(h.id)
  const lead = spans.length ? text.slice(0, spans[0].start) : ''
  const lastSentence =
    lead
      .split(/[.!?…]["”’)]?\s+/)
      .filter((x) => x.trim())
      .pop() ?? ''
  const subjectHit = namesIn(lastSentence, names)[0]
  const leadSubject = subjectHit && words(lastSentence.slice(0, subjectHit.start)).length <= 1 ? subjectHit.id : null
  const first = words(lastSentence)[0]?.lower ?? ''
  return {
    start,
    text,
    lines,
    named,
    firstPerson: /(^|[^\p{L}])I([^\p{L}’']|$)/u.test(narration),
    leadSubject,
    leadPronoun: !leadSubject && first in PRONOUNS ? first : null,
    sceneBreak: /^\s*(\*\s*){3,}\s*$/.test(text)
  }
}

/** Splits text into paragraphs (by line breaks), with where each starts. */
function paragraphs(text: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = []
  let at = 0
  for (const part of text.split('\n')) {
    if (part.trim()) out.push({ start: at, text: part })
    at += part.length + 1
  }
  return out
}

const pronounFits = (s: Speaker | undefined, pronoun: string): boolean => {
  const re = PRONOUNS[pronoun]
  return !!s && !!re && re.test(s.pronouns)
}

/**
 * Who says each line of dialogue in the selected words. `before` and `after` are the scene's text
 * around them: the words just before give the exchange so far, and the rest of the paragraph after
 * them may hold the line's speech tag. Lines whose speaker can't be told have a null `speakerId`.
 */
export function whoSpeaks(o: { before: string; selection: string; after: string; cast: Speaker[]; povId: ID | null }): SpokenLine[] {
  const names = nameList(o.cast)
  const byId = new Map(o.cast.map((s) => [s.id, s]))
  // The last few paragraphs before the words, and the rest of the paragraph they end in.
  const beforeTail = o.before
    .split(/\n\s*\n/)
    .slice(-6)
    .join('\n\n')
  const afterHead = /^\s*\n/.test(o.after) ? '' : o.after.split(/\n/)[0]
  const text = beforeTail + o.selection + afterHead
  const from = beforeTail.length
  const to = from + o.selection.length
  const paras = paragraphs(text).map((p) => readParagraph(p.text, p.start, names))
  const pov = o.povId && byId.has(o.povId) ? o.povId : null

  // 1. Speech tags naming a character (or "I said", the point-of-view character).
  for (const p of paras) {
    for (const l of p.lines) {
      if (l.tag && 'id' in l.tag) [l.speakerId, l.how] = [l.tag.id, 'tag']
      else if (l.tag && 'pronoun' in l.tag && (l.tag.pronoun === 'i' || l.tag.pronoun === 'we') && pov) [l.speakerId, l.how] = [pov, 'tag']
    }
  }

  // 2. Within each paragraph: the same speaker carries on; with no tag, the one character it names speaks.
  const carry = (p: Para): void => {
    p.lines.forEach((l, i) => {
      if (l.speakerId) return
      const prev = p.lines.slice(0, i).findLast((x) => x.speakerId && x.how !== 'carry')
      const next = p.lines.slice(i + 1).find((x) => x.speakerId && x.how !== 'carry')
      const same = prev ?? next
      if (same && !(l.tag && 'pronoun' in l.tag && !pronounFits(byId.get(same.speakerId!), l.tag.pronoun))) {
        ;[l.speakerId, l.how] = [same.speakerId, 'carry']
      }
    })
  }
  /** The pronoun a line's tag uses, or (with no tag) the one its paragraph's lead-in starts with. */
  const pronounOf = (p: Para, l: Line): string | null => (l.tag && 'pronoun' in l.tag ? l.tag.pronoun : !l.tag ? p.leadPronoun : null)
  const fits = (id: ID, p: Para, l: Line): boolean => {
    const pronoun = pronounOf(p, l)
    return !pronoun || pronoun === 'i' || pronoun === 'we' ? true : pronounFits(byId.get(id), pronoun)
  }
  for (const p of paras) {
    if (!p.lines.length) continue
    if (!p.lines.some((l) => l.speakerId)) {
      // The character the lead-in starts with; else the one character named (unless the lead-in starts
      // with a pronoun, when the named one is more likely spoken to); else "I", the point of view.
      const firstPerson = p.leadPronoun === 'i' || p.leadPronoun === 'we' || (p.named.length === 0 && p.firstPerson)
      const who = p.leadSubject ?? (p.named.length === 1 && !p.leadPronoun ? p.named[0] : firstPerson ? pov : null)
      if (who) for (const l of p.lines) if (fits(who, p, l)) [l.speakerId, l.how] = [who, 'named']
    }
    carry(p)
  }

  // 3. In order: a pronoun tag that fits only one of the people about; turn-taking between two people.
  const speakerOf = (p: Para): ID | null => p.lines.findLast((l) => l.speakerId)?.speakerId ?? null
  const dialogue: Para[] = []
  paras.forEach((p, i) => {
    if (p.sceneBreak) {
      dialogue.length = 0
      return
    }
    if (!p.lines.length) return
    const recent = dialogue.slice(-2).map(speakerOf)
    if (p.lines.some((l) => !l.speakerId)) {
      // Who is about: the last two speakers and the characters named in this paragraph and the two before.
      const about = new Set<ID>([...recent.filter((x): x is ID => !!x), ...paras.slice(Math.max(0, i - 2), i + 1).flatMap((x) => x.named)])
      for (const l of p.lines) {
        const pronoun = pronounOf(p, l)
        if (l.speakerId || !pronoun || pronoun === 'i' || pronoun === 'we') continue
        const fit = [...about].filter((id) => pronounFits(byId.get(id), pronoun))
        if (fit.length === 1) [l.speakerId, l.how] = [fit[0], 'pronoun']
      }
      carry(p)
    }
    if (!p.lines.some((l) => l.speakerId)) {
      // Two people taking turns: the one before last speaks again.
      const [a, b] = recent
      if (a && b && a !== b) for (const l of p.lines) if (fits(a, p, l)) [l.speakerId, l.how] = [a, 'turn']
    }
    dialogue.push(p)
  })

  // The lines in (or overlapping) the selected words.
  return paras
    .flatMap((p) => p.lines)
    .filter((l) => l.start < to && l.end > from)
    .map((l) => ({ quote: text.slice(l.start, l.end), speakerId: l.speakerId, how: l.how }))
}
