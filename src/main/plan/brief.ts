// The continuity brief before each scene, the planner's side (long story memory fix 14, 2026-10-16; the writer's side is
// ai/brief.ts). The plan before writing (plan.ts) is the memory model's call already made before each draft; with a
// brief it reads far more than the writer could and gives back, besides the plan, a short brief of what matters for the
// scene. No new call: the plan's grows.
//
// What it reads, besides what the plan always read (the scene card, what must stay true, where things stand, the words
// just before, the codex's names):
// - the book so far, word for word and in reading order, only when the memory model reads at least BOOK_READER tokens
//   and the book fits in BOOK_SHARE of that; sent first, so a provider that reuses the start of a prompt it has seen
//   (DeepSeek, OpenAI; Claude where the request marks it) reads it from its cache at the next scene, which adds one scene;
// - how each earlier chapter of this story ended, from the story record (fix 15's snapshots), with where each change was;
// - everyone and everything in the scene in full: each person here (the card, the stage, the scene so far), the place,
//   the card's plot threads and the other entries the briefing names, each with all that has happened to them;
// - who knows what among everyone here, with since when and how, and who believes what wrongly (fix 9's ledger, uncapped);
// - every plot thread still open, due or overdue first (fix 10), in place of the writer's capped list;
// - the story calendar: this scene's date, how long since each earlier day worth counting from, and ages (fix 11);
// - the slips the checks found in earlier scenes and that were put right (fix 7), and the rule checks' findings still
//   open in this scene (fix 8);
// - after the words just before (they change from step to step): every earlier passage the search found, and the
//   scene's contract (fix 13).
// The record is fitted to the room the memory model has (RECORD_SHARE of what it reads, at most RECORD_MOST), each part
// to its share first and the rest given out by how much each matters. The brief comes back as five short lists, which
// the app checks (checkBrief): a line citing a chapter or scene the planner wasn't given is left out, each list is
// capped, and the whole is kept to its size. Pure.

import type { BeliefState, ContextPreview, EntryState, FactState, ID } from '@shared/types'
import { learnedWords } from '@shared/knowWords'
import { namedInProse } from '@shared/names'
import {
  formatProfile,
  happenedText,
  sceneKnowers,
  selectEntries,
  toldStage,
  type BlockDraft,
  type ContextInput,
  type PreparedContext
} from '../ai/context'
import { cleanKnows, happenedOf } from '../ai/knows'
import { isPerson, namesPerson, shortPlace } from '../ai/mustStay'
import { deathOf } from '../ai/deaths'
import { openThreadsAt, openThreadsMost, openThreadsText } from '../ai/openThreads'
import { contractText } from '../ai/contract'
import { BRIEF_MAY_SHORTEN, BRIEF_PARTS, type BriefPart, type ContinuityBrief } from '../ai/brief'
import { LEDGER_BLOCK } from '../ai/whoKnows'
import { memoryScale } from '../ai/memoryRoom'
import { lessonLine } from '../checks/lessons'
import { ageWords, dateLabel, elapsedBetween, elapsedWords } from '../memory/calendar'
import { changedLines, endLines, type ChapterSnapshot } from '../memory/snapshot'
import { estimateTokens } from '../keeper/text'

/** The memory model reads at least this many tokens for the book so far to go in whole. */
export const BOOK_READER = 200_000
/** The book so far goes in only as far as it takes no more than this share of what the memory model reads. */
export const BOOK_SHARE = 0.5
/**
 * The most tokens of the book so far a plan reads, however much the memory model reads (fix 14's review): it is sent with
 * every plan that writes a brief (each draft, the first beat of a scene, each scene of Write the whole chapter, and again
 * on a retry), so it is held to what a provider's cache makes cheap. A longer book leaves out its oldest chapters' words
 * (bookWithin); how they ended stays in the record.
 */
