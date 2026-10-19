// An offline measure of recall (story memory step 5's search for earlier passages), with no AI call: the trap stories
// (tests/traps: the book, story-v4.json, and story version 3) are put in a world in memory, and for each probe the app's
// own search for a briefing (retrieval/recall.ts recallFor, the query the app forms from the scene card, Adam's
// direction and the scene so far) is run. Each probe tests facts set in earlier scenes by known sentences (the
// plants), so the measure is whether something telling the fact comes back: a passage holding the plant's sentence, or
// a summary of the plant's scene or chapter holding the fact's words (FACT_WORDS). recall@6 is among the six the
// briefing is offered, MRR the reciprocal rank of the first over the first 30 (a deeper search). The summaries are a
// stand-in for the memory keeper's (tests/recall-eval/summaries-*.json: written once from each scene's text, following
// the keeper's summary prompt, by a model that never saw the probes).
//
// Invented stories only; nothing here reads Adam's library. The search model is used when its files are given
// (AIWRITE_TEST_SEARCH_MODEL), never downloaded.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { defaultWritingPrefs, emptySceneCard } from '../../src/shared/defaults'
import type { ID } from '../../src/shared/types'
import * as repo from '../../src/main/db/repo'
import * as mem from '../../src/main/db/memory'
import { gatherContextInput } from '../../src/main/ai/gather'
import { memoryWorld } from '../unit/helpers'
import { memorySearchIndex, type SearchIndex } from '../../src/main/retrieval/store'
import { readPassages, syncNow } from '../../src/main/retrieval/indexing'
import { queryParts, recallFor } from '../../src/main/retrieval/recall'
import { textHash } from '../../src/main/retrieval/text'
import { Vectors } from '../../src/main/retrieval/vectors'
import type { Embedder, RecalledPassage } from '../../src/main/retrieval/types'
import { BgeEmbedder } from '../../src/main/retrieval/model/embedder'
import { WordPiece } from '../../src/main/retrieval/model/wordpiece'
import { BOOK_PLANTS, BOOK_PROBES } from '../traps/book'
import { PROBES3 } from '../traps/story3'
import { probePage, type FixturePlant } from '../traps/storyData'

const TRAPS_DIR = join(__dirname, '..', 'traps')

// ---------- The stories ----------

interface EvalScene {
  key: string
  chapter: number
  title: string
  card: { pov: string; present: string[]; location: string; when: string; beats?: string[]; goal?: string; conflict?: string; outcome?: string; mood?: string }
  paragraphs: string[]
}

interface EvalEntry {
  key: string
  kind: 'character' | 'place' | 'item'
  name: string
  aliases?: string[]
  summary: string
  description?: string
  fields?: Record<string, string>
}

export interface EvalProbe {
  id: string
  scene: string
  kind: string
  /** How many of the scene's paragraphs are on the page. */
  page: number
  direction?: string
  beats?: string[]
  /** The traps it tests (style ones left out). */
  traps: string[]
}

export interface EvalPlant {
  id: string
  trap: string
  scene: string
  /** The sentence that sets the fact (its start, for story version 3). */
  sentence: string
}

export interface EvalStory {
  name: string
  title: string
  premise: string
  chapters: { title: string; goal: string }[]
  entries: EvalEntry[]
  scenes: EvalScene[]
  probes: EvalProbe[]
  plants: EvalPlant[]
  /** The words that tell each trap's fact: a summary of a plant's scene holding them tells it. */
  factWords: Record<string, RegExp>
  /** Stand-in summaries, by scene key and chapter number (from 1). */
  summaries?: { scenes: Record<string, string>; chapters: Record<string, string> }
}

const STYLE = new Set(['pov', 'register'])

/**
 * The words that tell each fact, for judging a summary (a passage must hold the plant's own sentence). Written from the
 * facts (book.ts, story3.ts), not from the summaries; loose where the fact can be put many ways.
 */
