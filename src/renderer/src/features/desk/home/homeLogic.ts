// The desk's story home, worked out from what the app already has: the outline (stats, the chapters on their shelf, the
// next planned scene), the open scene's last words, the plot threads board, the codex (the cast), the memory's status
// and the story's open issues. No React, so it is unit-tested (homeLogic.test.ts).
import type { CodexCard } from '@shared/contracts/entryViews'
import type { ThreadsBoard } from '@shared/contracts/worldViews'
import type { Chapter, ID, MemoryStatus, Outline, SceneMeta, SceneStatus } from '@shared/types'
import { genreById } from '@shared/genres'
import { numberWords } from '@shared/numberWords'
import { chapterNumeral } from '@/features/desk/spine/spineLayout'
import { whenText } from '@/features/start/startLogic'

const n = (x: number): string => x.toLocaleString('en-GB')
const plural = (x: number, one: string, many = `${one}s`): string => `${n(x)} ${x === 1 ? one : many}`

/** The scenes in reading order (chapter by chapter, each chapter's scenes by position). */
export function readingOrder(outline: Pick<Outline, 'chapters' | 'scenes'>): SceneMeta[] {
  const byChapter = new Map<ID, SceneMeta[]>()
  for (const s of outline.scenes) {
    const list = byChapter.get(s.chapterId) ?? []
    list.push(s)
    byChapter.set(s.chapterId, list)
  }
  return outline.chapters.flatMap((c) => (byChapter.get(c.id) ?? []).sort((a, b) => a.position - b.position))
}

/** Each chapter's scenes, in order. */
export function scenesOf(outline: Pick<Outline, 'scenes'>, chapterId: ID): SceneMeta[] {
  return outline.scenes.filter((s) => s.chapterId === chapterId).sort((a, b) => a.position - b.position)
}

export interface StoryStats {
  words: number
  chapters: number
  scenes: number
  /** Scenes marked done. */
  done: number
}

export function storyStats(outline: Pick<Outline, 'chapters' | 'scenes'>): StoryStats {
  return {
    words: outline.scenes.reduce((a, s) => a + s.wordCount, 0),
    chapters: outline.chapters.length,
    scenes: outline.scenes.length,
    done: outline.scenes.filter((s) => s.status === 'done').length
  }
}

/** The stats line, read aloud: "1,167 words, 2 chapters, 5 scenes, 3 done". */
export const statsLabel = (s: StoryStats): string =>
  [plural(s.words, 'word'), plural(s.chapters, 'chapter'), plural(s.scenes, 'scene'), `${n(s.done)} done`].join(', ')

export interface ShelfScene {
  id: ID
  title: string
  status: SceneStatus
  /** The scene Adam is in. */
  current: boolean
}

export interface ShelfChapter {
  id: ID
  /** "I", "XII". */
  numeral: string
  /** "Chapter One"; a "Prologue" says so on its own. */
  label: string
  /** Its title, or '' when it has none. */
  title: string
  scenes: ShelfScene[]
  words: number
  done: number
  /** 'done': every scene done; 'empty': no scenes yet; otherwise under way. */
  state: 'done' | 'progress' | 'empty'
  /** Adam's scene is in it. */
  current: boolean
}

const STANDALONE = /^(prologue|epilogue|interlude|afterword|foreword|preface|coda)\b/i

/** The chapters on the shelf, with their scenes as dots and how far along each is. */
export function chapterShelf(outline: Pick<Outline, 'chapters' | 'scenes'>, currentSceneId: ID | null): ShelfChapter[] {
  return outline.chapters.map((c: Chapter, i): ShelfChapter => {
    const scenes = scenesOf(outline, c.id)
    const done = scenes.filter((s) => s.status === 'done').length
    const title = c.title.trim()
    const standalone = STANDALONE.test(title)
    return {
      id: c.id,
      numeral: chapterNumeral(i + 1),
      label: standalone ? title : `Chapter ${numberWords(i + 1)}`,
      title: standalone ? '' : title,
      scenes: scenes.map((s) => ({ id: s.id, title: s.title, status: s.status, current: s.id === currentSceneId })),
      words: scenes.reduce((a, s) => a + s.wordCount, 0),
      done,
      state: !scenes.length ? 'empty' : done === scenes.length ? 'done' : 'progress',
      current: scenes.some((s) => s.id === currentSceneId)
    }
  })
}

