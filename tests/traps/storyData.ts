// The story a run uses, in one shape: version 2 (story.ts, nine short hand-written scenes), version 3 (the long story
// a live model wrote from story3.ts's outline, frozen in story-v3.json) or version 4, the book (story-v4.json, tested by
// book.ts). Version 3's probe pages are worked out from the written text: where each planted event is, and how far a
// Continue's page ends from it; the book's end before a marker sentence.

import { readFileSync } from 'node:fs'
import { CHAPTERS, ENTRIES, PROBES, SCENES, STORY, STORY_VERSION, TRAPS, type Probe } from './story'
import { findPlace } from './patterns'
import { BOOK_PROBES, BOOK_PROBES_VERSION, PLANTED, TRAPS4, type BookProbe, type Planted } from './book'
import { CHAPTERS3, ENTRIES3, OUTLINE_VERSION, PROBES3, PROBES_VERSION, SCENES3, STORY3, TRAPS3, type Card3, type Entry3, type ProbeSpec3 } from './story3'

export interface StoryScene {
  key: string
  chapter: number
  title: string
  card: Card3 & { conflict?: string; outcome?: string }
  paragraphs: string[]
}

export interface StoryData {
  version: number
  /** The probes' version (story version 3; absent for version 2, whose probes go with its story version). */
  probesVersion?: number
  /** Where the story came from, for the report. */
  source: string
  story: { title: string; premise: string }
  chapters: { title: string; goal: string }[]
  entries: Entry3[]
  scenes: StoryScene[]
  traps: { id: string; name: string; tests: string }[]
  probes: Probe[]
  /** The book only: passages with planted slips (and controls) for the app's consistency checks. */
  planted?: Planted[]
}

/** Version 2: the hand-written story in story.ts. */
export function storyV2(): StoryData {
  return {
    version: STORY_VERSION,
    source: 'story.ts (hand-written)',
    story: STORY,
    chapters: CHAPTERS,
    entries: ENTRIES,
    scenes: SCENES.map((s) => ({ ...s, card: { ...s.card, beats: s.card.beats ?? [] } })),
    traps: TRAPS,
    probes: PROBES
  }
}

// ---------- Version 3: the written story ----------

/** Where a planted event happened in the written story. */
export interface FixturePlant {
  id: string
  trap: string
  scene: string
  /** The sentence where it happens. */
  quote: string
  /** The paragraph (of the scene) it is in. */
  paragraph: number
  /** Found by a matching sentence, or by the judge. */
  by: 'pattern' | 'judge'
}

export interface FixtureScene extends StoryScene {
  words: number
  /** How many drafts it took (1 to 3). */
  attempts: number
}

/** story-v3.json: the written story, frozen, so every checkout is scored on the very same words. */
export interface StoryFixture {
  format: 'aiwrite-trap-story'
  version: 3
  outlineVersion: number
  /** False while it is still being written (a partial file, for --resume). */
  complete: boolean
  writtenAt: string
  fake: boolean
  models: { writer: string; memory: string; judge: string }
  provider: string
  app: { root: string; branch: string; commit: string; version: string }
  story: { title: string; premise: string }
  chapters: { title: string; goal: string }[]
  entries: Entry3[]
  scenes: FixtureScene[]
  plants: FixturePlant[]
  tokens: { in: number; out: number; calls: number }
  /** Why it stopped, when it isn't complete. */
  stopped?: string
}

export function loadFixture(path: string): StoryFixture {
  let f: StoryFixture
  try {
    f = JSON.parse(readFileSync(path, 'utf8')) as StoryFixture
  } catch (e) {
    throw new Error(`Can't read the written story at ${path} (${e instanceof Error ? e.message : String(e)}). Write it first with npm run traps:write.`)
  }
  if (f.format !== 'aiwrite-trap-story' || f.version !== 3) throw new Error(`${path} isn't a version 3 trap story.`)
  return f
}

const wordsIn = (s: string): number => (s.match(/\S+/g) ?? []).length