const BOOK_FACT_WORDS: Record<string, RegExp> = {
  swim: /\b(?:swim\w*|swam|millrace)\b/i,
  read: /\b(?:read|letters)\b/i,
  hollish: /\bHollish\b/i,
  father: /\b(?:drown\w*|ice gave way|through the ice|fever)\b/i,
  secret: /\b(?:told|tells|confided|confides|overheard|overhears|knows?|knew)\b[^.]{0,100}\b(?:debt|crowns|page|ledger)\b|\b(?:debt|crowns|page|ledger)\b[^.]{0,100}\b(?:told|confided|overheard|secret)\b/i,
  wrist: /\b(?:wrist|splint\w*)\b/i,
  sum: /\bfour hundred and twelve\b|\b412\b/i,
  title: /\bWarden of the Wharf\b/i,
  looks: /\b(?:pale|washed|blue)\b[^.]{0,30}\beyes\b|\beyes\b[^.]{0,30}\b(?:pale|blue)\b|\bcane\b|\bknee\b/i,
  sledge: /\bLong Patience\b/i,
  dogs: /\bTansy\b|\b(?:six|five) dogs\b/i,
  pigeons: /\b(?:pigeons?|birds?)\b/i,
  rule: /\b(?:daylight|after dark|by day|only home|in the dark)\b/i,
  bell: /\bbell\b/i,
  bridge: /\bChain Bridge\b|\b(?:east|west) bank\b/i,
  river: /\b(?:south\w*|north\w*|upriver|downriver)\b/i,
  watch: /\bwatch\b|\bpawn\w*/i,
  key: /\bheel\b|\bboot\b/i,
  whereabouts: /\bnever leaves\b|\bwon[’']t come\b|\bstays? in Callowmere\b/i,
  snowbell: /\bsnowbells?\b/i
}

const V3_FACT_WORDS: Record<string, RegExp> = {
  burn: /\bburn\w*\b/i,
  promise: /\bbead\b|\bpromis\w*/i,
  horse: /\b(?:Thistle|Cinder)\b/i,
  knows: /\bsilver\b|\bworkings\b/i,
  compass: /\bcompass\b/i,
  scar: /\b(?:scar|cut|wound\w*|knife)\b/i,
  clothing: /\bboots?\b/i,
  rooms: /\bfarrier\b/i
}
const trapsOf = (o: { checks: { trap: string }[]; patterns: { trap: string }[] }): string[] => [
  ...new Set([...o.checks.map((c) => c.trap), ...o.patterns.map((p) => p.trap)].filter((t) => !STYLE.has(t)))
]

function readSummaries(files: string[]): EvalStory['summaries'] {
  const out = { scenes: {} as Record<string, string>, chapters: {} as Record<string, string> }
  for (const f of files) {
    const s = JSON.parse(readFileSync(join(__dirname, f), 'utf8')) as NonNullable<EvalStory['summaries']>
    Object.assign(out.scenes, s.scenes)
    Object.assign(out.chapters, s.chapters)
  }
  return out
}

/** The book (story version 4): 40 scenes, 13 probes, each fact set by an exact sentence. */
export function bookStory(): EvalStory {
  const f = JSON.parse(readFileSync(join(TRAPS_DIR, 'story-v4.json'), 'utf8')) as {
    story: { title: string; premise: string }
    chapters: { title: string; goal: string }[]
    entries: EvalEntry[]
    scenes: EvalScene[]
  }
  const probes: EvalProbe[] = BOOK_PROBES.map((p) => {
    const scene = f.scenes.find((s) => s.key === p.scene)!
    const page = 'start' in p.at ? 0 : scene.paragraphs.findIndex((x) => x.startsWith((p.at as { before: string }).before))
    return { id: p.id, scene: p.scene, kind: p.kind, page, direction: p.direction, beats: p.beats, traps: trapsOf(p) }
  })
  return {
    name: 'book',
    title: f.story.title,
    premise: f.story.premise,
    chapters: f.chapters,
    entries: f.entries,
    scenes: f.scenes,
    probes,
    plants: BOOK_PLANTS.map((p) => ({ id: p.id, trap: p.trap, scene: p.scene, sentence: p.sentence })),
    factWords: BOOK_FACT_WORDS,
    summaries: readSummaries(['summaries-book.json'])
  }
}

/** Story version 3 (written by a model from story3.ts's outline): 30 scenes, 7 probes, its plants found in the text. */
export function v3Story(): EvalStory {
  const f = JSON.parse(readFileSync(join(TRAPS_DIR, 'story-v3.json'), 'utf8')) as {
    story: { title: string; premise: string }
    chapters: { title: string; goal: string }[]
    entries: EvalEntry[]
    scenes: EvalScene[]
    plants: FixturePlant[]
  }
  const probes: EvalProbe[] = PROBES3.map((p) => {
    const scene = f.scenes.find((s) => s.key === p.scene)!
    return { id: p.id, scene: p.scene, kind: p.kind, page: probePage(p, scene as never, f.plants).paragraphs, direction: p.direction, beats: p.beats, traps: trapsOf(p) }
  })
  return {
    name: 'v3',
    title: f.story.title,
    premise: f.story.premise,
    chapters: f.chapters,
    entries: f.entries,
    scenes: f.scenes,
    probes,
    plants: f.plants.map((p) => ({ id: p.id, trap: p.trap, scene: p.scene, sentence: p.quote })),
    factWords: V3_FACT_WORDS,
    summaries: readSummaries(['summaries-v3.json'])
  }
}

// ---------- The world ----------

export interface EvalWorld {
  db: Database.Database
  index: SearchIndex
  sceneIds: Map<string, ID>
  chapterIds: ID[]
  /** Scene key by id, and the scene keys of each chapter id. */
  keyOf: Map<ID, string>
  scenesOfChapter: Map<ID, string[]>
}

/** The story in a world in memory, as the trap harness makes it (tests/traps/app.ts), every scene written. */
export function buildWorld(story: EvalStory, o: { summaries: boolean }): EvalWorld {
  const db = memoryWorld()
  const entryIds = new Map<string, ID>()
  for (const e of story.entries) {
    entryIds.set(e.key, repo.createEntry(db, e.kind, { name: e.name, aliases: e.aliases ?? [], summary: e.summary, description: e.description ?? '', fields: e.fields ?? {} }).id)
  }
  const id = (k: string): ID => entryIds.get(k)!
  const st = repo.listStories(db)[0]
  repo.updateStory(db, st.id, { title: story.title, premise: story.premise })
  const first = repo.getOutline(db, st.id)
  const chapterIds: ID[] = []
  const sceneIds = new Map<string, ID>()
  const keyOf = new Map<ID, string>()
  const scenesOfChapter = new Map<ID, string[]>()
  let firstUsed = false
  for (const s of story.scenes) {
    let chapterId = chapterIds[s.chapter]
    if (!chapterId) {
      const c = s.chapter === 0 ? first.chapters[0] : repo.createChapter(db, st.id, { title: story.chapters[s.chapter].title })
      repo.updateChapter(db, c.id, story.chapters[s.chapter])
      chapterId = chapterIds[s.chapter] = c.id
    }
    const sceneId = !firstUsed ? first.scenes[0].id : repo.createScene(db, chapterId, { title: s.title }).id
    firstUsed = true
    repo.updateScene(db, sceneId, { title: s.title })
    repo.updateSceneCard(db, sceneId, {
      ...emptySceneCard(),
      povId: id(s.card.pov),
      presentIds: s.card.present.map(id),
      locationId: id(s.card.location),
      when: s.card.when,
      beats: s.card.beats ?? [],
      goal: s.card.goal ?? '',
      conflict: s.card.conflict ?? '',
      outcome: s.card.outcome ?? '',
      mood: s.card.mood ?? ''
    })
    repo.saveSceneText(db, sceneId, null, s.paragraphs.join('\n\n'))
    sceneIds.set(s.key, sceneId)
    keyOf.set(sceneId, s.key)
    scenesOfChapter.set(chapterId, [...(scenesOfChapter.get(chapterId) ?? []), s.key])
    if (o.summaries && story.summaries?.scenes[s.key]) mem.putSummary(db, { level: 'scene', targetId: sceneId, text: story.summaries.scenes[s.key], origin: 'text' })
  }
  if (o.summaries && story.summaries) {
    chapterIds.forEach((c, i) => {
      const text = story.summaries!.chapters[String(i + 1)]
      if (text) mem.putSummary(db, { level: 'chapter', targetId: c, text, origin: 'text' })
    })
  }
  const index = memorySearchIndex()
  syncNow(db, index)
  return { db, index, sceneIds, chapterIds, keyOf, scenesOfChapter }
}

// ---------- The search model ----------

/** bge-small through onnxruntime-node on this thread, read exactly as the app's worker reads it (model/worker.ts). */
export async function realEmbedder(dir: string, threads = 4): Promise<Embedder> {
  const ort = await import('onnxruntime-node')
  const session = await ort.InferenceSession.create(join(dir, 'onnx', 'model.onnx'), {
    executionProviders: ['cpu'],
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    graphOptimizationLevel: 'all'
  })
  const one = async (ids: number[]): Promise<Float32Array> => {
    const n = ids.length
    const out = await session.run({
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, (x) => BigInt(x)), [1, n]),
      attention_mask: new ort.Tensor('int64', new BigInt64Array(n).fill(1n), [1, n]),
      token_type_ids: new ort.Tensor('int64', new BigInt64Array(n), [1, n])
    })
    const hidden = out.last_hidden_state
    const size = hidden.dims[hidden.dims.length - 1]
    const v = (hidden.data as Float32Array).slice(0, size)
    let norm = 0
    for (const x of v) norm += x * x
    norm = Math.sqrt(norm) || 1
    return v.map((x) => x / norm)
  }
  const tokenizer = new WordPiece(readFileSync(join(dir, 'vocab.txt'), 'utf8'))
  return new BgeEmbedder(tokenizer, async (ids) => {
    const out: Float32Array[] = []
    for (const x of ids) out.push(await one(x))
    return out
  })
}