export const BOOK_MOST = 150_000
/** The share of what the memory model reads that the plan's prompt may fill without the book (its own parts and the record). */
export const RECORD_SHARE = 0.5
/** The most tokens of story record the planner is given, however much it reads. */
export const RECORD_MOST = 40_000
/** All that the plan reads, the book included, stays within this share of what the memory model reads. */
export const WHOLE_SHARE = 0.9
/** The reply's room for the brief, as a share of the brief's own size (JSON and the odd longer line). */
export const BRIEF_REPLY_SHARE = 1.3
/** How long a draft waits for a plan with a brief (it writes more), and with the book so far in it too. */
export const BRIEF_LIMIT_MS = { record: 90_000, book: 120_000 } as const
/** The most lines of each part the brief keeps. */
export const BRIEF_MOST: Record<BriefPart, number> = { matters: 8, keep: 12, knows: 10, promises: 6, time: 6 }
/** The longest a line of the brief is kept, in characters. */
const LONGEST_LINE = 320
/** When the brief runs over its size, lines go from these parts first (the last line of each in turn). */
const TRIM_ORDER: readonly BriefPart[] = ['promises', 'time', 'matters', 'knows', 'keep']
/** The brief may run this much over the size it was asked for before lines are left out. */
const OVER = 1.2

const PASSAGES_TITLE = 'Earlier passages found by searching the story (best first)'
const CONTRACT_TITLE = 'This scene’s contract'
const LEFT_OUT_TITLE = 'Left out by the author'

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
const plural = (n: number, one: string): string => `${n.toLocaleString('en-GB')} ${one}${n === 1 ? '' : 's'}`

// ---------- What the planner is given ----------

/** A scene of the book so far, word for word. */
export interface BookScene {
  /** Where it is ("Ch 2, Sc 3"), as the rest of the record says it. */
  label: string
  title: string
  text: string
  /** Its chapter ("Ch 2"): the book is cut only between chapters (bookWithin). Left out: one chapter. */
  chapter?: string
}

/**
 * The book so far as the planner may read it, at most `most` tokens: the newest whole chapters that fit, the oldest left
 * out first (their story is in the record: how each chapter ended), so what is sent changes at its start only when a
 * chapter drops out and a provider's cache keeps it from scene to scene. `from`: the first chapter sent when earlier ones
 * were left out, else null. Null when not even the chapter being written fits.
 */
export function bookWithin(scenes: BookScene[], most: number): { scenes: BookScene[]; from: string | null } | null {
  if (!scenes.length) return null
  const chapters: BookScene[][] = []
  for (const s of scenes) {
    const last = chapters[chapters.length - 1]
    if (last && last[0].chapter === s.chapter) last.push(s)
    else chapters.push([s])
  }
  const size = (list: BookScene[]): number => estimateTokens(list.map(sceneText).join('\n\n'))
  let at = chapters.length
  let total = 0
  while (at > 0) {
    const more = size(chapters[at - 1])
    if (total + more > most) break
    total += more
    at--
  }
  if (at === chapters.length) return null
  const kept = chapters.slice(at).flat()
  return { scenes: kept, from: at > 0 ? (kept[0].chapter ?? kept[0].label) : null }
}

/** A scene as the book part sends it. */
const sceneText = (s: BookScene): string => `### ${s.label}${clean(s.title) ? `: ${clean(s.title)}` : ''}\n${s.text.trim()}`

/** An earlier chapter of this story and how it ended, from the story record (fix 15). */
export interface ChapterRecord {
  /** "Ch 3" (this story's title left off). */
  label: string
  snapshot: ChapterSnapshot
}

/** What the world gives the brief besides the briefing's own input (plan/index.ts). */
export interface BriefSources {
  /** The book so far word for word, as much of it as goes in (bookWithin, briefRoom); null otherwise. */
  book: BookScene[] | null
  /** The book's first chapter sent, when earlier ones were left out (bookWithin); left out or null: from the start. */
  bookFrom?: string | null
  /** How each earlier chapter of this story ended, oldest first. */
  chapters: ChapterRecord[]
  /** The rule checks' findings still open in this scene (fix 8), as Adam sees them. */
  findings: string[]
  /** Tokens the record may take (briefRoom). */
  room: number
  /** About how many tokens the brief may take (ai/brief.ts briefSize). */
  tokens: number
  /** The same, should the brief say nothing of who knows what (who knows what then stays whole); left out: `tokens`. */
  tokensNoKnows?: number
}

