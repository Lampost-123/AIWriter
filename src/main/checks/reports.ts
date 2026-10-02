// The consistency reports (milestone 5, spec "Consistency checker"): repetition, per chapter and across
// chapters, and plot threads left open too long or paid off with no setup. The work is pure (over a
// story's text, or the plot threads board and the line); repetitionReportOf and threadsReportOf read the
// open world and keep each answer until anything is written to it, as the world views do. Tested in
// reports.test.ts.
//
// Repetition. A chapter's words are counted with names left alone (the world's characters, places,
// groups, items and glossary terms are meant to repeat) and common words skipped. A word is flagged when
// it is used far more than prose needs (8 times, or once every 400 words in a long chapter), a two-word
// phrase 4 times (once every 1,500 words), a three- or four-word phrase 3 times (once every 3,000 words).
// Phrases never cross a sentence, a comma or a name, and never start or end on a common word ("the
// door" is "door"). Where a phrase and the shorter words inside it are flagged about as often, only the
// phrase shows. Each chapter lists at most 8, the most overused first, so a chapter reads as a short list.
// Pet phrases are 3 to 5 word phrases found in 3 chapters or more (in a long story, at least one chapter
// in ten), most widespread first, at most 15.
import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import type { RepetitionItem, RepetitionReport, ThreadsReport } from '@shared/contracts/checks'
import type { ThreadsBoard } from '@shared/contracts/worldViews'
import type { Line, MemoryData, WorldShape } from '../memory/types'
import { buildLine, labeler } from '../memory/line'
import { indexChanges } from '../memory/state'
import { loadMemoryData, loadShape } from '../memory/scene'
import { getStory } from '../db/repo'
import { changesMade, sceneCards, type CardInfo } from '../db/worldViews'
import { storyTexts, worldNames, type ChapterText } from '../db/checksReports'
import { threadsBoardOf } from '../worldViews'

type DB = Database.Database

// ---------- Thresholds ----------

/** A word in one chapter: at least this many times, and at least once every WORD_EVERY words. */
export const WORD_MIN = 8
export const WORD_EVERY = 400
/** A two-word phrase in one chapter. */
export const PAIR_MIN = 4
export const PAIR_EVERY = 1500
/** A three- or four-word phrase in one chapter. */
export const LONG_MIN = 3
export const LONG_EVERY = 3000
/** At most this many words and phrases for each chapter. */
export const CHAPTER_ITEMS = 8
/** A pet phrase is in at least this many chapters (and one chapter in PET_SHARE of a long story). */
export const PET_MIN_CHAPTERS = 3
export const PET_SHARE = 10
export const PET_ITEMS = 15

/** Words too common to count: articles, pronouns, linking words, the verbs every sentence needs. */
const COMMON = new Set(
  `a about above across after afterwards again against ago ah all almost along already also although always am among an and
  another any anyone anything anyway anywhere are around as at away back be became because become becomes been before behind
  being below beneath beside besides between beyond both but by came can cannot come comes could did do does doing done down
  during each either else enough even ever every everyone everything except few for from get gets getting go goes going gone
  got had has have having he her here hers herself him himself his how however i if in inside instead into is it its itself
  just know knew let like made make many may maybe me might mine more most much must my myself near need neither never no nobody
  none nor not nothing now of off oh ok okay on once one only onto or other others our ours ourselves out outside over own
  perhaps please put quite rather really said same say says see seemed shall she should since so some someone something
  somewhere still such take than that the their theirs them themselves then there these they thing things this those though
  through till to too toward towards two under until up upon us very was way we well went were what whatever when where whether
  which while who whom whose why will with within without would yeah yes yet you your yours yourself yourselves mr mrs ms dr sir
  told asked ask tell think thought want wanted looked look looks seem seems still almost`
    .split(/\s+/)
    .filter(Boolean)
)

// ---------- Reading the text ----------

/** A word, with what it is for counting: `key` keeps possessives ("mara's"), `base` drops them ("mara"). */
interface Tok {
  key: string
  base: string
  /** Not a name or a common word: may start or end a phrase. */
  edge: boolean
  /** Counted on its own (an edge word of four letters or more). */
  counted: boolean
}