/**
 * Reads every passage (and summary) of the index for its vector, as the background indexing does; vectors already
 * made for the same words (an earlier run) are put in the index without reading them again.
 */
export async function readAll(index: SearchIndex, embedder: Embedder, vectors: Vectors): Promise<number> {
  const known = (texts: string[]): (Float32Array | undefined)[] => texts.map((t) => vectors.get(embedder.model, textHash(t)))
  return readPassages(
    index,
    embedder,
    async (texts, s) => {
      const have = known(texts)
      const todo = texts.filter((_, i) => !have[i])
      const made = todo.length ? await embedder.embed(todo, 'passage', s) : []
      let j = 0
      return have.map((v) => v ?? made[j++])
    },
    { signal: new AbortController().signal, vectors }
  )
}

// ---------- Measuring ----------

const norm = (s: string): string =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/** Does this passage hold the plant's sentence? (Its first 60 characters: version 3's quotes are cut short.) */
export const holds = (text: string, plant: EvalPlant): boolean => norm(text).includes(norm(plant.sentence).slice(0, 60))

export interface FactResult {
  probe: string
  trap: string
  /** The plants of this trap in scenes before the probe. */
  plants: string[]
  /**
   * Where (1-based) the first item that tells the fact came among the six offered: a passage holding a plant's
   * sentence, or a summary of a plant's scene (or its chapter) holding the fact's words. Null: not among them.
   */
  states6: number | null
  /** The same in the deeper search (up to 30): MRR and "in the top 30". */
  states30: number | null
  /** The first passage holding a plant's sentence among the six. */
  passage6: number | null
  /** The first item from or about a plant's scene among the six (a passage of the scene, or any summary of it). */
  scene6: number | null
  /** What the first telling item among the six was. */
  via: 'passage' | 'scene summary' | 'chapter summary' | null
  /** What the six were (scene keys; "sum:" for a summary), and the plants' scenes, to see why a fact was missed. */
  six: string[]
  plantScenes: string[]
}