export interface BriefPartText {
  title: string
  body: string
}

/** What the planner reads for the brief, and how long the brief may be. */
export interface BriefMaterial {
  /** The book so far, word for word, in reading order; null when it isn't read. */
  book: BookScene[] | null
  /** Its first chapter, when earlier ones were left out for room (bookWithin); left out or null: from the start. */
  bookFrom?: string | null
  /** The record that stays the same from one step of a scene to the next, sent before the scene card. */
  record: BriefPartText[]
  /** What changes from step to step (the earlier passages found, the scene's contract), sent after the words before. */
  late: BriefPartText[]
  /** About how many words the brief may run to. */
  words: number
  /** About how many tokens. */
  tokens: number
  /** The most tokens should the brief say nothing of who knows what (checkBrief); left out: `tokens`. */
  tokensNoKnows?: number
  /** The names (and other names) of what Adam kept out of the scene's briefing: never in the brief (checkBrief). */
  hidden?: string[]
}

/**
 * How much the planner may read: whether the book so far goes in whole (the memory model reads at least BOOK_READER
 * tokens and the book takes no more than BOOK_SHARE of it, and all of it fits), and the record's room in tokens.
 * `base`: the plan's own prompt; `reply`: the room kept for its reply; `book`: the book so far's tokens, or null.
 */
export function briefRoom(o: { contextLength: number; base: number; reply: number; book: number | null }): {
  book: boolean
  record: number
} {
  const n = Math.max(0, o.contextLength)
  const record = Math.max(0, Math.min(RECORD_MOST, Math.floor(n * RECORD_SHARE) - o.base - o.reply))
  const book = o.book != null && o.book > 0 && n >= BOOK_READER && o.book <= n * BOOK_SHARE && o.base + o.reply + o.book <= n * WHOLE_SHARE
  return { book, record: book ? Math.max(0, Math.min(record, Math.floor(n * WHOLE_SHARE) - o.base - o.reply - o.book!)) : record }
}

/**
 * About how many tokens the parts that go short beside a brief free (ai/brief.ts BRIEF_MAY_SHORTEN), from the briefing as
 * fitted before the plan: each sent in full, less its short form. A part sent short already (for room, or as Adam chose),
 * one Adam wants in full (it never goes short), and the story so far of a story with earlier books on its line (it stays
 * whole: `earlierBooks`) free nothing. Who knows what goes short only when the brief says who knows what, which isn't
 * known until it is written, so it is counted apart (`knows`). The brief is asked to be about as long as all of it
 * (ai/brief.ts briefSize), and held to `always` alone should it say nothing of who knows what (checkBrief).
 */
export function briefFrees(
  preview: Pick<ContextPreview, 'blocks'>,
  blocks: Pick<BlockDraft, 'id' | 'text' | 'short'>[] | undefined,
  o: { earlierBooks?: boolean } = {}
): { always: number; knows: number } {
  const out = { always: 0, knows: 0 }
  for (const id of BRIEF_MAY_SHORTEN) {
    if (id === 'story-so-far' && o.earlierBooks) continue
    const sent = preview.blocks.find((b) => b.id === id && !b.dropped && !b.short && b.mode !== 'full')
    const draft = blocks?.find((b) => b.id === id)
    if (!sent || !draft?.short) continue
    const n = Math.max(0, estimateTokens(draft.text) - estimateTokens(draft.short))
    if (id === LEDGER_BLOCK.id) out.knows += n
    else out.always += n
  }
  return out
}

/**
 * A part of the record before fitting: its items (lines or entries), most important first, and its share of the room. An
 * item may be given in several forms, longest first: when one doesn't fit, the next is tried (an entry with a long
 * history then gives its most recent part).
 */
export interface Part {
  title: string
  lead?: string
  items: (string | string[])[]
  /** Between items: one line, or a blank line for entries of several lines. */
  sep?: string
  share: number
  /** Which part is given room left over first (lower first); left out: in the order the parts come. */
  rank?: number
}

