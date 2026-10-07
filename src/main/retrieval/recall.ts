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
import { saidChanges, scenesCardsAndText } from '../db/retrieval'
import { buildLine, labeler, storyOfScene } from '../memory/line'
import type { Line } from '../memory/types'
import { fuse, KeywordIndex, nearest, type Ranked } from './rank'
import { saidLines, type SaidFact } from './said'
import { STICKY_SCENES, stickyEntries } from './sticky'
import type { SearchIndex, StoredPassage } from './store'
import { countWords, searchWords, terms, textHash } from './text'
import type { Embedder, RecallInput, RecalledPassage } from './types'

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
/** Texts (facts, summaries) the search model reads during one search at most; the rest wait for the next. */
const EMBED_NOW_MOST = 64

/** Vectors kept in memory for the open world, by model and hash, so the Context tab and the draft share them. */
export class VectorCache {
  private readonly map = new Map<string, Float32Array>()
  constructor(private readonly most = 60_000) {}
  get(model: string, hash: string): Float32Array | undefined {
    return this.map.get(`${model}|${hash}`)
  }
  set(model: string, hash: string, vec: Float32Array): void {
    const k = `${model}|${hash}`
    this.map.delete(k)
    this.map.set(k, vec)
    if (this.map.size > this.most) this.map.delete(this.map.keys().next().value as string)
  }
  clear(): void {
    this.map.clear()
  }
}

export interface RecallDeps {
  db: DB
  /** The world's search index, or null when there is none (passages can't be searched then). */
  index: SearchIndex | null
  /** The search model, or null: keyword search only (not downloaded, switched off, or not working). */
  embedder: Embedder | null
  cache?: VectorCache
  signal?: AbortSignal
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

/** Rejects after `ms` (or when `signal` aborts), so a slow search model never holds a draft up for long. */
function withLimit<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: T | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(v)
    }
    const onAbort = (): void => finish(null)
    const timer = setTimeout(() => finish(null), ms)
    signal?.addEventListener('abort', onAbort, { once: true })
    p.then(finish, (e: unknown) => {
      console.warn('Searching by meaning failed; keyword search goes ahead alone', e instanceof Error ? e.message : e)
      finish(null)
    })
  })
}

/** Vectors for these texts (by hash): from memory, then the index, then the search model for up to EMBED_NOW_MOST. */
async function vectorsFor(
  deps: RecallDeps,
  embedder: Embedder,
  texts: { hash: string; text: string }[],
  kind: 'passage' | 'other'
): Promise<Map<string, Float32Array>> {
  const out = new Map<string, Float32Array>()
  const missing: { hash: string; text: string }[] = []
  for (const t of texts) {
    const v = deps.cache?.get(embedder.model, t.hash)
    if (v) out.set(t.hash, v)
    else if (!missing.some((m) => m.hash === t.hash)) missing.push(t)
  }
  if (missing.length && deps.index?.open) {
    const kept = deps.index.vectors(
      embedder.model,
      missing.map((m) => m.hash)
    )
    for (const [h, v] of kept) {
      out.set(h, v)
      deps.cache?.set(embedder.model, h, v)
    }
  }
  // Passages are read by the background indexing; other texts are read here, a few at a time.
  const toRead = kind === 'other' ? missing.filter((m) => !out.has(m.hash)).slice(0, EMBED_NOW_MOST) : []
  if (toRead.length) {
    const vecs = await embedder.embed(
      toRead.map((t) => t.text),
      'passage',
      deps.signal
    )
    const made = toRead.map((t, i) => ({ hash: t.hash, vec: vecs[i] })).filter((x) => x.vec)
    for (const x of made) {
      out.set(x.hash, x.vec)
      deps.cache?.set(embedder.model, x.hash, x.vec)
    }
    if (deps.index?.open) deps.index.putVectors(embedder.model, 'other', made)
  }
  return out
}

/** The query vectors for these parts (kept, so a search made again costs nothing). */
async function queryVectors(deps: RecallDeps, embedder: Embedder, parts: string[]): Promise<Float32Array[]> {
  const keys = parts.map((p) => `q:${textHash(p)}`)
  const missing = parts.filter((_, i) => !deps.cache?.get(embedder.model, keys[i]))
  if (missing.length) {
    const vecs = await embedder.embed(missing, 'query', deps.signal)
    missing.forEach((p, i) => deps.cache?.set(embedder.model, `q:${textHash(p)}`, vecs[i]))
    if (!deps.cache) return parts.map((p) => vecs[missing.indexOf(p)])
  }
  return keys.map((k) => deps.cache!.get(embedder.model, k)!)
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

/** The meaning lists for each part: passages, summaries and facts closest to it. */
async function meaningLists(
  deps: RecallDeps,
  embedder: Embedder,
  parts: string[],
  passages: StoredPassage[],
  summaries: SummaryDoc[],
  facts: FactDoc[]
): Promise<Lists> {
  const qv = await queryVectors(deps, embedder, parts)
  const pv = await vectorsFor(
    deps,
    embedder,
    passages.map((p) => ({ hash: p.hash, text: p.text })),
    'passage'
  )
  const sv = await vectorsFor(
    deps,
    embedder,
    summaries.map((s) => ({ hash: textHash(s.text), text: s.text })),
    'other'
  )
  const fv = await vectorsFor(
    deps,
    embedder,
    facts.map((f) => ({ hash: textHash(f.text), text: f.text })),
    'other'
  )
  const withVec = <T>(items: T[], hash: (x: T) => string, vecs: Map<string, Float32Array>): { item: T; vec: Float32Array }[] =>
    items.flatMap((item) => {
      const vec = vecs.get(hash(item))
      return vec ? [{ item, vec }] : []
    })
  const p = withVec(passages, (x) => x.hash, pv)
  const s = withVec(summaries, (x) => textHash(x.text), sv)
  const f = withVec(facts, (x) => textHash(x.text), fv)
  return {
    passages: qv.map((q) => nearest(q, p, LIST_SIZE, embedder.floor)),
    summaries: qv.map((q) => nearest(q, s, LIST_SIZE, embedder.floor)),
    facts: qv.map((q) => nearest(q, f, LIST_SIZE, embedder.floor))
  }
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

  // What was said, as the world's changes have it, for the facts known here.
  const said = new Map<ID, SaidFact>()
  for (const s of saidChanges(db, listAllChanges(db))) {
    const c = s.change
    const at = c.anchor === 'scene' && c.sceneId ? onLine.get(c.sceneId) : undefined
    if (c.anchor === 'scene' && !at) continue
    const factId = c.payload.factId
    const cur = said.get(factId)
    // The speaker's own change says it best; otherwise the first.
    if (cur && c.entryId !== s.said.by) continue
    said.set(factId, {
      factId,
      kind: s.said.kind,
      by: s.said.by,
      words: s.words,
      where: c.anchor === 'scene' && c.sceneId ? label({ storyId: at!.storyId, sceneId: c.sceneId }) : c.anchor === 'story-start' ? label({ storyId: c.storyId }) : '',
      order: at?.at ?? -1
    })
  }

  const parts = queryParts(input, soFar)
  const facts = factDocs(memory, onCard, new Set(said.keys()))
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
  if (deps.embedder && parts.length) {
    const passages = index ? index.passagesIn(allowed).filter((p) => !sentAlready(p)) : []
    const meaning = await withLimit(meaningLists(deps, deps.embedder, parts, passages, summaries, facts), deps.meaningWaitMs ?? MEANING_WAIT_MS, deps.signal)
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
    said: saidLines(memory.facts, said, { nameOf, inScene: people, found: saidFound.slice(0, 4) })
  }
}