/** How many of the scene's paragraphs are on the page for a probe, and a note when the fact is closer than planned. */
export function probePage(spec: ProbeSpec3, scene: StoryScene, plants: FixturePlant[]): { paragraphs: number; note?: string } {
  const paras = scene.paragraphs
  const n = paras.length
  const at = spec.at
  if ('start' in at) return { paragraphs: 0 }
  if ('share' in at) {
    const total = paras.reduce((t, x) => t + wordsIn(x), 0)
    let sum = 0
    for (let i = 0; i < n; i++) {
      sum += wordsIn(paras[i])
      if (sum >= total * at.share) return { paragraphs: Math.min(Math.max(1, i + 1), Math.max(1, n - 1)) }
    }
    return { paragraphs: Math.max(1, n - 1) }
  }
  const plantId = 'before' in at ? at.before : at.after
  const plant = plants.find((p) => p.id === plantId && p.scene === spec.scene)
  if (!plant) throw new Error(`Probe ${spec.id} needs where "${plantId}" happens in ${spec.scene}, and the written story doesn't say.`)
  if ('before' in at) {
    // Found again in the written words, a paragraph at a time (a writer spreads one event over a few sentences: round 4
    // recorded the bead given in the paragraph after it was), and before its first mention when asked.
    const planned = SCENES3.find((x) => x.key === spec.scene)?.plants.find((x) => x.id === plantId)
    const found = planned ? findPlace(paras, planned.find, planned.none ?? []) : null
    const mention = at.firstMention ? paras.findIndex((x) => new RegExp(at.firstMention!.source, at.firstMention!.flags.replace('g', '')).test(x)) : -1
    const cut = Math.min(plant.paragraph, found?.paragraph ?? plant.paragraph, mention >= 0 ? mention : plant.paragraph)
    if (cut < 1) throw new Error(`Probe ${spec.id}: "${plantId}" is in the first paragraph of ${spec.scene}; there is no page before it.`)
    // Fails loudly rather than score a page that already shows what the probe tests.
    const shown = planned ? findPlace(paras.slice(0, cut), planned.find, planned.none ?? []) : null
    if (shown) throw new Error(`Probe ${spec.id}'s page already shows "${plantId}" (paragraph ${shown.paragraph + 1}: “${shown.quote.slice(0, 120)}”).`)
    return { paragraphs: cut }
  }
  // Continue near the end of the scene: every paragraph but the last on the page, so it carries on from there.
  const cut = Math.max(plant.paragraph + 1, n - 1)
  const gap = paras.slice(plant.paragraph + 1, cut).reduce((t, x) => t + wordsIn(x), 0)
  return gap >= at.gap
    ? { paragraphs: cut }
    : { paragraphs: cut, note: `The planted event is only ${gap} words before the page ends (planned at least ${at.gap}), so Continue may be shown it.` }
}

/** Version 3: the written story, with the probes' pages worked out from its words. */
export function storyV3(f: StoryFixture, source: string): StoryData {
  if (f.outlineVersion !== OUTLINE_VERSION) {
    throw new Error(`${source} was written from outline version ${f.outlineVersion}, but the probes are for version ${OUTLINE_VERSION}. Write the story again.`)
  }
  if (!f.complete) throw new Error(`${source} isn't finished (${f.stopped ?? 'stopped part way'}). Finish it with npm run traps:write -- --resume.`)
  const probes: Probe[] = PROBES3.map((spec) => {
    const scene = f.scenes.find((s) => s.key === spec.scene)
    if (!scene) throw new Error(`The written story has no scene ${spec.scene}.`)
    const page = probePage(spec, scene, f.plants)
    return {
      id: spec.id,
      scene: spec.scene,
      kind: spec.kind,
      paragraphs: page.paragraphs,
      ...(spec.beat ? { beat: spec.beat } : {}),
      asks: spec.asks,
      facts: spec.facts,
      checks: spec.checks,
      tripwires: spec.tripwires,
      patterns: spec.patterns,
      ...(spec.direction ? { direction: spec.direction } : {}),
      ...(spec.beats ? { beats: spec.beats } : {}),
      ...(spec.soFarEnds ? { soFarEnds: spec.soFarEnds } : {}),
      ...(page.note ? { note: page.note } : {})
    }
  })
  return {
    version: 3,
    probesVersion: PROBES_VERSION,
    source: `${source} (written ${f.writtenAt.slice(0, 10)} by ${f.models.writer}${f.fake ? ', FAKE' : ''})`,
    story: f.story,
    chapters: f.chapters,
    entries: f.entries,
    scenes: f.scenes,
    traps: TRAPS3,
    probes
  }
}

