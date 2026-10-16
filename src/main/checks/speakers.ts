// Who speaks a line of dialogue, read without the AI (the rule-based checks, long story memory fix 8): only the plain
// ways a line is given to someone, so a name in the words is never taken for a speaker by guesswork.
//   "You took your time," said Tobin.      "You took your time," Tobin said.      Tobin said, "You took your time."
// A name inside the quotation marks is someone spoken of or to, never the speaker; "Tobin had said" or "Tobin would say"
// is a memory, so only the plain verb straight after the name (or straight before it, after the line) counts. Names are
// read by the one name rule (shared/names.ts, fix 12), longest first: "said Mara Venn" names Mara Venn, never a Mara
// beside her. Words that two characters go by name neither of them. Pure.

import type { ID } from '@shared/types'
import { askingAt, foldApostrophes, ignoresCase, NAME_AFTER, NAME_BEFORE, namePattern, startsSentence } from '@shared/names'

/** Where a quotation is in the text: from its opening mark to just after its closing one. */
export interface QuoteSpan {
  start: number
  end: number
}

const LETTER = /[\p{L}\p{N}]/u

/**
 * Every quotation in the text, paragraph by paragraph: “…” and "…", and ‘…’ or '…' where the marks open and close a
 * quotation rather than stand for a missing letter ("don’t", "the boys’ coats" inside one, "’tis"). Marks inside a
 * quotation of the other kind are part of it. One left open runs to the end of its paragraph (speech over several
 * paragraphs leaves each but the last open).
 */
export function quoteSpans(text: string): QuoteSpan[] {
  const out: QuoteSpan[] = []
  let open: { at: number; double: boolean } | null = null
  for (let i = 0; i <= text.length; i++) {
    const c = text[i]
    if (i === text.length || c === '\n') {
      if (open) out.push({ start: open.at, end: i })
      open = null
      continue
    }
    const before = i > 0 ? text[i - 1] : ''
    const after = text[i + 1] ?? ''
    if (c === '“' || c === '”' || c === '"') {
      if (open?.double) {
        if (c !== '“') {
          out.push({ start: open.at, end: i + 1 })
          open = null
        }
      } else if (!open && c !== '”') open = { at: i, double: true }
      continue
    }
    if (c === '‘' || c === '’' || c === "'") {
      if (open && !open.double) {
        // Closes only when no letter follows ("can’t" stays inside).
        if (c !== '‘' && !LETTER.test(after) && before && !/\s/u.test(before)) {
          out.push({ start: open.at, end: i + 1 })
          open = null
        }
      } else if (!open && c !== '’' && !LETTER.test(before) && LETTER.test(after)) open = { at: i, double: false }
      else if (!open && c === '’' && !LETTER.test(before) && /\p{Lu}/u.test(after)) open = { at: i, double: false }
    }
  }
  return out
}

/** The verbs a line of dialogue is given to someone with. */
const SAY =
  'said|says|asked|asks|replied|replies|answered|answers|whispered|whispers|shouted|shouts|called|calls|cried|cries|murmured|murmurs|muttered|mutters|snapped|snaps|added|adds|yelled|yells|hissed|hisses|barked|barks|demanded|demands|told|tells|continued|continues|went on|goes on|agreed|agrees|insisted|insists|repeated|repeats|began|begins|breathed|breathes|growled|growls|sighed|sighs|laughed|laughs|warned|warns|promised|promises|admitted|admits|explained|explains|offered|offers|pleaded|pleads|begged|begs|roared|roars|screamed|screams'
/** The verb straight after a name: "Tobin said". */
const VERB_AFTER = new RegExp(`^\\s+(?:${SAY})(?![\\p{L}])`, 'iu')
/** The verb straight before a name, after a line: "…," said Tobin. */
const VERB_BEFORE = new RegExp(`(?:^|[^\\p{L}])(?:${SAY})\\s+$`, 'iu')
/** What may stand between a line's closing mark and what follows it in the same paragraph: spaces, a comma or a dash. */
const BETWEEN = /^[^\S\n]*[,—–-]?[^\S\n]*$/u

/** Someone named in a text, or words two people go by (`id` null). */
interface Named {
  id: ID | null
  start: number
  end: number
}

