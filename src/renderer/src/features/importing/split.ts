// The split of an imported manuscript into acts, chapters and scenes (milestone 6), and Adam's changes to it.
// Pure, so it is unit-tested; the import page shows it and turns it into the plan it imports.
//
// - Every heading and scene break mark is a boundary with a role: 'act', 'chapter', 'scene' or 'text'
//   (ordinary text: a heading becomes a paragraph, a break mark a line across the page inside the scene).
//   A paragraph can be a boundary too (a page break in a Word file with no headings, or where Adam split a
//   scene); its words stay in the scene it starts.
// - proposeRoles reads the file's levels: the level holding the "Chapter ..." headings (else the top level, or
//   the second when the top one holds a few long parts) is chapters, the level above it acts, the level below
//   scenes; deeper headings are ordinary text. Break marks start scenes. A file with no chapters at all is
//   split at its page breaks.
// - Adam's changes are kept apart (SplitEdits: a role or a title by boundary), so the proposal is never lost.
// - Text before the first chapter becomes its own opening chapter ("Opening"; "Prologue" when headed so).

import type { ImportPlan, ImportPlanChapter, Manuscript, ManuscriptBlock, ManuscriptRun } from '@shared/contracts/importing'
import { countWords } from '@shared/defaults'

export type Role = 'act' | 'chapter' | 'scene' | 'text'

/** Adam's changes to the proposed split. */
export interface SplitEdits {
  /** What a boundary is, by block index: a heading or break mark, or a paragraph that starts a chapter or scene. */
  roles: Record<number, Role>
  /** Titles Adam typed, by key (`act:3`, `chapter:12`, `scene:40`; the opening chapter is `chapter:-1`). */
  titles: Record<string, string>
}

export const noEdits = (): SplitEdits => ({ roles: {}, titles: {} })

/** The opening chapter's boundary: the text before the first chapter has none. */
export const OPENING = -1

export const titleKey = (kind: 'act' | 'chapter' | 'scene', at: number): string => `${kind}:${at}`

// ---------- Proposing ----------

/** How long a top-level section must be, on average, to be an act (part) over chapters rather than a chapter over scenes. */
const ACT_WORDS = 15_000
/** At most this many top-level sections can be acts. */
const MOST_ACTS = 12

/** Words in each block (paragraphs and headings), worked out once per manuscript. */
const wordCache = new WeakMap<ManuscriptBlock[], number[]>()
export function blockWords(blocks: ManuscriptBlock[]): number[] {
  let w = wordCache.get(blocks)
  if (!w) {
    w = blocks.map((b) => (b.kind === 'para' || b.kind === 'heading' ? countWords(b.text) : 0))
    wordCache.set(blocks, w)
  }
  return w
}

/** The level that holds the chapters, among the file's heading levels (null when its headings have no levels). */
function chapterLevel(blocks: ManuscriptBlock[]): number | null {
  const counts = new Map<number, { all: number; chapters: number; parts: number }>()
  for (const b of blocks) {
    if (b.kind !== 'heading' || b.level == null) continue
    const c = counts.get(b.level) ?? { all: 0, chapters: 0, parts: 0 }
    c.all++
    if (b.hint === 'chapter') c.chapters++
    if (b.hint === 'part') c.parts++
    counts.set(b.level, c)
  }
  const levels = [...counts.keys()].sort((a, b) => a - b)
  if (!levels.length) return null
  // Where the "Chapter ..." headings are.
  const byChapters = levels.filter((l) => counts.get(l)!.chapters > 0).sort((a, b) => counts.get(b)!.chapters - counts.get(a)!.chapters || a - b)
  if (byChapters.length) return byChapters[0]
  // Below the "Part ..." headings.
  const partLevel = levels.find((l) => counts.get(l)!.parts > 0)
  if (partLevel != null) return levels.find((l) => l > partLevel) ?? partLevel
  if (levels.length === 1) return levels[0]
  // A few long sections at the top are parts over chapters; many shorter ones are chapters over scenes.
  const top = levels[0]
  const words = blockWords(blocks)
  const total = words.reduce((n, w, i) => n + (blocks[i].kind === 'para' ? w : 0), 0)
  const topCount = counts.get(top)!.all
  return topCount <= MOST_ACTS && total / topCount >= ACT_WORDS ? levels[1] : top
}