// A word (letters and digits, with apostrophes and hyphens inside), or something that ends a phrase.
const PIECES = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*|[.!?;:,()[\]{}"“”‘…–—\n]/gu
const WORD_START = /^[\p{L}\p{N}]/u

const keyOf = (word: string): string => word.toLowerCase().replace(/’/g, "'")
const baseOf = (key: string): string => key.replace(/'s$/, '')

/** The words of a name worth matching: "the Order of Ash" is "order" and "ash". */
export function nameWordsOf(names: string[]): Set<string> {
  const out = new Set<string>()
  for (const name of names) {
    for (const m of name.matchAll(PIECES)) {
      if (!WORD_START.test(m[0])) continue
      const base = baseOf(keyOf(m[0]))
      if (base.length >= 2 && !COMMON.has(base)) out.add(base)
    }
  }
  return out
}

/** The runs of words in some text that a phrase may span (between punctuation and names). */
function runsOf(text: string, names: Set<string>): { runs: Tok[][]; words: number } {
  const runs: Tok[][] = []
  let run: Tok[] = []
  let words = 0
  const end = (): void => {
    if (run.length) runs.push(run)
    run = []
  }
  for (const m of text.matchAll(PIECES)) {
    const piece = m[0]
    if (!WORD_START.test(piece)) {
      end()
      continue
    }
    words++
    const key = keyOf(piece)
    const base = baseOf(key)
    if (names.has(base)) {
      end()
      continue
    }
    const common = COMMON.has(key) || COMMON.has(base) || base.includes("'") || /^\p{N}/u.test(base)
    const edge = !common && base.length >= 2
    run.push({ key, base, edge, counted: edge && base.length >= 4 })
  }
  end()
  return { runs, words }
}

// ---------- Counting ----------

interface Tally {
  count: number
  /** The first scene it appears in. */
  sceneId: ID
}

const bump = (map: Map<string, Tally>, key: string, sceneId: ID): void => {
  const t = map.get(key)
  if (t) t.count++
  else map.set(key, { count: 1, sceneId })
}

/** Every phrase of `min` to `max` words in a run that starts and ends on an edge word. */
function phrasesOf(run: Tok[], min: number, max: number, each: (key: string, n: number) => void): void {
  for (let i = 0; i < run.length; i++) {
    if (!run[i].edge) continue
    let key = run[i].key
    for (let n = 2; n <= max && i + n <= run.length; n++) {
      const last = run[i + n - 1]
      key += ' ' + last.key
      if (n >= min && last.edge) each(key, n)
    }
  }
}

interface Candidate extends RepetitionItem {
  /** Its words, for finding a shorter one inside it. */
  words: string[]
  /** How far over its threshold it is. */
  over: number
}

/** True when `inner`'s words appear in a row inside `outer`'s (possessives aside). */
function inside(inner: string[], outer: string[]): boolean {
  if (inner.length >= outer.length) return false
  const o = outer.map(baseOf)
  const w = inner.map(baseOf)
  for (let i = 0; i + w.length <= o.length; i++) if (w.every((x, j) => o[i + j] === x)) return true
  return false
}

/** Longest first: a shorter one goes when a longer one holding it is kept at about the same rate. */
function dropInner<T extends { words: string[] }>(items: T[], size: (t: T) => number, share: number): T[] {
  const kept: T[] = []
  for (const c of [...items].sort((a, b) => b.words.length - a.words.length)) {
    if (!kept.some((k) => inside(c.words, k.words) && size(k) >= size(c) * share)) kept.push(c)
  }
  return kept
}

export interface RepetitionInput {
  storyId: ID
  chapters: ChapterText[]
  /** The names left alone (nameWordsOf). */
  names: Set<string>
}

/** The repetition report for a story's text. */
export function buildRepetition({ storyId, chapters, names }: RepetitionInput): RepetitionReport {
  const pets = new Map<string, { chapters: number[]; count: number; sceneId: ID; n: number }>()
  const out: RepetitionReport['chapters'] = []

  chapters.forEach((ch, ci) => {
    const words = new Map<string, Tally>()
    const pairs = new Map<string, Tally>()
    const longs = new Map<string, Tally>()
    let total = 0
    for (const scene of ch.scenes) {
      const read = runsOf(scene.text, names)
      total += read.words
      for (const run of read.runs) {
        for (const t of run) if (t.counted) bump(words, t.base, scene.sceneId)
        phrasesOf(run, 2, 5, (key, n) => {
          if (n === 2) bump(pairs, key, scene.sceneId)
          else if (n <= 4) bump(longs, key, scene.sceneId)
          if (n < 3) return
          const p = pets.get(key)
          if (!p) pets.set(key, { chapters: [ci], count: 1, sceneId: scene.sceneId, n })
          else {
            p.count++
            if (p.chapters[p.chapters.length - 1] !== ci) p.chapters.push(ci)
          }
        })
      }
    }

    const found: Candidate[] = []
    const take = (map: Map<string, Tally>, min: number, every: number): void => {
      const need = Math.max(min, Math.ceil(total / every))
      for (const [phrase, t] of map) {
        if (t.count < need) continue
        found.push({ phrase, count: t.count, chapterIds: [ch.chapterId], sceneId: t.sceneId, words: phrase.split(' '), over: t.count / need })
      }
    }
    take(words, WORD_MIN, WORD_EVERY)
    take(pairs, PAIR_MIN, PAIR_EVERY)
    take(longs, LONG_MIN, LONG_EVERY)
    const items = dropInner(found, (c) => c.count, 0.6)
      .sort((a, b) => b.over - a.over || b.count - a.count || a.phrase.localeCompare(b.phrase))
      .slice(0, CHAPTER_ITEMS)
      .sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase))
      .map(({ words: _w, over: _o, ...item }) => item)
    out.push({ chapterId: ch.chapterId, title: ch.title, items })
  })

  const minChapters = Math.max(PET_MIN_CHAPTERS, Math.ceil(chapters.length / PET_SHARE))
  const petList: (RepetitionItem & { words: string[]; spread: number })[] = []
  for (const [phrase, p] of pets) {
    if (p.chapters.length < minChapters) continue
    petList.push({
      phrase,
      count: p.count,
      chapterIds: p.chapters.map((i) => chapters[i].chapterId),
      sceneId: p.sceneId,
      words: phrase.split(' '),
      spread: p.chapters.length
    })
  }
  const petPhrases = dropInner(petList, (p) => p.spread, 0.75)
    .sort((a, b) => b.spread - a.spread || b.count - a.count || a.phrase.localeCompare(b.phrase))
    .slice(0, PET_ITEMS)
    .map(({ words: _w, spread: _s, ...item }) => item)

  return { storyId, chapters: out, petPhrases }
}