/** A chapter's line under its title, read aloud: "Chapter Two, The Drowned Steps. 1 of 3 scenes done, 596 words." */
export function chapterAria(c: ShelfChapter): string {
  const name = c.title ? `${c.label}, ${c.title}` : c.label
  const scenes = c.scenes.length ? `${n(c.done)} of ${plural(c.scenes.length, 'scene')} done, ${plural(c.words, 'word')}` : 'No scenes yet'
  return `${name}. ${scenes}${c.current ? ', you are in it' : ''}. Open it on the story board.`
}

/**
 * The scene "Next scene ideas" are for: the first planned scene with no words after the one Adam is in (or from the
 * start, when he is in none), in reading order. Null when there is none: the button then doesn't show.
 */
export function nextPlannedScene(outline: Pick<Outline, 'chapters' | 'scenes'>, fromSceneId: ID | null): SceneMeta | null {
  const order = readingOrder(outline)
  const from = fromSceneId ? order.findIndex((s) => s.id === fromSceneId) : -1
  return order.slice(from + 1).find((s) => s.status === 'planned' && s.wordCount === 0) ?? null
}

/** Where a scene is, in a few words: "Chapter Two, scene 3". */
export function sceneWhere(outline: Pick<Outline, 'chapters' | 'scenes'>, sceneId: ID): string {
  const scene = outline.scenes.find((s) => s.id === sceneId)
  if (!scene) return ''
  const ci = outline.chapters.findIndex((c) => c.id === scene.chapterId)
  const si = scenesOf(outline, scene.chapterId).findIndex((s) => s.id === sceneId)
  return ci < 0 ? '' : `Chapter ${numberWords(ci + 1)}, scene ${si + 1}`
}

/**
 * The last words of a scene, about `words` long, starting at a sentence where one starts near enough: "…Iska said
 * nothing. Behind them the sea was coming back." Empty for a scene with no words.
 */
export function lastLines(text: string, words = 22): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  const all = flat.split(' ')
  if (all.length <= words) return flat
  const tail = all.slice(-words)
  const ends = (w: string | undefined): boolean => !!w && /[.!?…][”’"')]*$/.test(w)
  // Start at a sentence that begins in the first half of the tail, so it doesn't open mid-sentence.
  const start = ends(all[all.length - words - 1]) ? 0 : tail.findIndex((_, i) => i > 0 && i < words / 2 && ends(tail[i - 1]))
  return `…${(start > 0 ? tail.slice(start) : tail).join(' ')}`
}

export interface ThreadRow {
  id: ID
  name: string
  state: 'open' | 'resolved' | 'planned'
  /** "Open for 2 chapters", "Resolved in Ch 2, Sc 1", "Planned on the cards". */
  note: string
  /** Where along the story (0 at its first scene, 1 at its last) it was set up and paid off, for its little string. */
  from: number | null
  to: number | null
  /** Open for many chapters. */
  longOpen: boolean
}

/** "Book 1, Ch 2, Sc 1" (or "The Keeper’s Light, Ch 2, Sc 1") without the story: the home is one story's. */
const placeLabel = (label: string): string => {
  const i = label.search(/\bCh \d/)
  return i > 0 ? label.slice(i) : label
}