const formsOfItem = (item: string | string[]): string[] => (Array.isArray(item) ? item.filter(Boolean) : [item])
const bodyOf = (p: Part, chosen: string[]): string => [p.lead ?? '', chosen.join(p.sep ?? '\n')].filter(Boolean).join('\n')

/**
 * Fits the parts to `room` tokens: each first to its share of the room (whole items from the first, in full), then what is
 * left is given out by rank (the parts that matter most first), each item now in the longest form that fits, so a short
 * part leaves its room to the others and an item too long for what is left is given in a shorter form rather than
 * stopping its part. A part with nothing in it is left out.
 */
export function fitParts(parts: Part[], room: number): BriefPartText[] {
  const cost = (p: Part, chosen: string[]): number => (chosen.length ? estimateTokens(`## ${p.title}\n${bodyOf(p, chosen)}`) : 0)
  const taken: string[][] = parts.map(() => [])
  let used = 0
  const grow = (i: number, limit: number, shorter: boolean): void => {
    const p = parts[i]
    const chosen = taken[i]
    while (chosen.length < p.items.length) {
      const was = cost(p, chosen)
      const forms = formsOfItem(p.items[chosen.length])
      const form = (shorter ? forms : forms.slice(0, 1)).find((f) => {
        const now = cost(p, [...chosen, f])
        return now <= limit && used + now - was <= room
      })
      if (form == null) break
      chosen.push(form)
      used += cost(p, chosen) - was
    }
  }
  parts.forEach((p, i) => grow(i, Math.floor(room * p.share), false))
  const byRank = parts.map((p, i) => ({ i, rank: p.rank ?? i })).sort((a, b) => a.rank - b.rank || a.i - b.i)
  for (const { i } of byRank) grow(i, Infinity, true)
  return parts.flatMap((p, i) => (taken[i].length ? [{ title: p.title, body: bodyOf(p, taken[i]) }] : []))
}

/** "Ch 3, Sc 2" for the chapter's "scene 2", so every line of the record cites places the same way. */
const inChapter = (line: string, chapter: string): string => line.replace(/\bscene (\d+)\b/g, `${chapter}, Sc $1`)

/** Who knows what among everyone here, in full: each fact known by someone here, who else here doesn't, and false beliefs. */
function knowledgeLines(
  facts: FactState[],
  beliefs: BeliefState[],
  people: EntryState[],
  happened: ReturnType<typeof happenedOf>,
  nameOf: (id: ID) => string | null,
  place: (w: string) => string
): string[] {
  const ids = new Set(people.map((p) => p.id))
  const name = (id: ID): string => people.find((p) => p.id === id)?.name ?? nameOf(id) ?? ''
  const out: string[] = []
  // Newest learning first, as the writer's block has it.
  const known = cleanKnows(facts, { happened })
    .filter((f) => f.knownBy.some((id) => ids.has(id)) && clean(f.fact))
    .sort((a, b) => (b.at ?? -2) - (a.at ?? -2))
  for (const f of known) {
    const who = f.knownBy
      .filter((id) => ids.has(id))
      .map((id) => {
        const since = learnedWords(f.since?.[id], nameOf, place)
        return `${name(id)}${since ? ` (${since})` : ''}`
      })
    // Never "not known by" someone it is about, nor when who knows it doesn't rest on who was there (as the writer's block).
    const not = f.backed === false ? [] : people.filter((p) => !f.knownBy.includes(p.id) && !namesPerson(f.fact, p)).map((p) => p.name)
    out.push(`${clean(f.fact).replace(/[.]+$/, '')}: known by ${who.join(', ')}${not.length ? `; not known by ${not.join(', ')}` : ''}`)
  }
  for (const b of [...beliefs].sort((x, y) => y.at - x.at)) {
    const who = b.believedBy
      .filter((id) => ids.has(id))
      .map((id) => {
        const since = learnedWords(b.since[id], nameOf, place)
        return `${name(id)}${since ? ` (${since})` : ''}`
      })
    if (who.length && clean(b.fact))
      out.push(`Wrongly believed by ${who.join(', ')}: ${clean(b.fact).replace(/[.]+$/, '')} (it isn't true)`)
  }
  return out
}

