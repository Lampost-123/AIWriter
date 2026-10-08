// The canon timeline (Adam, 2026-10-08: "The prose model should have a clear outline of what has happened so far in the
// story and when and involving who, so we do not get confusion and hallucinations ignoring canon"). In place of the
// prose summaries the writer was given (8.8k tokens in Add below, none in Continue), a compact outline of what happened
// before the point of writing, on this scene's own line only (the memory's StorySoFar: never a later scene, and
// prequels, side stories and own versions as the line has them):
// - the stories before this one, a line each;
// - this story's older chapters rolled up, a line each; the recent chapters a line per scene: when (the card's When),
//   where, who was there, and what happened, the most recent scenes in the most detail;
// - deaths, departures and things changing hands marked on the scene (or chapter) they happened in, from what has
//   happened to the entries (the memory's notes, with where);
// - "Leads into", when this story leads into a book.
// Capped (TIMELINE_WORDS), the oldest detail going first. Made from what the app already has: no model call. Its words
// depend only on scenes before this one, so it reads the same at every step of a scene (the cache). Pure.

import type { EntryState, ID } from '@shared/types'
import type { StorySoFar } from '../memory/types'
import { deathOf } from './deaths'
import { pastDeathNote } from './knows'

/** How many forms the timeline has, as the story-so-far block's levels: full, short, then smaller. */
export const TIMELINE_LEVELS = 6
/**
 * The most words at each level: about 2,500 tokens in full, 1,500 short, 800 smaller (Continue's form); then only the
 * most recent parts (RECENT_PARTS).
 */
export const TIMELINE_WORDS = [1850, 1100, 600, 600, 600, 600]
const RECENT_PARTS = [Infinity, Infinity, Infinity, 6, 2, 1]
/** Chapters told a scene at a time (the rest are rolled up a line each), and scenes told in the most detail. */
export const DETAILED = { chapters: 2, scenes: 5 }
/** Words of each kind of line, in detail and brief. */
const WORDS = { recent: 90, scene: 40, chapter: 60, story: 70, brief: 18, leads: 60 }
/** The most marks on a scene or a chapter. */
const MOST_MARKS = 3

export const TIMELINE_LEAD =
  'Canon: what has already happened, oldest first, the most recent last. It happened: never contradict it, and never write it again as if it were new.'

/** What the timeline needs besides the story so far. */
export interface TimelineContext {
  /** This story's title, left off the places in it. */
  storyTitle: string
  /** A name for an entry id (as of this scene), or null when not known. */
  name: (id: ID) => string | null
  /** The entries as of this scene, for what has happened to them (deaths, departures, things changing hands). */
  entries: Pick<EntryState, 'kind' | 'name' | 'happened'>[]
}

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()