/** The plot threads for the home, open ones first, each with where it sits along the story. */
export function threadRows(board: Pick<ThreadsBoard, 'threads'>, outline: Pick<Outline, 'chapters' | 'scenes'>, currentSceneId: ID | null): ThreadRow[] {
  const order = readingOrder(outline).map((s) => s.id)
  const at = (sceneId: ID | null | undefined): number | null => {
    const i = sceneId ? order.indexOf(sceneId) : -1
    return i < 0 ? null : order.length > 1 ? i / (order.length - 1) : 0
  }
  const now = at(currentSceneId) ?? 1
  const rank = { open: 0, planned: 1, resolved: 2 } as const
  return board.threads
    .map((t): ThreadRow => {
      const from = at(t.setUp?.sceneId) ?? (t.setUp ? 0 : null)
      if (t.column === 'resolved') {
        const where = t.paidOff?.label ? placeLabel(t.paidOff.label) : ''
        return { id: t.id, name: t.name, state: 'resolved', note: where ? `Resolved in ${where}` : 'Resolved', from, to: at(t.paidOff?.sceneId), longOpen: false }
      }
      if (t.column === 'planned') return { id: t.id, name: t.name, state: 'planned', note: 'Planned on the cards', from, to: null, longOpen: false }
      const ch = t.openChapters
      const note = ch == null ? 'Open' : ch === 0 ? 'Opened this chapter' : `Open for ${plural(ch, 'chapter')}`
      return { id: t.id, name: t.name, state: 'open', note, from, to: Math.max(now, from ?? 0), longOpen: t.longOpen }
    })
    .sort((a, b) => rank[a.state] - rank[b.state])
}

/** "2 open · 1 resolved". */
export function threadsAside(rows: ThreadRow[]): string {
  const open = rows.filter((r) => r.state === 'open').length
  const resolved = rows.filter((r) => r.state === 'resolved').length
  const planned = rows.filter((r) => r.state === 'planned').length
  return [open ? `${n(open)} open` : '', planned ? `${n(planned)} planned` : '', resolved ? `${n(resolved)} resolved` : ''].filter(Boolean).join(' · ')
}

export interface Cast {
  /** The most important characters first, at most `max`. */
  people: Pick<CodexCard, 'id' | 'name' | 'kind' | 'image' | 'summary'>[]
  /** "4 characters · 3 places". */
  line: string
  /** The best-known places, by name. */
  places: string[]
  /** The characters beyond `people`, by name (the cast's "+N", named on hover). */
  others: string[]
}

/** The cast for the home: the story's most important characters, how many characters and places, and the main places. */
export function castOf(cards: CodexCard[], storyId: ID | null, max = 4): Cast {
  const inStory = (c: CodexCard): boolean => !storyId || !c.storyIds.length || c.storyIds.includes(storyId)
  const byImportance = (a: CodexCard, b: CodexCard): number => b.importance - a.importance || a.name.localeCompare(b.name)
  const chars = cards.filter((c) => c.kind === 'character' && inStory(c)).sort(byImportance)
  const places = cards.filter((c) => c.kind === 'place' && inStory(c)).sort(byImportance)
  const line = [chars.length ? plural(chars.length, 'character') : '', places.length ? plural(places.length, 'place') : ''].filter(Boolean).join(' · ')
  return { people: chars.slice(0, max), line, places: places.slice(0, 3).map((p) => p.name), others: chars.slice(max).map((c) => c.name) }
}

/** The memory, in the home's footer: "Memory up to date · updated 2 hours ago", or what it is doing or missing. */
export function memoryLine(status: MemoryStatus | null, nowMs: number = Date.now()): { text: string; ok: boolean } {
  if (!status) return { text: 'Memory', ok: true }
  if (status.reading) return { text: `Memory: reading “${status.reading.title || 'a scene'}”`, ok: true }
  if (status.failed) return { text: `Memory not updated for ${plural(status.failed, 'scene')}`, ok: false }
  if (status.behind) return { text: `Memory: ${plural(status.behind, 'scene')} to read`, ok: true }
  const when = status.lastUpdate ? whenText(status.lastUpdate.at, nowMs) : ''
  return { text: when ? `Memory up to date · updated ${when}` : 'Memory up to date', ok: true }
}

