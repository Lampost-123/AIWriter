// How each character sounds, read from their own lines (2026-10-19): a few cheap marks from the dialogue the story gives
// them (checks/speakers.ts spokenLines, and the sample lines the memory keeper kept), Adam's own lines first, for one
// compact line each in the writer's "How they sound" (ai/context.ts VOICES_BLOCK):
//   "Bryn: short sentences (about 5 words); calls people "girl"; often says "aye"; never says "please""
// Only what the lines plainly show: sentence and line length, contractions or none, a dropped g, forms of address,
// swearing, words they use far more than anyone else, questions, exclamations, trailing or breaking off, please. The
// lines themselves are never sent (a line copied word for word is a known fault). Pure.

import type { ID } from '@shared/types'
import { foldApostrophes } from '@shared/names'
import { quoteSpans } from '../checks/speakers'
import { wordsOf } from './ownWords'

/** One line of dialogue: who says it, the words inside the quotation marks, and whether Adam wrote it himself. */
export interface SpokenBy {
  entryId: ID
  text: string
  own: boolean
}

/** Someone who may speak, with the names they go by. */
export interface Speaker {
  id: ID
  name: string
  aliases?: readonly string[]
}

/** One character's marks: the compact line (without their name), whether from Adam's own lines, and how many lines. */
export interface VoiceMark {
  text: string
  own: boolean
  lines: number
}

/** Fewer lines (or words) than these and nothing is said: too little to tell. */
export const MIN_LINES = 3
export const MIN_WORDS = 20
/** The most marks on one line. */
export const MOST_MARKS = 5

