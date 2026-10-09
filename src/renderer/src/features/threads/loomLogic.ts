// The plot threads' loom on the desk (UI overhaul, "the AI planning pages"): where each thread runs across the story.
// The story's chapters lie along a ruler, each as wide as its scenes need; each thread is a strand across it, from the
// scene that sets it up (a knot) through the scenes that touch it (beads) to the scene that pays it off (a tied knot),
// or, while it is open, on to the ruler's end, fraying, its glow growing the longer it has been open. And the page's
// filters: by chapter and by words. Pure, so it is unit-tested (loomLogic.test.ts).
import type { BoardThread } from '@shared/contracts/worldViews'
import type { ID, Outline } from '@shared/types'

export interface LoomChapter {
  id: ID
  /** 1, 2, 3… */
  n: number
  title: string
  x: number
  w: number
  /** Each scene's x, in reading order. */
  scenes: { id: ID; x: number }[]
}

export interface LoomRuler {
  chapters: LoomChapter[]
  /** Where each scene sits along the ruler. */
  sceneX: Map<ID, number>
  /** Where each scene is: "Ch 2, Sc 1". */
  sceneAt: Map<ID, { chapter: number; scene: number }>
  left: number
  right: number
}

/** The story's chapters along the ruler, from `left` to `right`, each as wide as its share of the scenes (one at least). */
export function loomRuler(outline: Pick<Outline, 'chapters' | 'scenes'> | null, left: number, right: number): LoomRuler {
  const chapters: LoomChapter[] = []
  const sceneX = new Map<ID, number>()
  const sceneAt = new Map<ID, { chapter: number; scene: number }>()
  if (!outline || !outline.chapters.length || right <= left) return { chapters, sceneX, sceneAt, left, right }
  const sorted = [...outline.chapters].sort((a, b) => a.position - b.position)
  const scenesOf = (id: ID): ID[] =>
    outline.scenes
      .filter((s) => s.chapterId === id)
      .sort((a, b) => a.position - b.position)
      .map((s) => s.id)
  const counts = sorted.map((c) => Math.max(1, scenesOf(c.id).length))
  const total = counts.reduce((a, b) => a + b, 0)
  let x = left
  sorted.forEach((c, i) => {
    const w = ((right - left) * counts[i]) / total
    const ids = scenesOf(c.id)
    const scenes = ids.map((id, k) => ({ id, x: x + ((k + 0.5) * w) / Math.max(1, ids.length) }))
    scenes.forEach((s, k) => {
      sceneX.set(s.id, s.x)
      sceneAt.set(s.id, { chapter: i + 1, scene: k + 1 })
    })
    chapters.push({ id: c.id, n: i + 1, title: c.title.trim(), x, w, scenes })
    x += w
  })
  return { chapters, sceneX, sceneAt, left, right }
}

export interface Strand {
  id: ID
  /** Where it is set up; null when it isn't on the ruler (before the story, or in another story). */
  from: number | null
  /** The scenes between that touch it. */
  beads: number[]
  /** Where it is paid off; null while open. */
  to: number | null
  /** It runs on to the ruler's end, fraying. */
  open: boolean
  /** 0 to 1: how long it has been open, as the glow at its end. */
  tension: number
  /** Only planned so far (on scene cards, not yet in the text): drawn dashed. */
  planned: boolean
}

/** A thread's strand along the ruler. `touches`: the scenes whose cards set it up or pay it off (the story board's own). */
export function strandOf(t: BoardThread, ruler: LoomRuler, touches: ID[] = []): Strand {
  const at = (id: ID | null | undefined): number | null => (id ? (ruler.sceneX.get(id) ?? null) : null)
  const xs = [t.setUp?.sceneId, t.paidOff?.sceneId, ...touches].map(at).filter((x): x is number => x !== null)
  const open = t.column !== 'resolved'
  let from = at(t.setUp?.sceneId)
  let to = open ? null : at(t.paidOff?.sceneId)
  if (from === null && xs.length) from = Math.min(...xs)
  if (!open && to === null && xs.length) to = Math.max(...xs)
  const beads = [...new Set(xs)].filter((x) => x !== from && x !== to && (from === null || x > from) && (to === null || x < to)).sort((a, b) => a - b)
  return {
    id: t.id,
    from,
    beads,
    to,
    open,
    tension: open ? Math.min(1, (t.openChapters ?? 0) / 6 + (t.longOpen ? 0.35 : 0)) : 0,
    planned: t.column === 'planned' || (!!t.setUp?.planned && !t.paidOff)
  }
}

/** Where a thread is: "Ch 2, Sc 1", or null when the scene isn't in this story. */
export function sceneWords(ruler: LoomRuler, sceneId: ID | null | undefined): string | null {
  const at = sceneId ? ruler.sceneAt.get(sceneId) : undefined
  return at ? `Ch ${at.chapter}, Sc ${at.scene}` : null
}

/** The threads that touch a chapter (set up, paid off or touched in one of its scenes). */
export function touchesChapter(t: BoardThread, chapter: LoomChapter, touches: ID[] = []): boolean {
  const ids = new Set(chapter.scenes.map((s) => s.id))
  return [t.setUp?.sceneId, t.paidOff?.sceneId, ...touches].some((id) => !!id && ids.has(id))
}

/** The threads whose name or promise has these words (all of them, any order, any case). */
export function matchesWords(t: Pick<BoardThread, 'name' | 'promise'>, words: string): boolean {
  const want = words.toLowerCase().split(/\s+/).filter(Boolean)
  if (!want.length) return true
  const hay = `${t.name} ${t.promise}`.toLowerCase()
  return want.every((w) => hay.includes(w))
}

/** How long a thread has been open, as a meter of up to `max` marks: how many are lit. */
export const openMarks = (openChapters: number | null, max = 8): number => Math.max(0, Math.min(max, openChapters ?? 0))