/** The proposed role of every boundary (headings, break marks, and page breaks when the file has no chapters), by block index. */
export function proposeRoles(blocks: ManuscriptBlock[]): Record<number, Role> {
  const roles: Record<number, Role> = {}
  const chapters = chapterLevel(blocks)
  const levels = [...new Set(blocks.filter((b) => b.kind === 'heading' && b.level != null).map((b) => b.level!))].sort((a, b) => a - b)
  const sceneLevel = chapters == null ? null : (levels.find((l) => l > chapters) ?? null)
  blocks.forEach((b, i) => {
    if (b.kind === 'break') roles[i] = 'scene'
    if (b.kind !== 'heading') return
    if (b.hint === 'part') roles[i] = 'act'
    else if (b.hint === 'chapter') roles[i] = b.level != null && sceneLevel != null && b.level >= sceneLevel ? 'scene' : 'chapter'
    else if (b.hint === 'scene') roles[i] = 'scene'
    else if (b.level == null || chapters == null) roles[i] = 'chapter'
    else if (b.level < chapters) roles[i] = 'act'
    else if (b.level === chapters) roles[i] = 'chapter'
    else if (b.level === sceneLevel) roles[i] = 'scene'
    else roles[i] = 'text'
  })
  // No chapters at all: a Word file's page breaks start them.
  if (!Object.values(roles).includes('chapter')) {
    const breaks = blocks.map((b, i) => (b.kind === 'para' && b.pageBreak ? i : -1)).filter((i) => i >= 0)
    if (breaks.length >= 2) for (const i of breaks) roles[i] = 'chapter'
  }
  return roles
}

// ---------- The outline ----------

export interface OutlineScene {
  /** Its title's key (`scene:<at>`); the first scene of a chapter is keyed by the chapter's boundary. */
  key: string
  /** The block that starts it (its heading, break mark or first paragraph); for a chapter's first scene, the chapter's. */
  at: number
  /** True when it starts at a boundary of its own (so it can be merged with the scene before, or made a chapter). */
  own: boolean
  title: string
  /** Its title before Adam changed it. */
  proposed: string
  /** Blocks of its text: from `from` up to (not including) `to`. */
  from: number
  to: number
  words: number
  /** The opening words, for the preview. */
  opening: string
}

export interface OutlineChapter {
  key: string
  at: number
  title: string
  proposed: string
  /** Index into Outline.acts; null for none. */
  act: number | null
  scenes: OutlineScene[]
  words: number
}

export interface OutlineAct {
  key: string
  at: number
  title: string
  proposed: string
}

export interface Outline {
  acts: OutlineAct[]
  chapters: OutlineChapter[]
  scenes: number
  words: number
}

/** A boundary's role now: Adam's choice, else the proposal; a paragraph with neither is just text. */
export function roleAt(blocks: ManuscriptBlock[], proposed: Record<number, Role>, edits: SplitEdits, i: number): Role {
  const b = blocks[i]
  if (!b || b.kind === 'title') return 'text'
  const r = edits.roles[i] ?? proposed[i]
  if (r) return b.kind === 'para' && r === 'act' ? 'chapter' : r
  return b.kind === 'heading' ? 'chapter' : b.kind === 'break' ? 'scene' : 'text'
}

/** About this many words of a scene's opening show in the preview. */
const OPENING_WORDS = 18

function openingOf(blocks: ManuscriptBlock[], from: number, to: number): string {
  const out: string[] = []
  for (let i = from; i < to && out.length < OPENING_WORDS; i++) {
    const b = blocks[i]
    if (b.kind !== 'para' && b.kind !== 'heading') continue
    for (const w of b.text.split(/\s+/)) {
      if (w) out.push(w)
      if (out.length >= OPENING_WORDS) break
    }
  }
  return out.join(' ')
}

/** Text before the first chapter: "Prologue" when it is headed so, else "Opening". */
export const OPENING_TITLE = 'Opening'

