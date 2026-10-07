// What step 5 adds to one scene's briefing (Adam, 2026-10-07; consistency plan, step 5): the entries of the last two
// scenes ("sticky"), what was said word for word, and earlier passages, summaries and codex facts found by searching
// for what the scene is about, by keyword and (once the search model is downloaded) by meaning, the two joined by
// reciprocal rank fusion. Only what comes before the scene on its story's line is ever searched (the same line the
// memory uses, so series, prequels and what-ifs keep apart). Retrieval adds candidates; the briefing's priority order
// and budget still decide what is sent. Never throws for a search problem: what can't be searched is left out.

import type Database from 'better-sqlite3'
import type { EntryState, FactState, ID, SceneCard, Summary } from '@shared/types'
import type { ContextInput } from '../ai/context'
import { sceneTail } from '../ai/context'
import { listAllChanges, listSummaries, loadShape } from '../db/memory'
import { saidChanges, scenesCardsAndText, type SaidChange } from '../db/retrieval'
import { buildLine, labeler, storyOfScene } from '../memory/line'
import type { Line } from '../memory/types'
import { fuse, KeywordIndex, nearest, type Ranked } from './rank'
import { saidLines, type SaidTime } from './said'
import { STICKY_SCENES, stickyEntries } from './sticky'
import type { SearchIndex, StoredPassage } from './store'
import { countWords, searchWords, terms, textHash } from './text'
import { plain } from '../keeper/text'
import type { Embedder, RecallInput, RecalledPassage } from './types'
import { Vectors } from './vectors'

type DB = Database.Database

/** Nothing added (switched off, or the scene isn't in the world). */
export const NOTHING: RecallInput = { sticky: [], found: [], passages: [], said: [] }

/** How many entries searching adds at most, and how many passages and summaries it offers. */
export const FOUND_MOST = 6
export const PASSAGES_MOST = 6
/** Each ranked list keeps this many. */
const LIST_SIZE = 12
/** A keyword find must score at least this share of the best one in its list. */
const KEYWORD_KEEP = 0.3
/** How long the search model may take over one search before keyword search goes ahead alone. */
export const MEANING_WAIT_MS = 6000

export interface RecallDeps {
  db: DB
  /** The world's search index, or null when there is none (passages can't be searched then). */
  index: SearchIndex | null
  /** The search model, or null: keyword search only (not downloaded, switched off, or not working). */
  embedder: Embedder | null
  /** The open world's vectors (kept between searches, each text read once). */
  vectors?: Vectors
  /** Stops this search (the draft was stopped). */
  signal?: AbortSignal
  /** Stops the background reading this search starts (the world closing). */
  background?: AbortSignal
  meaningWaitMs?: number
}

// ---------- What is searched for ----------

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()