/** The story calendar at this scene: its date, how long since each earlier day worth counting from, and ages. */
function calendarLines(input: ContextInput): string[] {
  const cal = input.calendar
  if (!cal) return []
  const out: string[] = []
  const here = cal.here
  const label = dateLabel(here, ', ')
  if (here && label) out.push(`This scene: ${label}`)
  const prev = cal.previous && !input.memory.previous?.otherStory ? elapsedBetween(cal.previous, here) : null
  const then = dateLabel(cal.previous, ', ')
  if (prev && here)
    out.push(
      prev.days === 0 && prev.months === undefined
        ? `The same day as the scene before (${then})`
        : `${elapsedWords(prev)} ${prev.days < 0 ? 'before' : 'after'} the scene before (${then})`
    )
  for (const l of cal.landmarks) {
    const e = elapsedBetween(l.date, here)
    if (e && e.days > 0) out.push(`${elapsedWords(e)} since ${l.name} (${dateLabel(l.date, ', ')})`)
  }
  for (const a of cal.ages) out.push(`${a.name} is ${ageWords(a.age.age)} here (${a.age.basis})`)
  return out
}

/** How much of an entry's history a shorter form keeps: its most recent changes (fitParts tries these in turn). */
const RECENT_HISTORY = [12, 4] as const

/**
 * The record the planner reads for the brief, fitted to `sources.room` (see the top of this file). `prepared`: the
 * briefing as fitted before the plan, for the scene's contract. What Adam kept out of the scene's briefing (a 'hide' pin)
 * is never in it: not as an entry, a knower, a thread, nor in a line naming it (the planner is told their names, so the
 * brief leaves them out too: checkBrief); the book so far is the story's own words and keeps them.
 */