// ---------- Plot threads ----------

export interface ThreadsInput {
  storyId: ID
  /** The plot threads board as seen in this story (worldViews/threads.ts decides what is open too long). */
  board: ThreadsBoard
  shape: WorldShape
  data: MemoryData
  /** The story's line through its end. */
  line: Line
  cards: Map<ID, CardInfo>
}

/**
 * Threads the board marks as open too long, and each plot thread a scene card of this story pays off with
 * nothing on the line before that scene setting it up: no scene card's "sets up" and no opening in the
 * memory (as the board decides open and planned). Each thread is listed once, at its first such payoff.
 */
export function buildThreadsReport({ storyId, board, shape, data, line, cards }: ThreadsInput): ThreadsReport {
  const openTooLong: ThreadsReport['openTooLong'] = board.threads
    .filter((t) => t.column === 'open' && t.longOpen)
    .map((t) => ({
      entryId: t.id,
      name: t.name,
      openedIn: t.setUp?.label ?? '',
      chapters: t.openChapters ?? 0,
      openedAt: t.setUp?.sceneId && t.setUp.storyId ? { storyId: t.setUp.storyId, sceneId: t.setUp.sceneId } : null
    }))

  const names = new Map(data.entries.filter((e) => e.kind === 'thread').map((e) => [e.id, e.name.trim() || 'Unnamed plot thread']))
  const label = labeler(shape)
  const changes = indexChanges(data.changes)
  const setUp = new Set<ID>()
  const opens = (list: MemoryData['changes'] | undefined): void => {
    for (const c of list ?? []) if (c.kind === 'thread' && c.payload.status === 'open') setUp.add(c.entryId)
  }
  opens(changes.baseline)
  const noSetup: ThreadsReport['noSetup'] = []
  const listed = new Set<ID>()
  for (const step of line.steps) {
    if (step.type === 'start-changes') opens(changes.byStory.get(step.storyId))
    if (step.type !== 'scene') continue
    const card = cards.get(step.sceneId)
    // A payoff counts against what came before this scene; the scene's own setups count after it.
    if (step.storyId === storyId) {
      for (const id of card?.paysOffIds ?? []) {
        const name = names.get(id)
        if (!name || setUp.has(id) || listed.has(id)) continue
        listed.add(id)
        noSetup.push({ entryId: id, name, sceneId: step.sceneId, label: label({ storyId, sceneId: step.sceneId }) })
      }
    }
    for (const id of card?.setsUpIds ?? []) setUp.add(id)
    opens(changes.byScene.get(step.sceneId))
  }
  return { storyId, openTooLong, noSetup }
}

// ---------- Reading the open world ----------

/** Each story's reports, while nothing has been written to the world. */
interface Kept {
  changed: number
  repetition: Map<ID, RepetitionReport>
  threads: Map<ID, ThreadsReport>
}

const kept = new WeakMap<DB, Kept>()

function keptFor(db: DB): Kept {
  const changed = changesMade(db)
  let k = kept.get(db)
  if (!k || k.changed !== changed) kept.set(db, (k = { changed, repetition: new Map(), threads: new Map() }))
  return k
}

export function repetitionReportOf(db: DB, storyId: ID): RepetitionReport {
  getStory(db, storyId)
  const k = keptFor(db)
  let r = k.repetition.get(storyId)
  if (!r) k.repetition.set(storyId, (r = buildRepetition({ storyId, chapters: storyTexts(db, storyId), names: nameWordsOf(worldNames(db)) })))
  return r
}

export function threadsReportOf(db: DB, storyId: ID): ThreadsReport {
  const board = threadsBoardOf(db, storyId)
  const k = keptFor(db)
  let r = k.threads.get(storyId)
  if (!r) {
    const shape = loadShape(db)
    const line = buildLine(shape, { storyId, through: 'end' })
    k.threads.set(storyId, (r = buildThreadsReport({ storyId, board, shape, data: loadMemoryData(db), line, cards: sceneCards(db) })))
  }
  return r
}