/** The last `n` words of a text. */
function lastWordsOf(text: string, n: number): string {
  const words = clean(text).split(' ')
  return words.length <= n ? words.join(' ') : words.slice(-n).join(' ')
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A search without these names in it: searching the codex for the people already on the card would find every fact
 * about them, so their names are left out of that search (passages keep them: who is together matters there).
 */
export function withoutNames(text: string, names: string[]): string {
  let out = text
  for (const n of names.map((x) => x.trim()).filter((x) => x.length >= 2)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n).replace(/\s+/g, '\\s+')}(?:['’]s)?(?![\\p{L}\\p{N}])`, 'giu'), ' ')
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** The first `n` words of a text. */
const firstWordsOf = (text: string, n: number): string => clean(text).split(' ').slice(0, n).join(' ')

/**
 * What to search for, as separate parts (each searched on its own and the finds joined, so one long beat doesn't
 * drown the rest): the scene's title and shape, its notes, each beat, Adam's direction, and the end of the scene so far
 * (or, starting a scene, the end of the scene before).
 */
export function queryParts(input: Pick<ContextInput, 'scene' | 'options' | 'memory'>, soFar = ''): string[] {
  const card: SceneCard = input.scene.card
  const parts = [
    [input.scene.title, card.goal, card.conflict, card.outcome].map(clean).filter(Boolean).join('. '),
    clean(card.notes),
    ...(card.beats ?? []).slice(0, 10).map(clean),
    clean(input.options.direction),
    soFar.trim() ? lastWordsOf(soFar, 120) : lastWordsOf(input.memory.previous?.text ?? '', 80)
  ]
  const out: string[] = []
  for (const p of parts) {
    const t = firstWordsOf(p, 200)
    if (t && terms(t).length && !out.includes(t)) out.push(t)
  }
  return out
}

// ---------- What is searched ----------

/** A codex fact as of this scene, to search: an entry's profile, something that happened to it, a tie, something said. */
export interface FactDoc {
  key: string
  text: string
  /** The entries it is about. */
  entryIds: ID[]
  /** For something said: its fact. */
  saidFactId?: ID
}

const PROFILE_WORDS = 150

/**
 * The codex facts as of this scene, to search (only what is true here: `memory` is as of this scene). Entries already
 * on the scene card are left out (they are in the briefing anyway), except in what was said.
 */
export function factDocs(
  memory: { entries: EntryState[]; relationships: ContextInput['memory']['relationships']; facts: FactState[] },
  onCard: Set<ID>,
  saidFactIds: Set<ID>
): FactDoc[] {
  const out: FactDoc[] = []
  const name = new Map(memory.entries.map((e) => [e.id, e.name]))
  for (const e of memory.entries) {
    if (onCard.has(e.id)) continue
    const fields = Object.entries(e.fields ?? {})
      .filter(([k, v]) => k !== 'sampleLines' && clean(v))
      .map(([, v]) => clean(v))
    const profile = [e.name, ...(e.aliases ?? []), e.summary, e.description, ...fields].map(clean).filter(Boolean).join('. ')
    out.push({ key: `entry:${e.id}`, text: firstWordsOf(profile, PROFILE_WORDS), entryIds: [e.id] })
    for (const h of e.happened ?? []) {
      if (clean(h.note)) out.push({ key: `note:${h.changeId}`, text: `${e.name}: ${clean(h.note)}`, entryIds: [e.id] })
    }
  }
  for (const r of memory.relationships) {
    if (onCard.has(r.aId) && onCard.has(r.bId)) continue
    const a = name.get(r.aId)
    const b = name.get(r.bId)
    if (!a || !b) continue
    const feels = [clean(r.aFeels) ? `${a} feels ${clean(r.aFeels)}` : '', clean(r.bFeels) ? `${b} feels ${clean(r.bFeels)}` : ''].filter(Boolean)
    out.push({ key: `rel:${r.aId}|${r.bId}`, text: [`${a} and ${b}: ${clean(r.type) || 'linked'}`, ...feels].join('. '), entryIds: [r.aId, r.bId].filter((id) => !onCard.has(id)) })
  }
  for (const f of memory.facts) {
    if (!saidFactIds.has(f.factId) || !clean(f.fact)) continue
    out.push({ key: `said:${f.factId}`, text: clean(f.fact), entryIds: [], saidFactId: f.factId })
  }
  return out
}

/** A summary of an earlier part of another story on the line, to search. */
export interface SummaryDoc {
  key: string
  text: string
  where: string
  order: number
}

/**
 * Summaries of the scenes and chapters of the other stories on this scene's line (earlier books, side stories told
 * meanwhile), which the story so far gives only a paragraph each. This story's own scenes are searched word for word.
 */
export function summaryDocs(summaries: Summary[], line: Line, storyId: ID, label: ReturnType<typeof labeler>): SummaryDoc[] {
  const sceneAt = new Map<ID, { storyId: ID; at: number }>()
  const chapterAt = new Map<ID, { storyId: ID; at: number }>()
  line.steps.forEach((s, i) => {
    if (s.type === 'scene') sceneAt.set(s.sceneId, { storyId: s.storyId, at: i })
    else if (s.type === 'chapter-end') chapterAt.set(s.chapterId, { storyId: s.storyId, at: i })
  })
  const out: SummaryDoc[] = []
  for (const s of summaries) {
    if (!clean(s.text)) continue
    if (s.level === 'scene') {
      const at = sceneAt.get(s.targetId)
      if (at && at.storyId !== storyId) out.push({ key: `sum:scene:${s.targetId}`, text: clean(s.text), where: label({ storyId: at.storyId, sceneId: s.targetId }), order: at.at })
    } else if (s.level === 'chapter') {
      const at = chapterAt.get(s.targetId)
      if (at && at.storyId !== storyId)
        out.push({ key: `sum:chapter:${s.targetId}`, text: clean(s.text), where: label({ storyId: at.storyId, chapterId: s.targetId }), order: at.at })
    }
  }
  return out
}

// ---------- Searching ----------

/**
 * Waits for `p` at most `ms`, or until `outer` stops; either way `stop` is aborted, so whatever the search still has
 * queued for the model is taken out of the queue (background reading goes on). Null when it didn't finish.
 */
export function withLimit<T>(p: (signal: AbortSignal) => Promise<T>, ms: number, outer?: AbortSignal): Promise<T | null> {
  const stop = new AbortController()
  return new Promise<T | null>((resolve) => {
    let done = false
    const finish = (v: T | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      outer?.removeEventListener('abort', onOuter)
      stop.abort()
      resolve(v)
    }
    const onOuter = (): void => finish(null)
    const timer = setTimeout(() => finish(null), ms)
    if (outer?.aborted) return finish(null)
    outer?.addEventListener('abort', onOuter, { once: true })
    p(stop.signal).then(
      (v) => finish(stop.signal.aborted ? null : v),
      (e: unknown) => {
        if (!stop.signal.aborted) console.warn('Searching by meaning failed; keyword search goes ahead alone', e instanceof Error ? e.message : e)
        finish(null)
      }
    )
  })
}

/** Keeps the finds of one list that score at least `keep` of its best. */
const keepBest = <T>(list: Ranked<T>[], keep = KEYWORD_KEEP): Ranked<T>[] => {
  const best = list[0]?.score ?? 0
  return list.filter((r) => r.score > 0 && r.score >= best * keep)
}

interface Lists {
  passages: Ranked<StoredPassage>[][]
  summaries: Ranked<SummaryDoc>[][]
  facts: Ranked<FactDoc>[][]
}

/**
 * The meaning lists for each part: passages, summaries and facts closest to it. The search's own words are read now
 * (stopped with `signal`); passages' vectors come from the background indexing; facts' and summaries' are read in the
 * background and waited for while there is time (kept for next time either way).
 */
async function meaningLists(
  deps: RecallDeps,
  embedder: Embedder,
  vectors: Vectors,
  signal: AbortSignal,
  parts: string[],
  passages: StoredPassage[],
  summaries: SummaryDoc[],
  facts: FactDoc[]
): Promise<Lists> {
  const queries = parts.map((p) => ({ hash: `q:${textHash(p)}`, text: p }))
  const others = [...summaries.map((x) => x.text), ...facts.map((x) => x.text)].map((t) => ({ hash: textHash(t), text: t }))
  const [qv, ov] = await Promise.all([
    vectors.read({ embedder, texts: queries, now: true, signal }),
    vectors.read({ embedder, texts: others, now: false, index: deps.index, store: 'other', signal, background: deps.background })
  ])
  if (signal.aborted) throw new Error('out of time')
  const pv = vectors.kept(
    embedder.model,
    passages.map((p) => p.hash),
    deps.index
  )
  const withVec = <T>(items: T[], hash: (x: T) => string, vecs: Map<string, Float32Array>): { item: T; vec: Float32Array }[] =>
    items.flatMap((item) => {
      const vec = vecs.get(hash(item))
      return vec ? [{ item, vec }] : []
    })
  const p = withVec(passages, (x) => x.hash, pv)
  const s = withVec(summaries, (x) => textHash(x.text), ov)
  const f = withVec(facts, (x) => textHash(x.text), ov)
  const qs = queries.map((q) => qv.get(q.hash)).filter((v): v is Float32Array => !!v)
  return {
    passages: qs.map((q) => nearest(q, p, LIST_SIZE, embedder.floor)),
    summaries: qs.map((q) => nearest(q, s, LIST_SIZE, embedder.floor)),
    facts: qs.map((q) => nearest(q, f, LIST_SIZE, embedder.floor))
  }
}

/**
 * Each time something was said on this scene's line (not later, not in another story's what-if): the changes that
 * record it (one per character who knows it) grouped by fact, place and line, with who said it and who heard it there
 * (as recorded; for lines kept before that was recorded, the others who learned it there).
 */
export function saidTimes(changes: SaidChange[], onLine: Map<ID, { at: number; storyId: ID }>, label: ReturnType<typeof labeler>): SaidTime[] {
  const out = new Map<string, SaidTime & { knowers: Set<ID>; recorded: boolean }>()
  for (const s of changes) {
    const c = s.change
    const at = c.anchor === 'scene' && c.sceneId ? onLine.get(c.sceneId) : undefined
    if (c.anchor === 'scene' && !at) continue
    const key = `${c.payload.factId}|${c.anchor}|${c.sceneId ?? c.storyId ?? ''}|${plain(s.words)}`
    let t = out.get(key)
    if (!t) {
      t = {
        factId: c.payload.factId,
        kind: s.said.kind,
        by: s.said.by,
        heard: [],
        words: s.words,
        where: c.anchor === 'scene' && c.sceneId ? label({ storyId: at!.storyId, sceneId: c.sceneId }) : c.anchor === 'story-start' ? label({ storyId: c.storyId }) : '',
        order: at?.at ?? -1,
        knowers: new Set(),
        recorded: false
      }
      out.set(key, t)
    }
    t.knowers.add(c.entryId)
    if (s.said.heard) {
      t.recorded = true
      for (const id of s.said.heard) if (id !== t.by && !t.heard.includes(id)) t.heard.push(id)
    }
  }
  return [...out.values()].map(({ knowers, recorded, ...t }) => ({ ...t, heard: recorded ? t.heard : [...knowers].filter((id) => id !== t.by) }))
}

/** The scenes on the line before this one, each with its place on the walk and its story. */
function scenesOnLine(line: Line): Map<ID, { at: number; storyId: ID }> {
  const out = new Map<ID, { at: number; storyId: ID }>()
  line.steps.forEach((s, i) => {
    if (s.type === 'scene') out.set(s.sceneId, { at: i, storyId: s.storyId })
  })
  return out
}

/**
 * What step 5 adds to this scene's briefing. `input` is the briefing's input as gathered (its memory is as of this
 * scene); `soFar` the words already in the scene a draft carries on from (Add below, a later beat), if any.
 */
export async function recallFor(deps: RecallDeps, sceneId: ID, input: ContextInput, soFar = ''): Promise<RecallInput> {
  const db = deps.db
  const shape = loadShape(db)
  const story = storyOfScene(shape, sceneId)
  if (!story) return NOTHING
  const line = buildLine(shape, { storyId: story.id, before: sceneId })
  const label = labeler(shape)
  const onLine = scenesOnLine(line)
  const memory = input.memory
  const card = input.scene.card
  const onCard = new Set([card.povId, ...card.presentIds, card.locationId].filter((x): x is ID => !!x))
  const people = new Set([card.povId, ...card.presentIds].filter((x): x is ID => !!x))
  const cardNames = memory.entries.filter((e) => onCard.has(e.id)).flatMap((e) => [e.name, ...(e.aliases ?? [])])

  // Sticky: the last two scenes before this one on the story's line (as the previous scene is chosen).
  const lastIds = line.steps
    .filter((s): s is Extract<Line['steps'][number], { type: 'scene' }> => s.type === 'scene' && s.via === 'line')
    .slice(-STICKY_SCENES)
    .reverse()
    .map((s) => s.sceneId)
  const sticky = stickyEntries(
    memory.entries,
    scenesCardsAndText(db, lastIds).map((s) => ({
      card: { povId: s.card.povId ?? null, presentIds: s.card.presentIds ?? [], locationId: s.card.locationId ?? null, setsUpIds: s.card.setsUpIds ?? [], paysOffIds: s.card.paysOffIds ?? [] },
      text: s.text
    }))
  )

  // What was said, as the world's changes have it: each time, on this scene's line.
  const times = saidTimes(saidChanges(db, listAllChanges(db)), onLine, label)

  const parts = queryParts(input, soFar)
  const facts = factDocs(memory, onCard, new Set(times.map((t) => t.factId)))
  const summaries = summaryDocs(listSummaries(db), line, story.id, label)
  const index = deps.index?.open ? deps.index : null
  const allowed = [...onLine.keys()]

  // The end of the previous scene is sent already (block 3): passages it holds aren't offered again.
  const tail = clean(sceneTail(memory.previous?.text ?? ''))
  const previousId = memory.previous?.sceneId
  const sentAlready = (p: StoredPassage): boolean => p.sceneId === previousId && tail.includes(clean(p.text).slice(0, 80))

  // Keyword search, part by part.
  const lists: Lists = { passages: [], summaries: [], facts: [] }
  const factIndex = new KeywordIndex(facts, (f) => f.text)
  const summaryIndex = new KeywordIndex(summaries, (s) => s.text)
  for (const part of parts) {
    if (index) {
      try {
        const found = index.keyword(searchWords(part), allowed, LIST_SIZE).filter((r) => !sentAlready(r.passage))
        lists.passages.push(keepBest(found.map((r) => ({ item: r.passage, score: r.score }))))
      } catch (e) {
        console.warn('Keyword search of earlier scenes failed', e instanceof Error ? e.message : e)
      }
    }
    lists.summaries.push(summaryIndex.search(part, LIST_SIZE, KEYWORD_KEEP))
    lists.facts.push(factIndex.search(withoutNames(part, cardNames), LIST_SIZE, KEYWORD_KEEP))
  }

  // Meaning search, when the search model is here, for as long as it is quick enough.
  if (deps.embedder && parts.length && !deps.signal?.aborted) {
    const embedder = deps.embedder
    const vectors = deps.vectors ?? new Vectors()
    const passages = index ? index.passagesIn(allowed).filter((p) => !sentAlready(p)) : []
    const meaning = await withLimit(
      (signal) => meaningLists(deps, embedder, vectors, signal, parts, passages, summaries, facts),
      deps.meaningWaitMs ?? MEANING_WAIT_MS,
      deps.signal
    )
    if (meaning) {
      lists.passages.push(...meaning.passages)
      lists.summaries.push(...meaning.summaries)
      lists.facts.push(...meaning.facts)
    }
  }

  // Joined: passages and summaries together, best first.
  const passagesRanked = fuse(lists.passages, (p) => `p:${p.id}`)
  const summariesRanked = fuse(lists.summaries, (s) => s.key)
  const recalled = fuse<RecalledPassage>(
    [
      passagesRanked.slice(0, PASSAGES_MOST).map((r) => {
        const at = onLine.get(r.item.sceneId)!
        return { item: { kind: 'scene', where: label({ storyId: at.storyId, sceneId: r.item.sceneId }), text: r.item.text, order: at.at * 10_000 + r.item.n }, score: r.score }
      }),
      summariesRanked.slice(0, 3).map((r) => ({ item: { kind: 'summary', where: r.item.where, text: r.item.text, order: r.item.order * 10_000 }, score: r.score }))
    ],
    (p) => `${p.kind}:${p.where}:${p.text.slice(0, 40)}`
  )
    .slice(0, PASSAGES_MOST)
    .map((r) => r.item)

  const factsRanked = fuse(lists.facts, (f) => f.key)
  const found: ID[] = []
  const saidFound: ID[] = []
  for (const r of factsRanked) {
    if (r.item.saidFactId) {
      if (!saidFound.includes(r.item.saidFactId)) saidFound.push(r.item.saidFactId)
      continue
    }
    for (const id of r.item.entryIds) if (!onCard.has(id) && !found.includes(id) && found.length < FOUND_MOST) found.push(id)
  }

  const nameOf = (id: ID): string | null => memory.entries.find((e) => e.id === id)?.name ?? null
  return {
    sticky: sticky.filter((id) => !onCard.has(id)),
    found,
    passages: countWords(recalled.map((p) => p.text).join(' ')) ? recalled : [],
    said: saidLines(memory.facts, times, { nameOf, inScene: people, found: saidFound.slice(0, 4) })
  }
}