export function briefMaterial(input: ContextInput, prepared: Pick<PreparedContext, 'contract'>, sources: BriefSources): BriefMaterial {
  const sel = selectEntries(input)
  const stage = toldStage(input)
  const hiddenIds = new Set(sel.hidden.map((h) => h.entry.id))
  const hiddenNames = hiddenNamesOf(sel.hidden.map((h) => h.entry))
  const names = (line: string): boolean => hiddenNames.some((n) => namedInProse(line, n))
  const byId = new Map<ID, EntryState>([
    ...input.memory.elsewhere.map((x) => [x.entry.id, x.entry] as const),
    ...input.memory.entries.map((e) => [e.id, e] as const)
  ])
  const nameOf = (id: ID): string | null => (hiddenIds.has(id) ? null : clean(byId.get(id)?.name) || null)
  const place = (w: string): string => shortPlace(w, input.story.title)
  const happened = happenedOf(input.memory.entries)
  // Everyone in the scene (the card, the stage, the scene so far), as who knows what has them; the living people only.
  const people = sceneKnowers(input, sel, stage)
  const living = people.filter((p) => isPerson(p) && !deathOf(p))

  // Everyone and everything in the scene, in full, each with all that has happened to them: the people here, then the
  // place, the card's plot threads, and the other entries the briefing names. An entry too long for the room left gives
  // its most recent history (RECENT_HISTORY), then none, rather than leaving the part empty (fitParts).
  const forms = (e: EntryState): string[] => {
    const profile = formatProfile(e, `### ${e.name} (${e.kind})`)
    const all = (e.happened ?? []).length
    const told = (last?: number): string =>
      [profile, happenedText(e, last), last != null && all > last ? `(The ${all - last} earlier changes are left out here.)` : '']
        .filter(Boolean)
        .join('\n\n')
    return [told(), ...RECENT_HISTORY.filter((n) => all > n).map((n) => told(n)), ...(all ? [profile] : [])]
  }
  const seen = new Set<ID>()
  const entries: EntryState[] = []
  const add = (e: EntryState | null | undefined): void => {
    if (!e || seen.has(e.id) || hiddenIds.has(e.id)) return
    seen.add(e.id)
    entries.push(e)
  }
  for (const p of people) add(p)
  add(sel.location)
  for (const t of sel.threads) add(t.entry)
  for (const c of sel.chosen.values()) if (c.entry.kind !== 'character') add(c.entry)

  const chapters = sources.chapters.flatMap((c) => {
    const lines = [...changedLines(c.snapshot, nameOf), ...endLines(c.snapshot, nameOf).map((l) => `At its end: ${l}`)]
      .map((l) => inChapter(l, c.label))
      .filter((l) => !names(l))
    if (!lines.length) return []
    const days = clean(c.snapshot.days)
    return [`### ${c.label}${days ? ` (${days})` : ''}\n${lines.map((l) => `- ${l}`).join('\n')}`]
  })
  const slips = (input.slips ?? [])
    .filter((l) => !l.entryIds.some((id) => hiddenIds.has(id)))
    .map((l) => `- ${lessonLine(l, place(l.where))}`)
  const findings = sources.findings
    .map(clean)
    .filter(Boolean)
    .map((f) => `- ${f}`)
  const lines = (list: string[]): string[] => list.filter((l) => !names(l))

  // In the order they are sent (what stays the same from step to step first); `rank`: who gets room left over first.
  const parts: Part[] = [
    { title: 'How each chapter so far ended (from the story record)', items: chapters, sep: '\n\n', share: 0.2, rank: 6 },
    { title: 'Everyone and everything in this scene, in full', items: entries.map(forms), sep: '\n\n', share: 0.3, rank: 4 },
    {
      title: 'Who knows what, among everyone here',
      items: lines(knowledgeLines(input.memory.facts, input.memory.beliefs ?? [], living, happened, nameOf, place).map((l) => `- ${l}`)),
      share: 0.15,
      rank: 0
    },
    { title: 'The story calendar', items: lines(calendarLines(input).map((l) => `- ${l}`)), share: 0.05, rank: 1 },
    { title: 'Slips put right in earlier scenes (never repeat them)', items: lines(slips), share: 0.05, rank: 2 },
    { title: 'Still open in this scene (found by the rule checks)', items: lines(findings), share: 0.03, rank: 3 },
    {
      title: PASSAGES_TITLE,
      items: (input.recall?.passages ?? []).map(
        (p) => `### ${place(p.where)}${p.kind === 'summary' ? ' (in short)' : ''}\n${p.text.trim()}`
      ),
      sep: '\n\n',
      share: 0.2,
      rank: 5
    }
  ]
  // The scene's contract is never cut: it is short, and the plan is checked against it; nor is the list of what Adam kept
  // out. They take their room first.
  const contract = prepared.contract ? contractText(prepared.contract) : ''
  const contractPart = contract ? [{ title: CONTRACT_TITLE, body: contract }] : []
  const leftOut = hiddenNames.length ? [{ title: LEFT_OUT_TITLE, body: `Never name these in the brief: ${hiddenNames.join('; ')}.` }] : []
  const fixed = [...contractPart, ...leftOut].reduce((n, p) => n + estimateTokens(`## ${p.title}\n${p.body}`), 0)
  const fitted = fitParts(parts, Math.max(0, sources.room - fixed))
  const tokens = sources.tokens
  return {
    book: sources.book?.length ? sources.book : null,
    ...(sources.book?.length && sources.bookFrom ? { bookFrom: sources.bookFrom } : {}),
    // The earlier passages change from step to step (the search reads the scene so far): sent after the words before.
    record: [...fitted.filter((p) => p.title !== PASSAGES_TITLE), ...leftOut],
    late: [...fitted.filter((p) => p.title === PASSAGES_TITLE), ...contractPart],
    words: Math.round(tokens / 1.35 / 50) * 50,
    tokens,
    ...(sources.tokensNoKnows != null && sources.tokensNoKnows !== tokens ? { tokensNoKnows: sources.tokensNoKnows } : {}),
    ...(hiddenNames.length ? { hidden: hiddenNames } : {})
  }
}

/** The names and other names of what Adam kept out, each once. */
const hiddenNamesOf = (entries: Pick<EntryState, 'name' | 'aliases'>[]): string[] => [
  ...new Set(
    entries
      .flatMap((e) => [e.name, ...(e.aliases ?? [])])
      .map(clean)
      .filter((n) => n.length >= 2)
  )
]