/** The acts, chapters and scenes the manuscript splits into, with Adam's changes. */
export function buildOutline(m: Pick<Manuscript, 'blocks'>, proposed: Record<number, Role>, edits: SplitEdits): Outline {
  const { blocks } = m
  const words = blockWords(blocks)
  const acts: OutlineAct[] = []
  const chapters: OutlineChapter[] = []
  let chapter: OutlineChapter | null = null
  let scene: OutlineScene | null = null
  const titleOf = (key: string, proposedTitle: string): string => {
    const t = edits.titles[key]
    return t != null && t.trim() ? t : proposedTitle
  }
  const closeScene = (to: number): void => {
    if (!scene || !chapter) return
    scene.to = to
    chapter.scenes.push(scene)
    scene = null
  }
  const newChapter = (at: number, proposedTitle: string): void => {
    closeScene(at)
    const key = titleKey('chapter', at)
    chapter = { key, at, title: titleOf(key, proposedTitle), proposed: proposedTitle, act: acts.length ? acts.length - 1 : null, scenes: [], words: 0 }
    chapters.push(chapter)
  }
  const newScene = (at: number, from: number, own: boolean, proposedTitle: string): void => {
    closeScene(at)
    const key = titleKey('scene', own ? at : chapter!.at)
    scene = { key, at: own ? at : chapter!.at, own, title: titleOf(key, proposedTitle), proposed: proposedTitle, from, to: from, words: 0, opening: '' }
  }
  /** Text with no chapter yet: an opening chapter (in the act, if one has started). */
  const ensure = (i: number): void => {
    if (!chapter) newChapter(acts.length ? acts[acts.length - 1].at : OPENING, OPENING_TITLE)
    if (!scene) newScene(i, i, false, '')
  }

  blocks.forEach((b, i) => {
    if (b.kind === 'title') return
    const role = roleAt(blocks, proposed, edits, i)
    const consumes = b.kind !== 'para'
    if (role === 'act' && b.kind !== 'para') {
      closeScene(i)
      chapter = null
      const key = titleKey('act', i)
      acts.push({ key, at: i, title: titleOf(key, b.text), proposed: b.text })
      return
    }
    if (role === 'chapter') {
      newChapter(i, b.kind === 'heading' ? b.text : '')
      newScene(i, consumes ? i + 1 : i, false, '')
      return
    }
    if (role === 'scene') {
      if (!chapter) newChapter(acts.length ? acts[acts.length - 1].at : OPENING, OPENING_TITLE)
      newScene(i, consumes ? i + 1 : i, true, b.kind === 'heading' ? b.text : '')
      return
    }
    ensure(i)
  })
  closeScene(blocks.length)

  // Words, openings, empty scenes dropped (a chapter keeps one), and numbered titles where there are none.
  let total = 0
  let sceneCount = 0
  // Untitled chapters are numbered by place, unless the book's chapters have titles (that would make twins of them).
  const headed = chapters.some((c) => c.proposed && c.proposed !== OPENING_TITLE)
  chapters.forEach((c, ci) => {
    for (const s of c.scenes) {
      // Paragraphs always count; a heading only when it is ordinary text here.
      for (let i = s.from; i < s.to; i++) if (blocks[i].kind === 'para' || roleAt(blocks, proposed, edits, i) === 'text') s.words += words[i]
      s.opening = openingOf(blocks, s.from, s.to)
    }
    const kept = c.scenes.filter((s) => s.words > 0 || (s.own && s.proposed))
    c.scenes = kept.length ? kept : c.scenes.slice(0, 1)
    c.scenes.forEach((s, si) => {
      if (!s.proposed) {
        s.proposed = `Scene ${si + 1}`
        s.title = titleOf(s.key, s.proposed)
      }
    })
    if (!c.proposed) {
      c.proposed = headed ? 'New chapter' : `Chapter ${ci + 1}`
      c.title = titleOf(c.key, c.proposed)
    }
    c.words = c.scenes.reduce((n, s) => n + s.words, 0)
    total += c.words
    sceneCount += c.scenes.length
  })
  return { acts, chapters, scenes: sceneCount, words: total }
}