export interface ProbeTiming {
  probe: string
  ms: number
}

/** What a found item points at: the scene keys of its scene or chapter. */
function pointsAt(p: RecalledPassage, w: EvalWorld): string[] {
  if (p.sceneId) return [w.keyOf.get(p.sceneId) ?? '']
  if (p.chapterId) return w.scenesOfChapter.get(p.chapterId) ?? []
  return []
}

const rankOf = (list: RecalledPassage[], test: (p: RecalledPassage) => boolean): number | null => {
  const i = list.findIndex(test)
  return i < 0 ? null : i + 1
}

/** How each found item stands to the plants of one fact. */
function judge(plants: EvalPlant[], words: RegExp | undefined, w: EvalWorld) {
  const about = (p: RecalledPassage): boolean => pointsAt(p, w).some((k) => plants.some((pl) => pl.scene === k))
  const passage = (p: RecalledPassage): boolean => p.kind === 'scene' && plants.some((pl) => holds(p.text, pl))
  const summaryStates = (p: RecalledPassage): boolean => p.kind === 'summary' && about(p) && !!words?.test(p.text)
  return { about, passage, states: (p: RecalledPassage): boolean => passage(p) || summaryStates(p) }
}

export interface EvalOptions {
  embedder: Embedder | null
  summaries: boolean
  /** Re-orders the deeper search's finds (the re-ranker experiment); the six offered are its first six. */
  rerank?: (parts: string[], direction: string, items: RecalledPassage[]) => Promise<RecalledPassage[]>
  /** Vectors kept between runs (the same words are never read twice). */
  vectors?: Vectors
  log?: (line: string) => void
}

/**
 * Runs every probe of the story through the app's search and scores each tested fact. The world is built once; for each
 * probe the scene's page (and the beats it sets) is put in place, its own summary left out (it is being written), and
 * put back after.
 */