/** The story's open issues, in the footer: "No open issues", "3 issues to look at · 1 must fix". */
export function checkLine(counts: Record<ID, { count: number; mustFix: number }> | null): { text: string; ok: boolean } {
  if (!counts) return { text: 'Checks', ok: true }
  const all = Object.values(counts).reduce((a, c) => ({ count: a.count + c.count, mustFix: a.mustFix + c.mustFix }), { count: 0, mustFix: 0 })
  if (!all.count) return { text: 'No open issues', ok: true }
  const must = all.mustFix ? ` · ${n(all.mustFix)} must fix` : ''
  return { text: `${plural(all.count, 'issue')} to look at${must}`, ok: false }
}

/**
 * The book's kicker on its cover: "Book One", "Book Two" counting the world's main stories in reading (shelf) order;
 * a prequel or a side story says so.
 */
export function bookKicker(storyId: ID, shelf: { id: ID; kind: string }[]): string {
  let book = 0
  for (const s of shelf) {
    const main = s.kind !== 'side' && s.kind !== 'prequel'
    if (main) book++
    if (s.id === storyId) return s.kind === 'prequel' ? 'A prequel' : s.kind === 'side' ? 'A side story' : `Book ${numberWords(book)}`
  }
  return 'Book One'
}

/** A steady number from 0 to 359 for an id, so a story with no genre still keeps its own cover colour. */
export function hueOfId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return (h >>> 0) % 360
}

/**
 * The cover's colour: a hue Adam chose for it, else its first genre's (the story's own genres, else the world's), else
 * one of its own from its id.
 */
export function coverHue(storyId: ID, genres: readonly string[], chosen?: number | null): number {
  if (chosen != null && Number.isFinite(chosen)) return ((Math.round(chosen) % 360) + 360) % 360
  for (const g of genres) {
    const hue = genreById(g)?.hue
    if (hue != null) return hue
  }
  return hueOfId(storyId)
}

/** The width and height the home is drawn for at its natural size (its column, with room either side; its usual height). */
export const HOME_BASE = { w: 1600, h: 1060 }
/** The most the home grows on a big screen. */
export const HOME_MAX_SCALE = 1.32

/**
 * How much larger the home is drawn in a room of w×h (beside the spine): 1 up to about 1920×1080, growing with the room
 * on a large screen (Adam's 2560×1440: its cover, title, shelf and the row under it all larger together, the whole page
 * using the window rather than a small block in the middle of it), never more than HOME_MAX_SCALE. Whichever runs out
 * first, the width or the height, sets it, so it never needs scrolling where it didn't before.
 */
export function homeScale(w: number, h: number, twoColumns = homeTwoColumns(w)): number {
  if (!(w > 0) || !(h > 0)) return 1
  const base = twoColumns ? HOME_WIDE_BASE : HOME_BASE
  const s = Math.min(w / base.w, h / base.h, HOME_MAX_SCALE)
  return s <= 1 ? 1 : Math.round(s * 100) / 100
}

/** The room beside the spine from which the home lays out in two columns (an ultrawide screen, about 2,800 px and up). */
export const HOME_TWO_COLUMNS_FROM = 2400
/** The two-column home at its natural size: the book beside the shelf, the threads, the cast and the week. */
export const HOME_WIDE_BASE = { w: 2340, h: 720 }

/**
 * Whether the home lays out in two columns in a room `w` wide (Adam, Phase 6: an ultrawide left wide bands either side
 * of the one column): the book, its title, Continue writing and the last lines on the left; the shelf, the threads, the
 * cast and the week on the right. 1920 to 2560 keep the one column.
 */
export const homeTwoColumns = (w: number): boolean => w >= HOME_TWO_COLUMNS_FROM
