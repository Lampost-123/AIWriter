// The continuity brief before each scene, the planner's side (long story memory fix 14, 2026-10-16; trimmed 2026-10-20; the
// writer's side is ai/brief.ts). The plan before writing (plan.ts) is the memory model's call already made before each
// draft; with a brief it reads more than the writer could and gives back, besides the plan, a short brief of what matters
// for the scene. No new call: the plan's grows.
//
// What it reads, besides what the plan always read (the scene card, what must stay true, where things stand and everyone
// here as the story index has them, what happened in this chapter and the one before, the codex's names):
// - each earlier chapter in short (its summary; a chapter not yet summed up, its scenes' gists), the oldest left out first
//   when there is no room, never a chapter "Already happened" tells scene by scene;
// - the scene before and the scene so far, word for word (a long one from where its last stretch starts);
// - everyone and everything in the scene: each person here (the card, the stage, the scene so far) with who they are, how
//   they look and what they want, the place, the card's plot threads and the few entries the scene names, each with its
//   last few changes (the rest: get_entry);
// - who knows what among the people here: only what not everyone here knows, and who believes what wrongly, the newest
//   first and capped (the rest: who_knows);
// - every plot thread still open, due or overdue first (fix 10), in place of the writer's capped list;
// - the story calendar: this scene's date, how long since each earlier day worth counting from, and ages (fix 11);
// - the slips the checks found in earlier scenes and that were put right (fix 7), and the rule checks' findings still
//   open in this scene (fix 8);
// - after the words just before (they change from step to step): the scene so far, the first few earlier passages the
//   search found, and the scene's contract (fix 13).
// Anything else it looks up in the plan's one round of look-ups (ai/lookups/): an earlier scene's own words
// (read_passage), a codex entry in full (get_entry), who knows something (who_knows).
//
// Why not the whole book (2026-10-20): a live DeepSeek Flash run of the trap story (30 scenes, about 60,000 words) sent the
// book so far word for word with every plan, and a record of up to 40,000 tokens beside it: about 85,000 tokens a request,
// sent with the look-ups and again with the answer, so its six plans were a third of all the run's tokens. What came before
// is now told in short, what is near word for word, from the record what bears on the scene, and the rest is a look-up
// away: about a fifth of the size.
//
// The record is fitted to the room the memory model has (RECORD_SHARE of what it reads, at most RECORD_MOST), each part
// to its share first and the rest given out by how much each matters. The brief comes back as five short lists, which
// the app checks (checkBrief): a line citing a chapter or scene the planner wasn't given or didn't look up is left out,
// each list is capped, and the whole is kept to its size. Pure.