export async function evaluate(story: EvalStory, o: EvalOptions): Promise<{ facts: FactResult[]; timings: ProbeTiming[] }> {
  const w = buildWorld(story, { summaries: o.summaries })
  const vectors = o.vectors ?? new Vectors()
  if (o.embedder) await readAll(w.index, o.embedder, vectors)
  const order = new Map(story.scenes.map((s, i) => [s.key, i]))
  const facts: FactResult[] = []
  const timings: ProbeTiming[] = []
  for (const [n, probe] of story.probes.entries()) {
    const scene = story.scenes.find((s) => s.key === probe.scene)!
    const sceneId = w.sceneIds.get(probe.scene)!
    const card = repo.getScene(w.db, sceneId).card
    const ownSummary = mem.getSummary(w.db, 'scene', sceneId)
    if (probe.beats) repo.updateSceneCard(w.db, sceneId, { ...card, beats: probe.beats })
    const page = scene.paragraphs.slice(0, probe.page).join('\n\n')
    repo.saveSceneText(w.db, sceneId, null, page)
    if (ownSummary) w.db.prepare("DELETE FROM summaries WHERE level = 'scene' AND target_id = ?").run(sceneId)
    try {
      syncNow(w.db, w.index)
      if (o.embedder) await readAll(w.index, o.embedder, vectors)
      const soFar = probe.kind === 'generate' ? '' : page
      const input = gatherContextInput(w.db, sceneId, { direction: probe.direction ?? '' }, {
        prefs: defaultWritingPrefs(),
        contextLength: null,
        creativity: 'balanced',
        ...(soFar ? { soFar } : {})
      })
      const deps = { db: w.db, index: w.index, embedder: o.embedder, vectors, meaningWaitMs: 120_000 }
      const t0 = performance.now()
      const six = (await recallFor(deps, sceneId, input, soFar)).passages
      const ms = performance.now() - t0
      let deep = (await recallFor({ ...deps, depth: 30 }, sceneId, input, soFar)).passages
      let offered = six
      if (o.rerank) {
        const r0 = performance.now()
        deep = await o.rerank(queryParts(input, soFar), input.options.direction ?? '', deep)
        offered = deep.slice(0, 6)
        timings.push({ probe: probe.id, ms: performance.now() - r0 })
      } else timings.push({ probe: probe.id, ms })
      for (const trap of probe.traps) {
        const plants = story.plants.filter((p) => p.trap === trap && (order.get(p.scene) ?? 1e9) < (order.get(probe.scene) ?? -1))
        if (!plants.length) continue
        const j = judge(plants, story.factWords[trap], w)
        const first = offered.find(j.states)
        facts.push({
          probe: probe.id,
          trap,
          plants: plants.map((p) => p.id),
          states6: rankOf(offered, j.states),
          states30: rankOf(deep, j.states),
          passage6: rankOf(offered, j.passage),
          scene6: rankOf(offered, j.about),
          via: !first ? null : first.kind === 'scene' ? 'passage' : first.chapterId ? 'chapter summary' : 'scene summary',
          six: offered.map((p) => (p.kind === 'summary' ? `sum:${pointsAt(p, w).join('+')}` : (pointsAt(p, w)[0] ?? '?'))),
          plantScenes: plants.map((p) => p.scene)
        })
      }
      o.log?.(`${story.name}: probe ${n + 1} of ${story.probes.length} (${probe.id}) searched in ${Math.round(ms)} ms`)
    } finally {
      repo.updateSceneCard(w.db, sceneId, card)
      repo.saveSceneText(w.db, sceneId, null, scene.paragraphs.join('\n\n'))
      if (ownSummary) mem.putSummary(w.db, { level: 'scene', targetId: sceneId, text: ownSummary.text, origin: ownSummary.origin })
    }
  }
  w.index.close()
  w.db.close()
  return { facts, timings }
}

export interface Score {
  facts: number
  /** Told among the six offered (a plant's passage, or a summary of its scene or chapter with the fact's words). */
  recallAt6: number
  mrr30: number
  in30: number
  /** A plant's own passage among the six. */
  passageAt6: number
  /** Anything from or about a plant's scene among the six. */
  sceneAt6: number
  viaSceneSummary: number
  viaChapterSummary: number
}

export function score(facts: FactResult[]): Score {
  const n = facts.length || 1
  const share = (f: (x: FactResult) => boolean): number => facts.filter(f).length / n
  return {
    facts: facts.length,
    recallAt6: share((f) => f.states6 !== null),
    mrr30: facts.reduce((t, f) => t + (f.states30 ? 1 / f.states30 : 0), 0) / n,
    in30: share((f) => f.states30 !== null),
    passageAt6: share((f) => f.passage6 !== null),
    sceneAt6: share((f) => f.scene6 !== null),
    viaSceneSummary: facts.filter((f) => f.via === 'scene summary').length,
    viaChapterSummary: facts.filter((f) => f.via === 'chapter summary').length
  }
}