const lastWordOf = (name: string): string => foldApostrophes(name.toLowerCase()).match(/[\p{L}\p{N}'-]+/gu)?.at(-1) ?? ''

/**
 * Every place the text names someone, by their names and other names (and what this scene's words call them), longest
 * first with no overlaps, so "Mara Venn" is never read as Mara. Words two people go by are kept as a place (so nothing
 * shorter is read inside them), named to no one.
 */
export function namedPlaces(text: string, people: readonly { id: ID; names: readonly string[] }[]): Named[] {
  const owners = new Map<string, Set<ID>>()
  for (const p of people) {
    for (const raw of p.names) {
      const n = raw.replace(/\s+/g, ' ').trim()
      if (n.length < 2) continue
      const key = ignoresCase(n) ? n.toLowerCase() : n
      let set = owners.get(key)
      if (!set) owners.set(key, (set = new Set()))
      set.add(p.id)
    }
  }
  const lower = foldApostrophes(text.toLowerCase())
  const names = [...owners.keys()].filter((n) => lower.includes(lastWordOf(n))).sort((a, b) => b.length - a.length)
  const found: Named[] = []
  for (const n of names) {
    const ids = owners.get(n)!
    const re = new RegExp(`${NAME_BEFORE}${namePattern(n)}${NAME_AFTER}`, ignoresCase(n) ? 'giu' : 'gu')
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0
      const end = start + m[0].length
      if (askingAt(text, start, end) || found.some((f) => f.start < end && start < f.end)) continue
      found.push({ id: ids.size === 1 ? [...ids][0] : null, start, end })
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

/** One line of dialogue given to someone. */
export interface SpokenLine {
  entryId: ID
  /** The line and the words that give it to them, exactly as the text has them ("“You took your time,” said Tobin."). */
  quote: string
  start: number
}

/** True when a sentence begins at `at`: a paragraph's start, or after a full stop and the like (shared/names.ts). */
function opensSentence(text: string, at: number): boolean {
  const before = text.slice(0, at)
  return /^[^\S\n]*$/u.test(before.slice(before.lastIndexOf('\n') + 1)) || startsSentence(text, at)
}

/** Where the sentence that `from` is in ends: its full stop (or ? ! …), the next quotation, or the paragraph's end. */
function sentenceEnd(text: string, from: number, spans: QuoteSpan[]): number {
  const next = spans.find((s) => s.start >= from)?.start ?? text.length
  const para = text.indexOf('\n', from)
  let end = Math.min(next, para < 0 ? text.length : para)
  const stop = /[.!?…]/u.exec(text.slice(from, end))
  if (stop) end = from + stop.index + 1
  return end
}

/**
 * The lines of dialogue the text gives to each of these people, in the plain ways above, in the order they come. Each
 * person's names are their name, other names and what this scene's words call them.
 */
export function spokenLines(text: string, people: readonly { id: ID; names: readonly string[] }[]): SpokenLine[] {
  if (!text.trim() || !people.length) return []
  const spans = quoteSpans(text)
  if (!spans.length) return []
  const inside = (at: number): boolean => spans.some((s) => s.start <= at && at < s.end)
  /** The quotation that ends just before `at`, with only spaces, a comma or a dash between. */
  const endingBefore = (at: number): QuoteSpan | null => {
    for (let i = spans.length - 1; i >= 0; i--) {
      const s = spans[i]
      if (s.end > at) continue
      return BETWEEN.test(text.slice(s.end, at)) ? s : null
    }
    return null
  }
  const out: SpokenLine[] = []
  for (const n of namedPlaces(text, people)) {
    // Inside a line, or someone else's ("said Tobin's sister").
    if (!n.id || inside(n.start) || /^['’]s(?![\p{L}])/u.test(text.slice(n.end, n.end + 3))) continue
    let line: { start: number; end: number } | null = null
    const after = VERB_AFTER.exec(text.slice(n.end, n.end + 40))
    if (after) {
      const verbEnd = n.end + after[0].length
      const before = endingBefore(n.start)
      if (before) {
        // "…," Tobin said.
        line = { start: before.start, end: sentenceEnd(text, verbEnd, spans) }
      } else {
        // Tobin said, "…"
        const lead = /^\s*[,:]?\s*/u.exec(text.slice(verbEnd))![0].length
        const next = spans.find((s) => s.start === verbEnd + lead)
        if (next && opensSentence(text, n.start)) line = { start: n.start, end: next.end }
      }
    } else {
      // "…," said Tobin.
      const verb = VERB_BEFORE.exec(text.slice(Math.max(0, n.start - 40), n.start))
      if (verb) {
        const verbStart = n.start - verb[0].length + (/^[^\p{L}]/u.test(verb[0]) ? 1 : 0)
        const before = endingBefore(verbStart)
        if (before) line = { start: before.start, end: sentenceEnd(text, n.end, spans) }
      }
    }
    if (!line) continue
    const quote = text.slice(line.start, line.end).trim()
    if (quote) out.push({ entryId: n.id, quote, start: line.start })
  }
  return out.sort((a, b) => a.start - b.start)
}

/** How many times the narration (outside quotation marks) says "I", "me" or "my": a sign the scene is told in the first person. */
export function narratorI(text: string): number {
  const spans = quoteSpans(text)
  let n = 0
  for (const m of text.matchAll(/(?<![\p{L}\p{N}'’])(?:I|[Mm]e|[Mm]y|[Mm]yself)(?![\p{L}\p{N}])/gu)) {
    const at = m.index ?? 0
    if (!spans.some((s) => s.start <= at && at < s.end)) n++
  }
  return n
}