// ---------- Changes Adam makes ----------

export const setRole = (e: SplitEdits, at: number, role: Role): SplitEdits => ({ ...e, roles: { ...e.roles, [at]: role } })

export const setTitle = (e: SplitEdits, key: string, title: string): SplitEdits => ({ ...e, titles: { ...e.titles, [key]: title } })

/** Splits a scene so a new one starts at this paragraph. */
export const splitAt = (e: SplitEdits, at: number): SplitEdits => setRole(e, at, 'scene')

/**
 * "Merge with the one before": a chapter becomes a scene of the chapter before it; a scene's heading or break
 * mark becomes ordinary text in the scene before it (a split Adam made goes away).
 */
export function mergeBack(e: SplitEdits, blocks: ManuscriptBlock[], proposed: Record<number, Role>, at: number): SplitEdits {
  const role = roleAt(blocks, proposed, e, at)
  if (role === 'act') return setRole(e, at, 'chapter')
  if (role === 'chapter') return setRole(e, at, 'scene')
  if (role === 'scene') {
    if (blocks[at]?.kind === 'para' && proposed[at] == null) {
      const roles = { ...e.roles }
      delete roles[at]
      return { ...e, roles }
    }
    return setRole(e, at, 'text')
  }
  return e
}

// ---------- The plan ----------

/** A heading made ordinary text keeps its words as a paragraph; a break mark made ordinary text is a line across the page. */
function paragraphOf(b: ManuscriptBlock): ManuscriptRun[] | null {
  if (b.kind === 'para') return b.runs?.length ? b.runs : b.text ? [{ text: b.text }] : null
  if (b.kind === 'heading') return [{ text: b.text }]
  if (b.kind === 'break') return []
  return null
}

/** What importManuscript is given: the story's title and its acts, chapters and scenes with their paragraphs. */
export function toPlan(m: Pick<Manuscript, 'blocks'>, outline: Outline, title: string, newWorld = false): ImportPlan {
  const chapters: ImportPlanChapter[] = outline.chapters.map((c) => ({
    title: c.title.trim() || c.proposed,
    act: c.act,
    scenes: c.scenes.map((s) => {
      const paragraphs: ManuscriptRun[][] = []
      for (let i = s.from; i < s.to; i++) {
        const p = paragraphOf(m.blocks[i])
        if (!p) continue
        // No line across the page at a scene's very start or twice in a row.
        if (!p.length && (!paragraphs.length || !paragraphs[paragraphs.length - 1].length)) continue
        paragraphs.push(p)
      }
      while (paragraphs.length && !paragraphs[paragraphs.length - 1].length) paragraphs.pop()
      return { title: s.title.trim() || s.proposed, paragraphs }
    })
  }))
  // Acts that hold no chapters are left out, and the chapters' act numbers follow.
  const used = outline.acts.map((_, i) => chapters.some((c) => c.act === i))
  const renumber = outline.acts.map((_, i) => used.slice(0, i).filter(Boolean).length)
  return {
    title: title.trim() || 'Imported story',
    acts: outline.acts.filter((_, i) => used[i]).map((a) => ({ title: a.title.trim() || a.proposed })),
    chapters: chapters.map((c) => ({ ...c, act: c.act == null ? null : renumber[c.act] })),
    ...(newWorld ? { newWorld } : {})
  }
}

// ---------- Words for the page ----------

/** "152,310 words". */
export const wordsText = (n: number): string => `${n.toLocaleString('en-US')} ${n === 1 ? 'word' : 'words'}`

/** "24 chapters, 96 scenes" (with acts when there are any). */
export function countsText(acts: number, chapters: number, scenes: number): string {
  const n = (k: number, one: string, many: string): string => `${k.toLocaleString('en-US')} ${k === 1 ? one : many}`
  return `${acts ? `${n(acts, 'act', 'acts')}, ` : ''}${n(chapters, 'chapter', 'chapters')}, ${n(scenes, 'scene', 'scenes')}`
}

export const outlineCounts = (o: Pick<Outline, 'acts' | 'chapters' | 'scenes'>): string => countsText(o.acts.length, o.chapters.length, o.scenes)