import type { BeliefState, ContextPreview, EntryState, FactState, ID } from '@shared/types'
import { learnedWords } from '@shared/knowWords'
import { namedInProse } from '@shared/names'
import {
  formatProfile,
  happenedText,
  sceneKnowers,
  sceneTail,
  selectEntries,
  toldStage,
  WHY,
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
import { clip, wholeSentences } from '../ai/lookups/text'
import { lessonLine } from '../checks/lessons'
import { ageWords, dateLabel, elapsedBetween, elapsedWords } from '../memory/calendar'
import { estimateTokens } from '../keeper/text'

/** The share of what the memory model reads that the plan's prompt may fill (its own parts and the record). */
export const RECORD_SHARE = 0.5
/**
 * The most tokens of record (the chapters in short, the scenes around this one word for word, what bears on the scene) the
 * planner is given, however much it reads (2026-10-20: 40,000 before, beside the whole book so far).
 */
export const RECORD_MOST = 11_000
/** All that the plan reads and writes stays within this share of what the memory model reads, or no brief. */
export const WHOLE_SHARE = 0.9
/** The reply's room for the brief, as a share of the brief's own size (JSON and the odd longer line). */
export const BRIEF_REPLY_SHARE = 1.3
/** How long a draft waits for a plan with a brief (it reads and writes more; the plan alone keeps its 60 s). */
export const BRIEF_LIMIT_MS = 90_000
/** The most lines of each part the brief keeps. */
export const BRIEF_MOST: Record<BriefPart, number> = { matters: 8, keep: 12, knows: 10, promises: 6, time: 6 }
/** The longest a line of the brief is kept, in characters. */
const LONGEST_LINE = 320
/** When the brief runs over its size, lines go from these parts first (the last line of each in turn). */
const TRIM_ORDER: readonly BriefPart[] = ['promises', 'time', 'matters', 'knows', 'keep']
/** The brief may run this much over the size it was asked for before lines are left out. */
const OVER = 1.2

/**
 * How many words of the scene before and of the scene so far the planner reads, longest first: a longer scene is read from
 * where its last stretch of about that many starts (at a paragraph where it can), and fitParts takes a shorter form when
 * the longer won't fit.
 */
export const SCENE_WORDS = { previous: [2_000, 800, 300], soFar: [3_000, 1_200, 400] } as const
/** How much of an entry's history the planner reads: its most recent changes, then fewer (the rest: get_entry). */
export const ENTRY_HISTORY = [6, 3] as const
/** The most entries besides the people here, the place and the card's threads: those the scene itself names. */
export const OTHER_ENTRIES_MOST = 6
/** A character's fields the planner reads: who they are, how they look, what they want (not their voice or past). */
const CHARACTER_GROUPS = ['basics', 'looks', 'arc']
/** Who knows what: the most facts not everyone here knows, the most wrong beliefs, and the longest fact in characters. */
export const KNOWS_MOST = { facts: 12, beliefs: 6, fact: 180 }
/** The most earlier passages found by searching (the writer gets 5 to 10; more are a look-up away). */
export const PASSAGES_MOST = 6
/** The longest an earlier chapter's summary is in its shorter form, in characters (whole sentences). */
const CHAPTER_SHORT = 400
/** A chapter with no summary yet: each of its scenes' gists, at most this long (whole sentences). */
const GIST_MOST = 300

const PASSAGES_TITLE = 'Earlier passages found by searching the story (best first)'
const CONTRACT_TITLE = 'This scene’s contract'
/** The direction in the planner's copy of the contract: it reads it in full under what is being written. */
const SAID_PLAN = 'What the author directs, as given under "What is being written".'
const LEFT_OUT_TITLE = 'Left out by the author'
export const CHAPTERS_TITLE = 'The story so far, chapter by chapter (in short)'
const CHAPTERS_LEAD =
  'What happened in each earlier chapter, in short (the last chapters are under "Already happened", scene by scene). You don’t have the earlier scenes’ own words: look up any you need (read_passage).'
export const PREVIOUS_TITLE = 'The scene before, word for word'
export const SO_FAR_TITLE = 'The scene so far, word for word'
export const PEOPLE_TITLE = 'Everyone and everything in this scene'
export const KNOWS_TITLE = 'Who knows what, among everyone here'

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
const plural = (n: number, one: string): string => `${n.toLocaleString('en-GB')} ${one}${n === 1 ? '' : 's'}`
const wordCount = (text: string): number => (text.match(/[\p{L}\p{N}’']+/gu) ?? []).length

// ---------- What the planner is given ----------

/** What the world gives the brief besides the briefing's own input (plan/index.ts). */
export interface BriefSources {
  /** The rule checks' findings still open in this scene (fix 8), as Adam sees them. */
  findings: string[]
  /** The chapters the plan's "Already happened" tells scene by scene ("Ch 6"): not told again in short. Left out: none. */
  covered?: string[]
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
  /** The same at every step of the scene (the chapters in short, the scene before): marked for a provider's cache. */
  steady?: boolean
  /**
   * A scene's own words: the scene before or the scene so far, and how many words were sent. The record kept in the world
   * has a note in their place (partText).
   */
  scene?: { of: 'previous' | 'soFar'; words: number }
}

/** What the planner reads for the brief, and how long the brief may be. */
export interface BriefMaterial {
  /** The record that stays the same from one step of a scene to the next, sent before the scene card. */
  record: BriefPartText[]
  /** What changes from step to step (the scene so far, the earlier passages found, the scene's contract), sent last. */
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
 * The record's room in tokens: RECORD_SHARE of what the memory model reads, less the plan's own prompt (`base`) and the
 * room kept for its reply, at most RECORD_MOST; none when there is no room.
 */
export function briefRoom(o: { contextLength: number; base: number; reply: number }): number {
  const n = Math.max(0, o.contextLength)
  return Math.max(0, Math.min(RECORD_MOST, Math.floor(n * RECORD_SHARE) - o.base - o.reply))
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
  /** The items come newest first (the newest are kept first) and are shown oldest first, in reading order. */
  newestFirst?: boolean
  /** The line said after the items when some were left out (`left`: how many), saying how to look them up; counted. */
  more?: (left: number) => string
}

const formsOfItem = (item: string | string[]): string[] => (Array.isArray(item) ? item.filter(Boolean) : [item])
const bodyOf = (p: Part, chosen: string[]): string => {
  const shown = p.newestFirst ? [...chosen].reverse() : chosen
  const left = p.items.length - chosen.length
  return [p.lead ?? '', shown.join(p.sep ?? '\n'), left > 0 && p.more ? p.more(left) : ''].filter(Boolean).join('\n')
}

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

/** The chapter a place is in ("Ch 3" for "Ch 3, Sc 2"), or the place itself. */
const chapterOfPlace = (label: string): string => /^(.*?\bCh \d+)\b/.exec(label)?.[1] ?? label

/**
 * Who knows what among the people here, as bears on the scene: each fact someone here knows that someone else here
 * doesn't (never "not known by" someone it is about, nor where who knows it doesn't rest on who was there, as the writer's
 * block), the newest first, at most KNOWS_MOST.facts, then what someone here believes wrongly, at most KNOWS_MOST.beliefs.
 * `left`: how many it left out (known by everyone here, or older), for the note on looking them up.
 */
function knowledgeLines(
  facts: FactState[],
  beliefs: BeliefState[],
  people: EntryState[],
  happened: ReturnType<typeof happenedOf>,
  nameOf: (id: ID) => string | null,
  place: (w: string) => string,
  free: (line: string) => boolean
): { lines: string[]; left: number } {
  const ids = new Set(people.map((p) => p.id))
  const name = (id: ID): string => people.find((p) => p.id === id)?.name ?? nameOf(id) ?? ''
  const whoOf = (list: ID[], since: (id: ID) => Parameters<typeof learnedWords>[0]): string =>
    list
      .filter((id) => ids.has(id))
      .map((id) => {
        const when = learnedWords(since(id), nameOf, place)
        return `${name(id)}${when ? ` (${when})` : ''}`
      })
      .join(', ')
  const lines: string[] = []
  let left = 0
  // Newest learning first, as the writer's block has it.
  const known = cleanKnows(facts, { happened })
    .filter((f) => f.knownBy.some((id) => ids.has(id)) && clean(f.fact))
    .sort((a, b) => (b.at ?? -2) - (a.at ?? -2))
  let facts_ = 0
  for (const f of known) {
    // Everyone here knows it (or it is about them), or who knows it doesn't rest on who was there: nothing kept here.
    const not = f.backed === false ? [] : people.filter((p) => !f.knownBy.includes(p.id) && !namesPerson(f.fact, p)).map((p) => p.name)
    if (!not.length || facts_ >= KNOWS_MOST.facts) {
      left++
      continue
    }
    const line = `- ${clip(clean(f.fact).replace(/[.]+$/, ''), KNOWS_MOST.fact)}: known by ${whoOf(f.knownBy, (id) => f.since?.[id])}; not known by ${not.join(', ')}`
    if (!free(line)) continue
    lines.push(line)
    facts_++
  }
  let wrong = 0
  for (const b of [...beliefs].sort((x, y) => y.at - x.at)) {
    const who = whoOf(b.believedBy, (id) => b.since[id])
    if (!who || !clean(b.fact)) continue
    if (wrong >= KNOWS_MOST.beliefs) {
      left++
      continue
    }
    const line = `- Wrongly believed by ${who}: ${clip(clean(b.fact).replace(/[.]+$/, ''), KNOWS_MOST.fact)} (it isn't true)`
    if (!free(line)) continue
    lines.push(line)
    wrong++
  }
  return { lines, left }
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

/**
 * Each earlier chapter of this story in short, newest first (fitParts keeps the newest and shows them in reading order):
 * its summary, citing its scenes as the rest of the record does ("Ch 3, Sc 2"), or, with none yet, its scenes' gists.
 * Never a chapter `covered` (told scene by scene under "Already happened"), nor one naming what Adam kept out.
 */
function chapterItems(input: ContextInput, covered: ReadonlySet<string>, free: (line: string) => boolean): string[][] {
  const sf = input.memory.storySoFar
  const place = (w: string): string => shortPlace(w, input.story.title)
  const summed = new Map<string, string>()
  for (const c of sf.chapters) {
    const label = place(c.label)
    if (clean(c.text) && !covered.has(label)) summed.set(label, inChapter(clean(c.text), label))
  }
  // A chapter with no summary yet: its scenes' gists, in the order they come.
  const gists = new Map<string, string[]>()
  for (const s of sf.scenes) {
    const label = place(s.label)
    const ch = chapterOfPlace(label)
    if (!clean(s.text) || ch === label || covered.has(ch) || summed.has(ch)) continue
    gists.set(ch, [...(gists.get(ch) ?? []), `- ${label}: ${wholeSentences(inChapter(s.text, ch), GIST_MOST)}`])
  }
  const order = [...new Set([...sf.scenes.map((s) => chapterOfPlace(place(s.label))), ...summed.keys()])]
  const items = order.flatMap((ch): string[][] => {
    const text = summed.get(ch)
    if (text) {
      if (!free(text)) return []
      const short = wholeSentences(text, CHAPTER_SHORT)
      return [[`### ${ch}\n${text}`, ...(short && short !== text ? [`### ${ch} (shorter)\n${short}`] : [])]]
    }
    const lines = (gists.get(ch) ?? []).filter(free)
    return lines.length ? [[`### ${ch} (no summary of the chapter yet: its scenes)\n${lines.join('\n')}`]] : []
  })
  return items.reverse()
}

/** A scene's words from where its last stretch of about each size starts (the whole when it is shorter), longest first. */
function sceneForms(text: string, sizes: readonly number[]): string[] {
  const whole = text.trim()
  const tails: string[] = []
  for (const n of sizes) {
    const t = sceneTail(whole, { min: Math.round(n * 0.75), target: n, max: n })
    if (t && !tails.includes(t)) tails.push(t)
  }
  return tails.map((t) => (t.length < whole.length ? `(Its earlier part is left out here: look it up if you need it.)\n"""\n${t}\n"""` : `"""\n${t}\n"""`))
}

/**
 * The record the planner reads for the brief, fitted to `sources.room` (see the top of this file). `prepared`: the
 * briefing as fitted before the plan, for the scene's contract. What Adam kept out of the scene's briefing (a 'hide' pin)
 * is never in it: not as an entry, a knower, a thread, nor in a line naming it (the planner is told their names, so the
 * brief leaves them out too: checkBrief); the scenes' own words keep them.
 */
export function briefMaterial(input: ContextInput, prepared: Pick<PreparedContext, 'contract'>, sources: BriefSources): BriefMaterial {
  const sel = selectEntries(input)
  const stage = toldStage(input)
  const hiddenIds = new Set(sel.hidden.map((h) => h.entry.id))
  const hiddenNames = hiddenNamesOf(sel.hidden.map((h) => h.entry))
  const free = (line: string): boolean => !hiddenNames.some((n) => namedInProse(line, n))
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

  // Everyone and everything in the scene: the people here, then the place, the card's plot threads, and the few other
  // entries the scene itself names (its card, Adam's direction, the scene so far or the end of the one before, a pin, the
  // plan), each with its most recent changes (ENTRY_HISTORY; the rest is a look-up away), then fewer, then none.
  const forms = (e: EntryState): string[] => {
    const profile = formatProfile(e, `### ${e.name} (${e.kind})`, e.kind === 'character' ? CHARACTER_GROUPS : undefined)
    const all = (e.happened ?? []).filter((h) => clean(h.note)).length
    const told = (last: number): string =>
      [profile, happenedText(e, last), all > last ? `(${plural(all - last, 'earlier change')} left out here: get_entry has them.)` : '']
        .filter(Boolean)
        .join('\n\n')
    return [told(ENTRY_HISTORY[0]), ...ENTRY_HISTORY.slice(1).filter((n) => all > n).map((n) => told(n)), ...(all ? [profile] : [])]
  }
  const seen = new Set<ID>()
  const entries: EntryState[] = []
  const add = (e: EntryState | null | undefined): boolean => {
    if (!e || seen.has(e.id) || hiddenIds.has(e.id)) return false
    seen.add(e.id)
    entries.push(e)
    return true
  }
  for (const p of people) add(p)
  add(sel.location)
  for (const t of sel.threads) add(t.entry)
  const namedHere = new Set<string>([WHY.card, WHY.beats, WHY.notes, WHY.cardWords, WHY.direction, WHY.soFar, WHY.previous, WHY.plan, ...Object.values(WHY.pin)])
  let others = 0
  for (const c of sel.chosen.values()) {
    if (others >= OTHER_ENTRIES_MOST) break
    if (c.entry.kind !== 'character' && namedHere.has(c.why) && add(c.entry)) others++
  }

  const slips = (input.slips ?? [])
    .filter((l) => !l.entryIds.some((id) => hiddenIds.has(id)))
    .map((l) => `- ${lessonLine(l, place(l.where))}`)
  const findings = sources.findings
    .map(clean)
    .filter(Boolean)
    .map((f) => `- ${f}`)
  const lines = (list: string[]): string[] => list.filter(free)
  const knows = knowledgeLines(input.memory.facts, input.memory.beliefs ?? [], living, happened, nameOf, place, free)

  // The scene before and the scene so far, word for word (a long one from where its last stretch starts).
  const prev = input.memory.previous
  const prevText = prev?.text.trim() ?? ''
  const prevHead = [place(clean(prev?.label)), clean(prev?.title)].filter(Boolean).join(': ')
  const soFar = input.soFar?.trim() ?? ''

  // In the order they are sent (what stays the same from step to step first); `rank`: who gets room left over first.
  const parts: Part[] = [
    {
      title: CHAPTERS_TITLE,
      lead: CHAPTERS_LEAD,
      items: chapterItems(input, new Set(sources.covered ?? []), free),
      sep: '\n\n',
      share: 0.14,
      rank: 5,
      newestFirst: true,
      more: (n) => `(${plural(n, 'earlier chapter')} left out here for room: what_happened tells their scenes.)`
    },
    {
      title: prevHead ? `${PREVIOUS_TITLE} (${prevHead})` : PREVIOUS_TITLE,
      items: prevText ? [sceneForms(prevText, SCENE_WORDS.previous)] : [],
      share: 0.22,
      rank: 3
    },
    { title: PEOPLE_TITLE, items: entries.map(forms), sep: '\n\n', share: 0.2, rank: 4 },
    {
      title: KNOWS_TITLE,
      items: knows.lines,
      share: 0.1,
      rank: 1,
      more: (n) => `(Not listed: ${plural(n + knows.left, 'more fact')} known here, by everyone here or older: who_knows has them.)`
    },
    { title: 'The story calendar', items: lines(calendarLines(input).map((l) => `- ${l}`)), share: 0.03, rank: 2 },
    { title: 'Slips put right in earlier scenes (never repeat them)', items: lines(slips), share: 0.03, rank: 6 },
    { title: 'Still open in this scene (found by the rule checks)', items: lines(findings), share: 0.02, rank: 7 },
    {
      title: PASSAGES_TITLE,
      items: (input.recall?.passages ?? [])
        .slice(0, PASSAGES_MOST)
        .map((p) => `### ${place(p.where)}${p.kind === 'summary' ? ' (in short)' : ''}\n${p.text.trim()}`),
      sep: '\n\n',
      share: 0.09,
      rank: 8
    },
    { title: SO_FAR_TITLE, items: soFar ? [sceneForms(soFar, SCENE_WORDS.soFar)] : [], share: 0.17, rank: 0 }
  ]
  // Who knows what says what it left out even when every line it has fits (as one more line, its room counted).
  const knowsPart = parts[3]
  if (knows.left && knows.lines.length) {
    const note = `(Not listed: ${plural(knows.left, 'more fact')} known here, by everyone here or older: who_knows has them.)`
    knowsPart.items = [...knows.lines.slice(0, -1), [`${knows.lines[knows.lines.length - 1]}\n${note}`, knows.lines[knows.lines.length - 1]]]
  }

  // The scene's contract is never cut: it is short, and the plan is checked against it; nor is the list of what Adam kept
  // out. They take their room first.
  // Adam's direction is said once (2026-10-19), under what is being written: a whole scene's too, since the writer's scene
  // card no longer says it (a beat's contract has no ask of the direction to point to).
  const said = [{ text: clean(input.options.direction), as: SAID_PLAN }]
  const contract = prepared.contract ? contractText(prepared.contract, { said }) : ''
  const contractPart = contract ? [{ title: CONTRACT_TITLE, body: contract }] : []
  const leftOut = hiddenNames.length ? [{ title: LEFT_OUT_TITLE, body: `Never name these in the brief: ${hiddenNames.join('; ')}.` }] : []
  const fixed = [...contractPart, ...leftOut].reduce((n, p) => n + estimateTokens(`## ${p.title}\n${p.body}`), 0)
  const fitted = fitParts(parts, Math.max(0, sources.room - fixed))
  const of = (i: number): BriefPartText[] => {
    const p = fitted.find((f) => f.title === parts[i].title)
    if (!p) return []
    if (i === 0) return [{ ...p, steady: true }]
    if (i === 1) return [{ ...p, steady: true, scene: { of: 'previous', words: wordCount(p.body) } }]
    if (i === 8) return [{ ...p, scene: { of: 'soFar', words: wordCount(p.body) } }]
    return [p]
  }
  const tokens = sources.tokens
  return {
    // What stays the same through the scene first (the chapters in short, the scene before), then what the memory's
    // reading of each step may change (everyone here, who knows what), then the rest of the record.
    record: [...[0, 1, 2, 3, 4, 5, 6].flatMap(of), ...leftOut],
    // The scene so far and the earlier passages change from step to step (the search reads the scene so far): sent last.
    late: [...of(8), ...of(7), ...contractPart],
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
 * said at the end of the request, `briefAsk`), so the instructions and the record after them stay in a provider's cache.
 */
export const BRIEF_RULE = [
  '- brief: a continuity brief for the writer, from everything you were given or looked up (the chapters so far in short, the scene before and the scene so far word for word, everyone and everything here, who knows what, the plot threads, the story calendar, the slips, the earlier passages): only what bears on this scene, the whole scene even when you are asked to plan one beat (the brief is kept for its later beats), no longer than the request’s last line says, each line short and plain.',
  ...BRIEF_PARTS.map((p) => `  - ${p}: ${BRIEF_ASK[p]}`),
  '  Only what you were given or looked up, never a guess. Say nothing of what happens in this scene (that is the plan) and don’t repeat the scene card. Never name anything listed as left out by the author. A list with nothing for this scene is empty.'
].join('\n')

/** The request's last line with a brief: what to do, and how long the brief may be. */
export const briefAsk = (beat: boolean, words: number): string =>
  `Plan the ${beat ? 'beat' : 'scene'} and write its continuity brief (at most about ${words.toLocaleString('en-GB')} words) now, as one JSON object.`

/** The reply's shape with the brief. */
export const BRIEF_SHAPE = `"brief": {${BRIEF_PARTS.map((p) => `"${p}": [""]`).join(', ')}}`

/**
 * A part of the brief's record as the request has it, or '' for an empty one. `whole` false: a scene's own words as a note
 * in their place, for the record kept in the world (they are the scene's own words, kept already).
 */
export function partText(p: BriefPartText, whole = true): string {
  const body = p.body.trim()
  if (!body) return ''
  if (whole || !p.scene) return `## ${p.title}\n${body}`
  return `## ${p.title}\n(${plural(p.scene.words, 'word')}, read word for word. Not kept here, to save space: they are the scene’s own words.)`
}

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
 * wasn't given (`material`: all it was given and looked up; a chapter counts when it was told in short or any of its
 * scenes was given) or names something Adam kept out of the scene's briefing (`hidden`: names),
 * each list capped (BRIEF_MOST), and the whole kept to about `tokens`, or `tokensNoKnows` when it says nothing of who
 * knows what (who knows what then stays whole beside it, so the brief has less room: briefFrees). Lines go from the least
 * important lists first (TRIM_ORDER). Null when nothing is left.
 */
export function checkBrief(
  raw: RawBrief,
  o: { material: string; tokens: number; tokensNoKnows?: number; hidden?: string[] }
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
  return { brief: any ? { parts } : null, dropped }
}