/** The opening of a text, about `words` words, ending at a sentence when one ends in its second half. */
export function firstWords(text: string, words: number): string {
  const t = clean(text)
  const all = [...t.matchAll(/\S+/g)]
  if (all.length <= words) return t
  const cut = t.slice(0, (all[words - 1].index ?? 0) + all[words - 1][0].length)
  let best = -1
  for (const m of cut.matchAll(/[.!?…]["'”’)\]]*(?=\s|$)/g)) best = (m.index ?? 0) + m[0].length
  return best > cut.length / 2 ? cut.slice(0, best) : `${cut.replace(/[,;:]$/, '')}…`
}

const countWords = (s: string): number => (s.match(/\S+/g) ?? []).length

/** A place without this story's title ("Book 1, Ch 3, Sc 2" in Book 1 is "Ch 3, Sc 2"). */
const shortPlace = (where: string, storyTitle: string): string => {
  const w = clean(where)
  const t = clean(storyTitle)
  return t && w.startsWith(`${t}, `) ? w.slice(t.length + 2) : w
}

/** A departure, or something changing hands, in a note: what the timeline marks besides deaths. */
const LEAVES = /\b(left|leaves|departed|departs|went away|goes away|set off|sets off|rode (?:off|away|out)|drove (?:off|away|out)|sailed|fled|flees|parted|parts company)\b/i
const HANDS = /\b(gave|gives|given|handed|hands|sold|sells|lost|loses|stole|steals|stolen|took|takes|taken|received|receives|got back|returned|returns|left with|bought|buys|traded|trades)\b/i

/**
 * What the timeline marks at each place (a scene's or a chapter's label as the memory writes it): deaths ("Edric
 * died: in his chair"), departures and things changing hands, characters' first, at most MOST_MARKS a place.
 */
export function timelineMarks(entries: TimelineContext['entries']): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const put = (where: string, text: string): void => {
    const w = clean(where)
    if (!w || !text) return
    const list = out.get(w) ?? []
    if (!list.includes(text)) list.push(text)
    out.set(w, list)
  }
  const people = entries.filter((e) => e.kind === 'character')
  const things = entries.filter((e) => e.kind === 'item')
  for (const e of people) {
    const died = deathOf(e)
    for (const h of e.happened ?? []) {
      const note = clean(h.note).replace(/\.$/, '')
      if (!note) continue
      if (died && h.note.trim() === died.note) put(h.where, `${e.name} ${pastDeathNote(note).replace(/^(?:was|is)\s+/i, '')}`)
      else if (LEAVES.test(note) || HANDS.test(note)) put(h.where, `${e.name}: ${note}`)
    }
  }
  for (const e of things) {
    for (const h of e.happened ?? []) {
      const note = clean(h.note).replace(/\.$/, '')
      if (note && HANDS.test(note)) put(h.where, `${e.name}: ${note}`)
    }
  }
  for (const [k, v] of out) out.set(k, v.slice(0, MOST_MARKS))
  return out
}

/** One line of the timeline, with a fuller and a briefer form; `marks` are kept in both. */
interface Part {
  head: string
  detail: string
  brief: string
  marks: string[]
}

const lineOf = (p: Part, brief: boolean): string => {
  const text = brief ? p.brief : p.detail
  const marks = p.marks.length ? ` [${p.marks.join('; ')}]` : ''
  return `- ${p.head}${text ? `: ${text}` : ''}${marks}`
}

/** The order of this story's chapters (as the story so far gives them: by their summaries and their scenes'). */
function chapterOrder(s: StorySoFar): ID[] {
  const out: ID[] = []
  const add = (id: ID): void => {
    if (!out.includes(id)) out.push(id)
  }
  const told = s.chapters.map((c) => c.chapterId)
  const withScenes = new Set(s.scenes.map((x) => x.chapterId))
  let i = 0
  for (const sc of s.scenes) {
    const k = told.indexOf(sc.chapterId, i)
    if (k >= 0) while (i <= k) add(told[i++])
    else if (!out.includes(sc.chapterId)) {
      while (i < told.length && !withScenes.has(told[i])) add(told[i++])
      add(sc.chapterId)
    }
  }
  while (i < told.length) add(told[i++])
  return out
}

/**
 * The timeline at one level (0 full, 1 short, 2 smaller: Continue's; 3 to 5 only the most recent parts). Empty when
 * there is nothing before this scene.
 */
export function timelineText(s: StorySoFar, ctx: TimelineContext, level = 0): string {
  const lv = Math.max(0, Math.min(TIMELINE_LEVELS - 1, level))
  const marks = timelineMarks(ctx.entries)
  const place = (w: string): string => shortPlace(w, ctx.storyTitle)
  const parts: Part[] = []

  // The stories before this one on the line; from level 2 a series roll-up stands in for the stories it covers.
  const rolled = new Set<ID>()
  for (const st of s.stories) {
    if (!clean(st.text) || rolled.has(st.storyId)) continue
    const rollup = lv >= 2 ? s.series.find((r) => clean(r.text) && r.storyIds.includes(st.storyId)) : undefined
    if (rollup) {
      rollup.storyIds.forEach((id) => rolled.add(id))
      parts.push({ head: rollup.name, detail: firstWords(rollup.text, WORDS.story), brief: firstWords(rollup.text, WORDS.brief), marks: [] })
      continue
    }
    const head = st.meanwhile ? `Meanwhile, ${st.title}` : st.cut ? `${st.title}, up to where this story starts` : st.title
    parts.push({ head, detail: firstWords(st.text, WORDS.story), brief: firstWords(st.text, WORDS.brief), marks: [] })
  }

  // This story: older chapters a line each, the recent ones a line a scene.
  const scenes = s.scenes.filter((x) => clean(x.text))
  const order = chapterOrder(s)
  const recentChapters = new Set(order.filter((id) => scenes.some((x) => x.chapterId === id)).slice(-DETAILED.chapters))
  const lastScenes = new Set(scenes.slice(-DETAILED.scenes).map((x) => x.sceneId))
  const chapters = new Map(s.chapters.filter((c) => clean(c.text)).map((c) => [c.chapterId, c]))
  const sceneMarks = (label: string): string[] => marks.get(clean(label)) ?? []
  for (const chapterId of order) {
    const own = scenes.filter((x) => x.chapterId === chapterId)
    const chapter = chapters.get(chapterId)
    if (chapter && !recentChapters.has(chapterId)) {
      const all = [...sceneMarks(chapter.label), ...own.flatMap((x) => sceneMarks(x.label))].slice(0, MOST_MARKS)
      parts.push({ head: place(chapter.label), detail: firstWords(chapter.text, WORDS.chapter), brief: firstWords(chapter.text, WORDS.brief), marks: all })
      continue
    }
    for (const x of own) {
      const bits = [place(x.label)]
      if (clean(x.when)) bits.push(clean(x.when))
      const where = x.whereId ? ctx.name(x.whereId) : null
      if (where) bits.push(where)
      const who = (x.whoIds ?? []).map((id) => ctx.name(id)).filter((n): n is string => !!n)
      const head = `${bits.join(', ')}${who.length ? ` (${who.join(', ')})` : ''}`
      parts.push({
        head,
        detail: firstWords(x.text, lastScenes.has(x.sceneId) ? WORDS.recent : WORDS.scene),
        brief: firstWords(x.text, WORDS.brief),
        marks: sceneMarks(x.label)
      })
    }
  }

  // Within the cap, the oldest detail goes first: older lines made brief, then the oldest left out.
  const cap = TIMELINE_WORDS[lv]
  const keep = RECENT_PARTS[lv]
  let from = Math.max(0, parts.length - keep)
  const brief = parts.map(() => lv >= 3)
  const words = (): number => parts.slice(from).reduce((n, p, i) => n + countWords(lineOf(p, brief[from + i])), 0)
  for (let i = from; i < parts.length && words() > cap; i++) brief[i] = true
  while (from < parts.length - 1 && words() > cap) from++

  const out: string[] = []
  if (!parts.length) return ''
  out.push(TIMELINE_LEAD)
  if (from > 0) out.push(`(The ${from === 1 ? 'oldest part is' : `oldest ${from} parts are`} left out here to save space.)`)
  out.push(parts.slice(from).map((p, i) => lineOf(p, brief[from + i])).join('\n'))

  if (s.leadsInto && clean(s.leadsInto.text) && lv < 4) {
    const t = s.leadsInto.title
    out.push(
      `### Leads into ${t}\nThis story leads into ${t}, which begins like this: a target to steer towards over the story, not events to mention or bring about in this scene.\n${firstWords(s.leadsInto.text, lv === 0 ? WORDS.leads * 2 : WORDS.leads)}`
    )
  }
  return out.join('\n\n')
}