/**
 * The open plot threads, due or overdue first, for the planner in place of the writer's list: as many as the memory
 * model's room allows (openThreadsMost of its memoryScale: 6 to 22), never one Adam kept out of the scene's briefing.
 */
export function planThreads(input: ContextInput, memoryContext: number): string {
  const hidden = new Set(selectEntries(input).hidden.map((h) => h.entry.id))
  return openThreadsText(openThreadsAt(input.memory, input.scene.card, openThreadsMost(memoryScale(memoryContext)), hidden))
}

// ---------- The prompt ----------

/** The brief's lists, as the planner is asked for them. */
const BRIEF_ASK: Record<BriefPart, string> = {
  matters: 'what matters most for this scene: the facts, things, wounds, places and ties it touches.',
  keep: 'what must not be contradicted, each with where it was set or last changed, as you were given it ("since Ch 2, Sc 3"); never what people wore, where they were or how they lay as an earlier scene ended unless where things stand says it still holds here.',
  knows:
    'who knows what among the people here: what each knows that bears on the scene, what is kept from whom, and what someone believes wrongly.',
  promises: 'the plot threads and promises due now or in play here, and what has been set up for them.',
  time: 'how long since the events that matter here, from the story calendar, and ages where they matter.'
}

/**
 * The planner's instructions for the brief, added after the plan's own. The same for every scene (how long it may be is
 * said at the end of the request, `briefAsk`), so the instructions and the book so far after them stay in the cache.
 */
export const BRIEF_RULE = [
  '- brief: a continuity brief for the writer, from everything you were given (the book so far when it is there, how each chapter ended, everyone and everything here in full, who knows what, the plot threads, the story calendar, the slips, the earlier passages): only what bears on this scene, the whole scene even when you are asked to plan one beat (the brief is kept for its later beats), no longer than the request’s last line says, each line short and plain.',
  ...BRIEF_PARTS.map((p) => `  - ${p}: ${BRIEF_ASK[p]}`),
  '  Only what you were given, never a guess. Say nothing of what happens in this scene (that is the plan) and don’t repeat the scene card. Never name anything listed as left out by the author. A list with nothing for this scene is empty.'
].join('\n')

/** The request's last line with a brief: what to do, and how long the brief may be. */
export const briefAsk = (beat: boolean, words: number): string =>
  `Plan the ${beat ? 'beat' : 'scene'} and write its continuity brief (at most about ${words.toLocaleString('en-GB')} words) now, as one JSON object.`

/** The reply's shape with the brief. */
export const BRIEF_SHAPE = `"brief": {${BRIEF_PARTS.map((p) => `"${p}": [""]`).join(', ')}}`

/** Where the book so far runs, in words: "Ch 1, Sc 1 to Ch 4, Sc 2". */
const bookSpan = (book: BookScene[]): string => (book.length === 1 ? book[0].label : `${book[0].label} to ${book[book.length - 1].label}`)
/** How many words the book so far has. */
export const bookWords = (book: BookScene[]): number => book.reduce((n, s) => n + (s.text.match(/[\p{L}\p{N}’']+/gu) ?? []).length, 0)

/** The book so far's heading: the same at every scene (where it runs is said after its last scene, never before its first). */
export const BOOK_TITLE = '## The book so far, word for word'

/**
 * The book so far as the planner reads it, first in the request so a provider's cache can keep it: at the next scene it
 * reads the same up to its end, where one scene is added, so nothing that changes comes before it. `whole` false: a note
 * in its place, for the record kept in the world (the book is the scenes' own words, kept already).
 */
export function bookPart(book: BookScene[] | null, whole = true, from: string | null = null): string {
  if (!book?.length) return ''
  const title = from ? `${BOOK_TITLE}, from ${from} (how the chapters before it ended is in the record below)` : BOOK_TITLE
  if (!whole)
    return `${title}\n(${bookSpan(book)}, ${plural(bookWords(book), 'word')}, read whole. Not kept here, to save space: they are the scenes’ own words.)`
  return [title, ...book.map(sceneText), `${BOOK_END}${bookSpan(book)}.)`].join('\n\n')
}

/** How the book part's last line starts: it says where the book runs, so it changes at every scene (never cached). */
export const BOOK_END = '(The book so far ends here: '

// ---------- Reading and checking the brief ----------

export type RawBrief = Partial<Record<BriefPart, string[]>>

/** The reply's brief, read; null when there is none. A list may hold strings or objects with a `text`. */
export function readBrief(v: unknown): RawBrief | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const out: RawBrief = {}
  for (const p of BRIEF_PARTS) {
    const list = Array.isArray(o[p]) ? (o[p] as unknown[]) : typeof o[p] === 'string' ? [o[p]] : []
    const lines = list
      .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? String((x as Record<string, unknown>).text ?? '') : ''))
      .map((x) => clean(x).replace(/^[-•*]\s*/, ''))
      .filter(Boolean)
    if (lines.length) out[p] = lines
  }
  return Object.keys(out).length ? out : null
}

/** The chapters and scenes a text cites, as "Ch 3, Sc 2" or "Ch 3" ("Chapter 3, Scene 2" and a book's name before it alike). */
export function placesCited(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\bch(?:apter)?\.?\s*(\d+)(?:\s*[,:;]?\s*(?:sc(?:ene)?\.?\s*(\d+)))?/gi))
    out.push(m[2] ? `Ch ${m[1]}, Sc ${m[2]}` : `Ch ${m[1]}`)
  return out
}