/** The words inside the quotation marks of a line of dialogue as the text has it ("“Get down,” said Bryn." → "Get down,"). */
export function spokenWords(quote: string): string[] {
  const spans = quoteSpans(quote)
  if (!spans.length) return quote.trim() ? [quote.trim()] : []
  return spans
    .map((s) => {
      const inner = quote.slice(s.start + 1, s.end)
      // The closing mark of the quotation's own kind, if it has one (a line left open runs to its paragraph's end).
      const close = /["“”]/u.test(quote[s.start]) ? /["”]$/u : /['’]$/u
      return close.test(inner) ? inner.slice(0, -1) : inner
    })
    .map((t) => t.trim())
    .filter(Boolean)
}

const STOP = new Set(
  `a an the and or but if so to of in on at for with from by as into onto over under about after before than then too very
  i me my mine myself you your yours yourself he him his himself she her hers herself it its itself we us our ours they them
  their theirs this that these those there here what who whom whose which where when why how all any some one ones none
  is are was were be been being am do does did done doing have has had having will would can could shall should may might
  must not no yes nor only own same other others such just now still even ever never always again also more most much many
  little less least up down out off back away well oh ah eh right okay ok good fine sure yeah yep nope
  get got gets go goes going gone went come comes came coming see saw seen say says said tell told think thought know knew
  known want wanted like make made take took need let look looked give gave way thing things something nothing anything
  everything someone anyone everyone time times day night man men woman women let's i'm i've i'll i'd you're you've you'll
  you'd he's he'll he'd she's she'll she'd it's it'll we're we've we'll we'd they're they've they'll they'd that's there's
  here's what's who's where's don't doesn't didn't can't couldn't won't wouldn't shouldn't isn't aren't wasn't weren't
  haven't hasn't hadn't mustn't ain't`.split(/\s+/)
)

/** Words that are someone called something, at the start or end of a sentence: "Get down, girl." "Sir, they're here." */
const ADDRESS = new Set(
  `sir ma'am madam miss missus mister girl boy lad lass lassie laddie love darling dear dearie sweetheart sweetie honey hon
  mate friend child children son kid kiddo pet chief boss captain cap'n brother sister mother father mum mam ma mom dad da pa
  papa mama granny gran grandma grandpa uncle aunt auntie cousin princess prince fool idiot buddy pal guv gov doc lady lord
  master mistress m'lord m'lady milord milady sergeant commander professor doctor stranger`.split(/\s+/)
)
const ADDRESS_PHRASES = ['little one', 'old man', 'old woman', 'young man', 'young lady', 'your grace', 'your majesty', 'your highness', 'your honour', 'your honor']
/** "my lord", "my love", "my girl"; never "my god" or "my word", which are no one. */
const NOT_MY = new Set(['god', 'gods', 'goodness', 'word', 'lord god', 'heavens', 'stars', 'oh', 'fault', 'mistake', 'turn', 'pleasure'])

const SWEARS = new Set(
  `damn damned dammit damnit hell bloody fuck fucking fucked shit shite bastard bastards bugger christ crap arse ass piss
  pissed sod bollocks gods`.split(/\s+/)
)

const FORMAL = /\b(?:do|does|did|is|are|was|were|have|has|had|would|could|should|will|must) not\b|\bcannot\b|\bI am\b|\blet us\b|\b(?:it|that|there|what) is\b|\bI (?:will|would|have|had)\b/gi
const CONTRACTION = /\b[a-z]+'(?:t|re|ve|ll|m|d)\b|\b(?:it|that|he|she|there|here|what|who|where|let)'s\b/gi

/** The sentences of a line ("Get down. Now!" → two). */
const sentencesOf = (text: string): string[] => (text.match(/[^.!?…]+(?:[.!?…]+|$)/gu) ?? []).filter((s) => wordsOf(s).length)

/** Counts each word (and each pair of words) in some texts, and in how many of them it comes. */
function counts(texts: readonly string[]): { words: Map<string, number>; pairs: Map<string, number>; inLines: Map<string, number>; total: number } {
  const words = new Map<string, number>()
  const pairs = new Map<string, number>()
  const inLines = new Map<string, number>()
  let total = 0
  for (const t of texts) {
    const w = wordsOf(t)
    total += w.length
    const seen = new Set<string>()
    w.forEach((x, i) => {
      words.set(x, (words.get(x) ?? 0) + 1)
      seen.add(x)
      if (i + 1 < w.length) {
        const p = `${x} ${w[i + 1]}`
        pairs.set(p, (pairs.get(p) ?? 0) + 1)
        seen.add(p)
      }
    })
    for (const s of seen) inLines.set(s, (inLines.get(s) ?? 0) + 1)
  }
  return { words, pairs, inLines, total }
}

const quoted = (items: string[]): string => {
  const q = items.map((i) => `"${i}"`)
  return q.length <= 1 ? q.join('') : `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`
}

/**
 * The marks for one person's lines (`texts`, the words inside the quotation marks). `others`: every other line of
 * dialogue read, to tell the words they favour and whether anyone else says please. `names`: the words of everyone's
 * names (never a favourite word); `aliasOf`: another name someone goes by, lower case, and whose it is.
 */
export function marksOf(
  texts: readonly string[],
  o: { others: readonly string[]; names?: ReadonlySet<string>; aliasOf?: ReadonlyMap<string, string> } = { others: [] }
): string[] {
  const lines = texts.map((t) => foldApostrophes(t).replace(/\s+/g, ' ').trim()).filter((t) => wordsOf(t).length)
  const mine = counts(lines)
  if (lines.length < MIN_LINES || mine.total < MIN_WORDS) return []
  const theirs = counts(o.others.map((t) => foldApostrophes(t)))
  const names = o.names ?? new Set<string>()
  const marks: string[] = []

  // How long they talk.
  const sentences = lines.flatMap(sentencesOf)
  const perSentence = mine.total / Math.max(1, sentences.length)
  const perLine = mine.total / lines.length
  if (sentences.length >= 4 && perSentence <= 6) marks.push(`short sentences (about ${Math.max(1, Math.round(perSentence))} words)`)
  else if (sentences.length >= 4 && perSentence >= 16) marks.push(`long sentences (about ${Math.round(perSentence)} words)`)
  if (lines.length >= 4 && perLine >= 40) marks.push('talks at length')
  else if (lines.length >= 4 && perLine <= 6 && !(perSentence <= 6)) marks.push('says little at a time')

  // Contractions, or none at all; a dropped g.
  const all = lines.join(' \n ')
  const formal = [...all.matchAll(FORMAL)].map((m) => m[0].toLowerCase())
  const contracted = [...all.matchAll(CONTRACTION)].length
  if (!contracted && formal.length >= 2 && mine.total >= 30) {
    const top = [...new Set(formal)].slice(0, 2)
    marks.push(`never uses contractions (${top.map((t) => `"${t}"`).join(', ')})`)
  }
  const dropped = [...new Set([...all.matchAll(/\b[a-z]{2,}in'(?![a-z])/gi)].map((m) => m[0].toLowerCase()))]
  if ([...all.matchAll(/\b[a-z]{2,}in'(?![a-z])/gi)].length >= 2) marks.push(`drops the g (${quoted(dropped.slice(0, 2))})`)

  // What they call people: a word set off by a comma at the start or end of a sentence.
  const called = new Map<string, number>()
  for (const s of sentences) {
    const t = s.trim()
    // A line given before its speech tag ends on a comma: "Get the lamp, girl," Bryn said.
    const ends = /,\s+((?:my |your )?[\p{L}'-]+(?: [\p{L}'-]+)?)\s*[.!?…—–,-]*$/u.exec(t)?.[1]
    const starts = /^((?:my |your )?[\p{L}'-]+(?: [\p{L}'-]+)?),\s+\S/u.exec(t)?.[1]
    for (const raw of [ends, starts]) {
      if (!raw) continue
      const term = addressTerm(raw, names, o.aliasOf)
      if (term) called.set(term, (called.get(term) ?? 0) + 1)
    }
  }
  const calls = [...called].filter(([, n]) => n >= 2 || (n >= 1 && n / lines.length >= 0.15)).sort((a, b) => b[1] - a[1])
  if (calls.length) {
    const byAlias = calls.filter(([t]) => o.aliasOf?.has(t.toLowerCase()))
    const general = calls.filter(([t]) => !o.aliasOf?.has(t.toLowerCase()))
    for (const [t] of byAlias.slice(0, 1)) marks.push(`calls ${o.aliasOf!.get(t.toLowerCase())} "${t}"`)
    if (general.length) marks.push(`calls people ${quoted(general.slice(0, 2).map(([t]) => t))}`)
  }

  // Swearing, then the words they use far more than anyone else.
  const swears = [...mine.words].filter(([w]) => SWEARS.has(w)).sort((a, b) => b[1] - a[1])
  if (swears.reduce((n, [, c]) => n + c, 0) >= 2) marks.push(`swears (${quoted(swears.slice(0, 2).map(([w]) => w))})`)
  const favourite = favourites(mine, theirs, names, new Set([...called.keys()].map((k) => k.toLowerCase())))
  if (favourite.length) marks.push(`often says ${quoted(favourite)}`)

  // Questions, exclamations, trailing off, breaking off.
  if (sentences.length >= 5) {
    const asks = sentences.filter((s) => /\?\s*$/.test(s)).length / sentences.length
    const exclaims = sentences.filter((s) => /!\s*$/.test(s)).length / sentences.length
    if (asks >= 0.4) marks.push('asks a lot of questions')
    else if (exclaims >= 0.3) marks.push('exclaims a lot')
  }
  const trails = lines.filter((l) => /…|\.\.\./.test(l)).length
  if (trails >= 2 && trails / lines.length >= 0.2) marks.push('trails off ("…")')
  const breaks = lines.filter((l) => /(?:—|–|--)\s*$/.test(l)).length
  if (breaks >= 2 && breaks / lines.length >= 0.2) marks.push('breaks off mid-line')

  // Please: never, where others say it; or a lot.
  const please = mine.words.get('please') ?? 0
  if (!please && lines.length >= 10 && (theirs.words.get('please') ?? 0) >= 2) marks.push('never says "please"')
  else if (please >= 2 && (mine.inLines.get('please') ?? 0) / lines.length >= 0.2) marks.push('says "please" a lot')

  return marks.slice(0, MOST_MARKS)
}

/**
 * A form of address, as said ("girl", "my lord", "Captain"), or another name someone goes by; null for anything else,
 * and for someone's own name (calling people by their names tells nothing).
 */
function addressTerm(raw: string, names: ReadonlySet<string>, aliasOf?: ReadonlyMap<string, string>): string | null {
  const t = raw.trim()
  const lower = t.toLowerCase()
  if (aliasOf?.has(lower)) return t
  if (ADDRESS_PHRASES.includes(lower)) return lower
  const my = /^my (.+)$/.exec(lower)
  if (my) return NOT_MY.has(my[1]) || my[1].includes(' ') ? null : lower
  const [first, ...rest] = lower.split(' ')
  // A title and a name ("Captain Hale"): the title.
  if (rest.length) return ADDRESS.has(first) && isTitle(first) && /^\p{Lu}/u.test(t) ? t.split(' ')[0] : null
  if (!ADDRESS.has(lower) || (names.has(lower) && !isTitle(lower))) return null
  return isTitle(lower) && /^\p{Lu}/u.test(t) ? t : lower
}

/** Address words kept with their capital ("Captain", "Doctor"); the rest are said lower case ("girl", "sir"). */
const isTitle = (w: string): boolean => ['captain', 'doctor', 'professor', 'sergeant', 'commander', 'master', 'mistress', 'lady', 'lord', 'princess', 'prince'].includes(w)

/**
 * Up to two words (or a pair of words) someone uses far more than everyone else: at least three times, in two lines or
 * more (three for a pair), and three times as often as the others (four for a pair). Never a common word, a name, a
 * swear word or a form of address (said already).
 */
function favourites(mine: ReturnType<typeof counts>, theirs: ReturnType<typeof counts>, names: ReadonlySet<string>, said: ReadonlySet<string>): string[] {
  const rate = (n: number, total: number): number => (n + 0.5) / Math.max(1, total)
  const pick: { item: string; score: number; pair: boolean }[] = []
  for (const [w, n] of mine.words) {
    if (n < 3 || (mine.inLines.get(w) ?? 0) < 2 || STOP.has(w) || names.has(w) || SWEARS.has(w) || said.has(w) || (w.length < 3 && !w.includes("'"))) continue
    const ratio = rate(n, mine.total) / rate(theirs.words.get(w) ?? 0, theirs.total)
    if (ratio >= 3) pick.push({ item: w, score: n * Math.log(ratio), pair: false })
  }
  for (const [p, n] of mine.pairs) {
    const [a, b] = p.split(' ')
    if (n < 3 || (mine.inLines.get(p) ?? 0) < 3 || names.has(a) || names.has(b) || (STOP.has(a) && STOP.has(b) && !TIC_PAIRS.has(p))) continue
    const ratio = rate(n, mine.total) / rate(theirs.pairs.get(p) ?? 0, theirs.total)
    if (ratio >= 4) pick.push({ item: p, score: n * Math.log(ratio) * 1.2, pair: true })
  }
  pick.sort((x, y) => y.score - x.score || x.item.localeCompare(y.item))
  const out: string[] = []
  for (const p of pick) {
    if (out.length >= 2) break
    // A pair takes the place of its own words.
    if (out.some((o) => o.split(' ').some((w) => p.item.split(' ').includes(w)))) continue
    out.push(p.item)
  }
  return out
}

/** Pairs of common words that are tics all the same. */
const TIC_PAIRS = new Set(['you know', 'i mean', 'you see', 'i suppose', 'i reckon', 'i guess', 'mark me', 'you hear', 'look here', 'see here', 'i say', 'of course', 'you understand'])

/**
 * Each character's marks from the lines given them (Adam's own lines alone when there are enough of them, else all of
 * theirs), by entry id; only those with something to say. `dialogue`: every line of dialogue read, whoever says it.
 */
export function voiceMarksFor(lines: readonly SpokenBy[], people: readonly Speaker[], dialogue: readonly string[]): Map<ID, VoiceMark> {
  const out = new Map<ID, VoiceMark>()
  const names = new Set<string>()
  for (const p of people) for (const n of [p.name, ...(p.aliases ?? [])]) for (const w of wordsOf(n)) names.add(w)
  const byId = new Map<ID, SpokenBy[]>()
  for (const l of lines) byId.set(l.entryId, [...(byId.get(l.entryId) ?? []), l])
  for (const p of people) {
    const theirs = byId.get(p.id) ?? []
    if (theirs.length < MIN_LINES) continue
    const own = theirs.filter((l) => l.own)
    const enoughOwn = own.length >= MIN_LINES && own.reduce((n, l) => n + wordsOf(l.text).length, 0) >= MIN_WORDS
    const use = enoughOwn ? own : theirs
    // Everyone else's lines: the dialogue read, less this person's (each once).
    const mine = new Map<string, number>()
    for (const l of theirs) mine.set(l.text, (mine.get(l.text) ?? 0) + 1)
    const others = dialogue.filter((d) => {
      const n = mine.get(d) ?? 0
      if (!n) return true
      mine.set(d, n - 1)
      return false
    })
    // Other names the people in the story go by, and whose they are ("Wrennie" → Wren), for "calls Wren "Wrennie"".
    const aliasOf = new Map<string, string>()
    for (const q of people) if (q.id !== p.id) for (const a of q.aliases ?? []) if (a.trim()) aliasOf.set(a.trim().toLowerCase(), q.name)
    const marks = marksOf(
      use.map((l) => l.text),
      { others, names, aliasOf }
    )
    if (marks.length) out.set(p.id, { text: marks.join('; '), own: enoughOwn, lines: use.length })
  }
  return out
}