// ---------- Version 4: the book ----------

/** story-v4.json: the book, written by hand and frozen (book.ts holds what is tested in it). */
export interface BookFixture {
  format: 'aiwrite-trap-story'
  version: 4
  /** How it was made, for the report. */
  written: string
  writtenAt: string
  story: { title: string; premise: string }
  chapters: { title: string; goal: string }[]
  entries: Entry3[]
  scenes: (StoryScene & { words: number })[]
}

export function loadBook(path: string): BookFixture {
  let f: BookFixture
  try {
    f = JSON.parse(readFileSync(path, 'utf8')) as BookFixture
  } catch (e) {
    throw new Error(`Can't read the book at ${path} (${e instanceof Error ? e.message : String(e)}).`)
  }
  if (f.format !== 'aiwrite-trap-story' || f.version !== 4) throw new Error(`${path} isn't the book (story version 4).`)
  return f
}

/** How many of a scene's paragraphs are on the page for a book probe: none, or those before the marker's paragraph. */
export function bookPage(spec: Pick<BookProbe, 'id' | 'at'>, scene: StoryScene): number {
  if ('start' in spec.at) return 0
  const marker = spec.at.before
  const at = scene.paragraphs.findIndex((p) => p.startsWith(marker))
  if (at < 0) throw new Error(`Probe ${spec.id}: no paragraph of ${scene.key} starts with “${marker}”.`)
  if (at === 0) throw new Error(`Probe ${spec.id}: “${marker}” starts ${scene.key}; there is no page before it.`)
  return at
}

/** The book with its probes' pages worked out, and its planted passages. */
export function storyBook(f: BookFixture, source: string): StoryData {
  const probes: Probe[] = BOOK_PROBES.map((spec) => {
    const scene = f.scenes.find((s) => s.key === spec.scene)
    if (!scene) throw new Error(`The book has no scene ${spec.scene}.`)
    return {
      id: spec.id,
      scene: spec.scene,
      kind: spec.kind,
      paragraphs: bookPage(spec, scene),
      ...(spec.beat ? { beat: spec.beat } : {}),
      asks: spec.asks,
      facts: spec.facts,
      checks: spec.checks,
      tripwires: spec.tripwires,
      patterns: spec.patterns,
      ...(spec.direction ? { direction: spec.direction } : {}),
      ...(spec.beats ? { beats: spec.beats } : {}),
      ...(spec.soFarEnds ? { soFarEnds: spec.soFarEnds } : {})
    }
  })
  return {
    version: 4,
    probesVersion: BOOK_PROBES_VERSION,
    source: `${source} (${f.written}, ${f.scenes.reduce((n, s) => n + s.words, 0).toLocaleString('en-GB')} words)`,
    story: f.story,
    chapters: f.chapters,
    entries: f.entries,
    scenes: f.scenes,
    traps: TRAPS4,
    probes,
    planted: PLANTED
  }
}

/** Version 3's outline as a story with no words yet (what the writer starts from). */
export function outlineV3(): StoryData {
  return {
    version: 3,
    source: 'story3.ts (outline)',
    story: STORY3,
    chapters: CHAPTERS3,
    entries: ENTRIES3,
    scenes: [],
    traps: TRAPS3,
    probes: []
  }
}