/**
 * The brief, checked: each line cleaned and kept short, said once, left out when it cites a chapter or scene the planner
 * wasn't given (`material`: all it was given) or names something Adam kept out of the scene's briefing (`hidden`: names),
 * each list capped (BRIEF_MOST), and the whole kept to about `tokens`, or `tokensNoKnows` when it says nothing of who
 * knows what (who knows what then stays whole beside it, so the brief has less room: briefFrees). Lines go from the least
 * important lists first (TRIM_ORDER). Null when nothing is left.
 */
export function checkBrief(
  raw: RawBrief,
  o: { material: string; tokens: number; tokensNoKnows?: number; book?: boolean; hidden?: string[] }
): { brief: ContinuityBrief | null; dropped: number } {
  const hidden = (o.hidden ?? []).filter((n) => n.trim().length >= 2)
  const known = new Set(placesCited(o.material))
  // A scene cited is known when it was given, or its chapter was (a chapter's record cites its scenes as "Ch 3, Sc 2").
  const knows = (ref: string): boolean => known.has(ref) || (!ref.includes('Sc') && [...known].some((k) => k.startsWith(`${ref},`)))
  const seen = new Set<string>()
  const parts: ContinuityBrief['parts'] = {}
  let dropped = 0
  for (const p of BRIEF_PARTS) {
    for (const line of raw[p] ?? []) {
      const text = line.length > LONGEST_LINE ? `${line.slice(0, LONGEST_LINE - 1).trimEnd()}…` : line
      const key = text.toLowerCase()
      if (seen.has(key)) continue
      if (!placesCited(text).every(knows) || hidden.some((n) => namedInProse(text, n)) || (parts[p]?.length ?? 0) >= BRIEF_MOST[p]) {
        dropped++
        continue
      }
      seen.add(key)
      ;(parts[p] ??= []).push(text)
    }
  }
  // Kept to its size: the last line of the least important list goes first, a list keeping its first line as long as
  // another has more.
  const size = (): number => estimateTokens(BRIEF_PARTS.flatMap((p) => parts[p] ?? []).join('\n'))
  const most = Math.ceil((parts.knows?.length ? o.tokens : (o.tokensNoKnows ?? o.tokens)) * OVER)
  while (size() > most) {
    const from = TRIM_ORDER.find((p) => (parts[p]?.length ?? 0) > 1) ?? TRIM_ORDER.find((p) => (parts[p]?.length ?? 0) > 0)
    if (!from) break
    parts[from]!.pop()
    if (!parts[from]!.length) delete parts[from]
    dropped++
  }
  const any = BRIEF_PARTS.some((p) => parts[p]?.length)
  return { brief: any ? { parts, ...(o.book ? { book: true } : {}) } : null, dropped }
}
