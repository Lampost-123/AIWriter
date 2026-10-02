// The rules behind the story screens (spec, Multi-story rules: "Story fields", "Suggested start in the
// New story dialog", "Changing a story's kind, start or end"). Pure functions over the same WorldShape
// the memory's line is built on (src/main/memory/line.ts), so what a preview says is exactly what the
// memory does once the story is saved.
//
// Readings chosen where the rules are silent (each is tested):
// - A series' first book is the first on the shelf that isn't a prequel, an own version of events, a
//   story built on one of those or on a side story, or a side story during a book of the same series.
//   From it the chain follows each book of the series that continues after the one before (the first on
//   the shelf where two do).
// - A series that runs alongside another (its first book is a side story during the other's book) is as
//   far along as the furthest book of the other series any of its stories starts in. Once the other
//   series has run out and one of its stories continues after the other's last book, it carries on from
//   there like any series.
// - "Should Book 2 now continue after it?" is asked only of books in the same series that continued
//   after the same story first, since a new series that starts where an old one ended is no reason for
//   the old one to move.
// - A side story's place in plain words: "after Ch 5" (it starts once Ch 5 has ended) and "until the end
//   of Ch 3"; a story starting at its start story's start starts "at the beginning of Book 2".

import type { ID, StartAt } from '@shared/types'
import type { StoryPlacement } from '@shared/api'
import type {
  StillRunning,
  StoryDetails,
  StoryDraft,
  StoryPreview,
  StoryRef,
  StorySuggestion,
  StoryWarning
} from '@shared/contracts/stories'
import type { Line, StoryNode, WorldShape } from '../memory/types'
import { buildLine, knowsSentence, placementProblem } from '../memory/line'
import { leadsIntoBook } from '../memory/scene'

// ---------- Steps (as the line counts them) ----------

/** A story's steps as the line walks them: its start (0), its start-of-story changes (1), each scene and chapter end, its end. */
export interface Steps {
  node: StoryNode
  sceneStep: Map<ID, number>
  chapterEndStep: Map<ID, number>
  last: number
}

export function stepsOf(node: StoryNode): Steps {
  const sceneStep = new Map<ID, number>()
  const chapterEndStep = new Map<ID, number>()
  let i = 2
  for (const c of node.chapters) {
    for (const s of c.scenes) sceneStep.set(s.id, i++)
    chapterEndStep.set(c.id, i++)
  }
  return { node, sceneStep, chapterEndStep, last: i }
}

/** The step a start point sits just after (line.ts reads it the same way). */
export function startStep(st: Steps, at: StartAt, refId: ID | null): number {
  if (at === 'pre') return 0
  if (at === 'post') return 1
  if (at === 'chapter') return (refId ? st.chapterEndStep.get(refId) : undefined) ?? 1
  if (at === 'scene') return (refId ? st.sceneStep.get(refId) : undefined) ?? 1
  return st.last
}

/** Where a side story is added to its host's walk: its end, or its start if the end lies before it. */
export function sideAddStep(host: Steps, side: StoryNode): number {
  const end = side.endAt === 'chapter' ? ((side.endRefId ? host.chapterEndStep.get(side.endRefId) : undefined) ?? 1) : host.last
  return Math.max(end, startStep(host, side.startAt, side.startRefId))
}

const byShelf = (a: StoryNode, b: StoryNode): number => a.position - b.position || a.createdOrder - b.createdOrder

const chapterNo = (s: StoryNode, id: ID | null): number => (id ? s.chapters.findIndex((c) => c.id === id) + 1 : 0)
const sceneAt = (s: StoryNode, id: ID | null): [number, number] => {
  for (let ci = 0; ci < s.chapters.length; ci++) {
    const si = s.chapters[ci].scenes.findIndex((x) => x.id === id)
    if (si >= 0) return [ci + 1, si + 1]
  }
  return [0, 0]
}

/** "Ch 5" or "Ch 2, Sc 1" for a chapter or scene of a story ('' when it isn't there). */
export function refWords(s: StoryNode, at: StartAt, refId: ID | null): string {
  if (at === 'chapter') {
    const n = chapterNo(s, refId)
    return n ? `Ch ${n}` : ''
  }
  if (at === 'scene') {
    const [c, n] = sceneAt(s, refId)
    return c ? `Ch ${c}, Sc ${n}` : ''
  }
  return ''
}

/** Where a story starting at this point in `s` starts, in plain words: "after Book 1, Ch 2", "at the beginning of Book 1". */
export function pointWords(s: StoryNode | undefined, at: StartAt, refId: ID | null): string {
  if (!s) return 'at the beginning of the world'
  if (at === 'pre' || at === 'post') return `at the beginning of ${s.title}`
  if (at === 'end') return `after ${s.title}`
  const ref = refWords(s, at, refId)
  return ref ? `after ${s.title}, ${ref}` : `at the beginning of ${s.title}`
}

// ---------- Placements ----------

const continuesAfter = (id: ID | null): StoryPlacement => ({
  kind: 'continues',
  startStoryId: id,
  startAt: 'end',
  startRefId: null,
  endAt: null,
  endRefId: null,
  leadsIntoId: null
})

/**
 * A placement as setStoryPlacement stores it (src/main/db/memory.ts): a prequel starts before its book's
 * start-of-story changes, and so on.
 */
export function normalizePlacement(p: StoryPlacement): StoryPlacement {
  const start = p.startStoryId ?? null
  const startAt: StartAt = !start ? 'end' : p.kind === 'prequel' ? 'pre' : p.startAt === 'pre' ? 'post' : p.startAt
  const endAt = p.kind === 'side' ? (p.endAt ?? 'end') : null
  return {
    kind: p.kind,
    startStoryId: start,
    startAt,
    startRefId: start && (startAt === 'chapter' || startAt === 'scene') ? (p.startRefId ?? null) : null,
    endAt,
    endRefId: endAt === 'chapter' ? (p.endRefId ?? null) : null,
    leadsIntoId: p.leadsIntoId ?? (p.kind === 'prequel' ? start : null)
  }
}

/** The id a new story has in a preview, before it exists. */
export const NEW_STORY: ID = 'new-story'

/**
 * The shape with the draft in it: a new story added on the shelf, or the story's placement, title and
 * series changed; and any side story it ends first ending after its chapter.
 */
export function withDraft(shape: WorldShape, draft: StoryDraft): { shape: WorldShape; node: StoryNode } {
  const p = normalizePlacement(draft.placement)
  const id = draft.storyId ?? NEW_STORY
  const old = shape.stories.find((s) => s.id === id)
  const ends = new Map((Array.isArray(draft.endFirst) ? draft.endFirst : []).map((e) => [e.storyId, e.endRefId]))
  const node: StoryNode = {
    id,
    chapters: old?.chapters ?? [],
    position: old?.position ?? Math.max(-1, ...shape.stories.map((s) => s.position)) + 1,
    createdOrder: old?.createdOrder ?? Math.max(-1, ...shape.stories.map((s) => s.createdOrder)) + 1,
    leadsIn: old?.leadsIn ?? false,
    title: draft.title.trim() || old?.title || 'Untitled story',
    seriesId: draft.seriesId,
    kind: p.kind,
    startStoryId: p.startStoryId,
    startAt: p.startAt,
    startRefId: p.startRefId,
    endAt: p.endAt,
    endRefId: p.endRefId,
    leadsIntoId: p.leadsIntoId
  }
  const ended = (s: StoryNode): StoryNode => {
    const endRefId = ends.get(s.id)
    return endRefId && s.kind === 'side' && s.id !== id ? { ...s, endAt: 'chapter', endRefId } : s
  }
  const stories = old ? shape.stories.map((s) => (s.id === id ? node : ended(s))) : [...shape.stories.map(ended), node]
  return { shape: { ...shape, stories }, node }
}

// ---------- Plain words ----------

/** What a story is in one line, and the grey line on its card (none for a story that simply continues). */
export function describe(shape: WorldShape, s: StoryNode): { summary: string; label: string | null } {
  const start = s.startStoryId ? shape.stories.find((x) => x.id === s.startStoryId) : undefined
  const both = (text: string): { summary: string; label: string } => ({ summary: text, label: text })
  switch (s.kind) {
    case 'continues':
      if (!start) return { summary: 'Starts at the beginning of the world', label: null }
      if (s.startAt === 'end') return { summary: `Continues after ${start.title}`, label: null }
      if (s.startAt === 'pre' || s.startAt === 'post') return both(`Starts at the beginning of ${start.title}`)
      return both(`Starts during ${start.title}, after ${refWords(start, s.startAt, s.startRefId) || 'its start'}`)
    case 'side': {
      if (!start) return both('Side story')
      const ref = refWords(start, s.startAt, s.startRefId)
      const from = s.startAt === 'end' ? 'after its end' : ref ? `after ${ref}` : ''
      const endNo = s.endAt === 'chapter' ? chapterNo(start, s.endRefId) : 0
      const until = endNo ? `until the end of Ch ${endNo}` : ''
      const where = [from, until].filter(Boolean).join(' ')
      return both(`Side story during ${start.title}${where ? `, ${where}` : ''}`)
    }
    case 'prequel': {
      const book = shape.stories.find((x) => x.id === (s.leadsIntoId ?? s.startStoryId))
      return both(book ? `Prequel to ${book.title}` : 'Prequel')
    }
    case 'own':
      if (!start) return both('Own version of events, from the beginning')
      if (s.startAt === 'pre' || s.startAt === 'post') return both(`Own version of events, from the beginning of ${start.title}`)
      return both(`Own version of events, ${pointWords(start, s.startAt, s.startRefId)}`)
  }
}

// ---------- The shelf ----------

/**
 * Shelf order is reading order (spec, Multi-story rules; for display only, it never changes what the AI
 * sees): stories that start at the beginning of the world by creation order, each followed by the
 * stories that start in it, in the order they start there (by creation order at the same point), except
 * that a prequel, with the stories that follow it, comes just before its book. So a book's side stories
 * come after it and before the book that continues after it, as the "knows" sentence lists them.
 */
export function readingOrder(shape: WorldShape): ID[] {
  const byId = new Map(shape.stories.map((s) => [s.id, s]))
  const starting = new Map<ID, StoryNode[]>()
  const roots: StoryNode[] = []
  for (const s of shape.stories) {
    const start = s.startStoryId && s.startStoryId !== s.id ? byId.get(s.startStoryId) : undefined
    if (start) starting.set(start.id, [...(starting.get(start.id) ?? []), s])
    else roots.push(s)
  }
  const byCreation = (a: StoryNode, b: StoryNode): number => a.createdOrder - b.createdOrder
  const out: ID[] = []
  const seen = new Set<ID>()
  const visit = (s: StoryNode): void => {
    if (seen.has(s.id)) return
    seen.add(s.id)
    const steps = stepsOf(s)
    const at = (x: StoryNode): number => (x.kind === 'prequel' ? -1 : startStep(steps, x.startAt, x.startRefId))
    const here = [...(starting.get(s.id) ?? [])].sort((a, b) => at(a) - at(b) || byCreation(a, b))
    for (const x of here) if (x.kind === 'prequel') visit(x)
    out.push(s.id)
    for (const x of here) if (x.kind !== 'prequel') visit(x)
  }
  for (const s of [...roots].sort(byCreation)) visit(s)
  // Stories in a loop (which the rules refuse) still get a place, at the end.
  for (const s of [...shape.stories].sort(byCreation)) visit(s)
  return out
}

// ---------- Warnings and the still-running note ----------

/** Choices that would quietly lose history, each with the likely alternatives. */
export function warningsFor(shape: WorldShape, s: StoryNode): StoryWarning[] {
  const byId = new Map(shape.stories.map((x) => [x.id, x]))
  const start = s.startStoryId ? byId.get(s.startStoryId) : undefined
  const out: StoryWarning[] = []
  if (s.kind === 'continues' && s.startAt === 'end' && start?.kind === 'side') {
    const host = start.startStoryId ? byId.get(start.startStoryId) : undefined
    if (host) {
      const options: StoryWarning['options'] = [{ label: `Continue after ${host.title} instead`, placement: continuesAfter(host.id) }]
      const endNo = start.endAt === 'chapter' ? chapterNo(host, start.endRefId) : 0
      if (endNo) {
        options.push({
          label: `Make it a side story during ${host.title}, after Ch ${endNo}`,
          placement: {
            kind: 'side',
            startStoryId: host.id,
            startAt: 'chapter',
            startRefId: start.endRefId,
            endAt: 'end',
            endRefId: null,
            leadsIntoId: null
          }
        })
      }
      out.push({
        kind: 'after-side',
        message: `${start.title} is a side story during ${host.title}, so this story would miss everything in ${host.title} after ${start.title} starts.`,
        options
      })
    }
  }
  if (s.kind === 'prequel' && start) {
    const before = start.kind === 'continues' && start.startAt === 'end' && start.startStoryId ? byId.get(start.startStoryId) : undefined
    if (before && before.seriesId === start.seriesId) {
      out.push({
        kind: 'prequel-not-first',
        message: `${start.title} isn't the first book of its series. Did you mean a story that continues after ${before.title}?`,
        options: [{ label: `Continue after ${before.title}`, placement: continuesAfter(before.id) }]
      })
    }
  }
  return out
}

/**
 * Other side stories of a side story's book still running where it starts, as the "knows" sentence
 * names them, each with the chapter it could end after so that it ends first ("End Ash after Ch 1").
 */
export function stillRunningAt(shape: WorldShape, s: StoryNode, line: Line): StillRunning[] {
  const host = s.kind === 'side' && s.startStoryId ? shape.stories.find((x) => x.id === s.startStoryId) : undefined
  if (!host) return []
  const hs = stepsOf(host)
  const at = startStep(hs, s.startAt, s.startRefId)
  const walked = new Set(line.segments.map((x) => x.storyId))
  return shape.stories
    .filter((x) => x.kind === 'side' && x.startStoryId === host.id && x.id !== s.id && !walked.has(x.id))
    .filter((x) => startStep(hs, x.startAt, x.startRefId) <= at && at < sideAddStep(hs, x))
    .sort((a, b) => startStep(hs, a.startAt, a.startRefId) - startStep(hs, b.startAt, b.startRefId) || a.createdOrder - b.createdOrder)
    .map((x) => {
      const from = startStep(hs, x.startAt, x.startRefId)
      // The last chapter of the host that ends by the time this story starts, and not before the other one starts.
      const chapter = [...host.chapters].reverse().find((c) => {
        const step = hs.chapterEndStep.get(c.id)!
        return step <= at && step >= from
      })
      const ch = chapter ? `Ch ${chapterNo(host, chapter.id)}` : ''
      return {
        storyId: x.id,
        title: x.title,
        endFirst: chapter ? { endRefId: chapter.id, label: `End ${x.title} after ${ch}`, chapter: ch } : null
      }
    })
}

// ---------- The preview ----------

/** What a story would know with the draft's placement, its warnings and its card line, saving nothing. */
export function previewStory(shape: WorldShape, draft: StoryDraft): StoryPreview {
  if (draft.storyId && !shape.stories.some((s) => s.id === draft.storyId)) {
    return { knows: '', problem: 'That story no longer exists.', warnings: [], stillRunning: [], summary: '', label: null }
  }
  const { shape: next, node } = withDraft(shape, draft)
  const { summary, label } = describe(next, node)
  const problem = placementProblem(next, node.id, normalizePlacement(draft.placement))
  if (problem) return { knows: '', problem, warnings: [], stillRunning: [], summary, label }
  const line = buildLine(next, { storyId: node.id, through: 'start' })
  return {
    knows: knowsSentence(next, line),
    problem: null,
    warnings: warningsFor(next, node),
    stillRunning: stillRunningAt(next, node, line),
    summary,
    label
  }
}

/** The placement a story has now, as a draft placement. */
export const placementOf = (s: StoryNode): StoryPlacement => ({
  kind: s.kind,
  startStoryId: s.startStoryId,
  startAt: s.startAt,
  startRefId: s.startRefId,
  endAt: s.endAt,
  endRefId: s.endRefId,
  leadsIntoId: s.leadsIntoId
})

// ---------- Suggested start ----------

/** Prequels, own versions of events, and the stories that follow on from one: never in a series' chain. */
function apartFromBooks(shape: WorldShape): (s: StoryNode) => boolean {
  const byId = new Map(shape.stories.map((s) => [s.id, s]))
  return (s) => {
    const seen = new Set<ID>()
    for (let cur: StoryNode | undefined = s; cur && !seen.has(cur.id); cur = cur.startStoryId ? byId.get(cur.startStoryId) : undefined) {
      seen.add(cur.id)
      if (cur.kind === 'prequel' || cur.kind === 'own') return true
    }
    return false
  }
}

/** Whether a story starts in a side story, or in a story that does. */
function builtOnSide(byId: Map<ID, StoryNode>, s: StoryNode): boolean {
  const seen = new Set<ID>([s.id])
  for (
    let cur = s.startStoryId ? byId.get(s.startStoryId) : undefined;
    cur && !seen.has(cur.id);
    cur = cur.startStoryId ? byId.get(cur.startStoryId) : undefined
  ) {
    seen.add(cur.id)
    if (cur.kind === 'side') return true
  }
  return false
}

/** A series' books that can be in its chain, in shelf order. */
function seriesBooks(shape: WorldShape, seriesId: ID | null): StoryNode[] {
  const apart = apartFromBooks(shape)
  return shape.stories.filter((s) => s.seriesId === seriesId && !apart(s)).sort(byShelf)
}

/** The books of a series that continue one after another from `from`, following the first on the shelf where two do. */
function followOn(books: StoryNode[], from: StoryNode): StoryNode[] {
  const chain = [from]
  const seen = new Set<ID>([from.id])
  for (;;) {
    const cur = chain[chain.length - 1]
    const next = books.find((s) => s.kind === 'continues' && s.startAt === 'end' && s.startStoryId === cur.id && !seen.has(s.id))
    if (!next) return chain
    seen.add(next.id)
    chain.push(next)
  }
}

/** A series' chain: its first book, then each book that continues after the one before. */
export function seriesChain(shape: WorldShape, seriesId: ID | null): StoryNode[] {
  const byId = new Map(shape.stories.map((s) => [s.id, s]))
  const books = seriesBooks(shape, seriesId)
  const first = books.find((s) => {
    if (builtOnSide(byId, s)) return false
    const host = s.kind === 'side' && s.startStoryId ? byId.get(s.startStoryId) : undefined
    return !(host && host.seriesId === seriesId)
  })
  return first ? followOn(books, first) : []
}

/** The suggestion for a series that has books; null for an empty one. */
function suggestFor(shape: WorldShape, seriesId: ID | null): StoryPlacement | null {
  const byId = new Map(shape.stories.map((s) => [s.id, s]))
  const chain = seriesChain(shape, seriesId)
  if (!chain.length) return null
  const first = chain[0]
  const host = first.kind === 'side' && first.startStoryId ? byId.get(first.startStoryId) : undefined
  if (host && host.seriesId !== seriesId) {
    // The series runs alongside the host's series.
    const other = seriesChain(shape, host.seriesId)
    const at = new Map(other.map((s, i) => [s.id, i]))
    const books = seriesBooks(shape, seriesId)
    const last = other[other.length - 1]
    const after = last ? books.find((s) => s.kind === 'continues' && s.startAt === 'end' && s.startStoryId === last.id) : undefined
    if (after) {
      const own = followOn(books, after)
      return continuesAfter(own[own.length - 1].id)
    }
    let furthest = -1
    for (const s of books) {
      const seen = new Set<ID>()
      for (let cur: StoryNode | undefined = s; cur && !seen.has(cur.id); cur = cur.startStoryId ? byId.get(cur.startStoryId) : undefined) {
        seen.add(cur.id)
        const i = at.get(cur.id)
        if (i !== undefined) {
          furthest = Math.max(furthest, i)
          break
        }
      }
    }
    if (furthest >= 0) {
      const next = other[furthest + 1]
      if (next)
        return { kind: 'side', startStoryId: next.id, startAt: 'post', startRefId: null, endAt: 'end', endRefId: null, leadsIntoId: null }
      return continuesAfter(last.id)
    }
  }
  return continuesAfter(chain[chain.length - 1].id)
}

/**
 * The suggested start for a new story in a series: "Continues after" the series' last book, or for a
 * series that runs alongside another, a side story during that series' next book. A new or empty
 * series gets the suggestion for the series of the story Adam is working in.
 */
export function suggestStart(shape: WorldShape, seriesId: ID | null, fromStoryId: ID | null): StoryPlacement {
  const own = seriesId ? suggestFor(shape, seriesId) : null
  if (own) return own
  const from = fromStoryId ? shape.stories.find((s) => s.id === fromStoryId) : undefined
  const fromSuggestion = from ? suggestFor(shape, from.seriesId) : null
  if (fromSuggestion) return fromSuggestion
  // Nothing to go by: the series of the first story on the shelf, or the beginning of the world.
  const first = [...shape.stories].sort(byShelf)[0]
  return (first ? suggestFor(shape, first.seriesId) : null) ?? (first ? continuesAfter(first.id) : continuesAfter(null))
}

/**
 * A title for a new story in a series: the next number after the series' last numbered book ("Book 3"
 * after "Book 2"), never one another story already has. A new series' first story takes its name.
 * Adam renames it as he likes; this only saves him typing for a plain series.
 */
export function suggestTitle(shape: WorldShape, seriesId: ID | null, newSeries?: string): string {
  const taken = new Set(shape.stories.map((s) => s.title.trim().toLocaleLowerCase()))
  const free = (prefix: string, n: number): string => {
    while (taken.has(`${prefix} ${n}`.toLocaleLowerCase())) n++
    return `${prefix} ${n}`
  }
  if (!seriesId) {
    const name = newSeries?.trim()
    return name && !taken.has(name.toLocaleLowerCase()) ? name : free(name || 'Book', 1)
  }
  const chain = seriesChain(shape, seriesId)
  for (let i = chain.length - 1; i >= 0; i--) {
    const m = /^(.*\S)\s+(\d+)$/.exec(chain[i].title.trim())
    if (m) return free(m[1], Number(m[2]) + 1)
  }
  // No numbers to go on: "The Long Dark 2" after The Long Dark.
  return free(chain[0]?.title.trim() || 'Book', chain.length + 1)
}

export function suggestion(shape: WorldShape, input: { seriesId: ID | null; newSeries?: string; fromStoryId: ID | null }): StorySuggestion {
  const seriesId = input.newSeries?.trim() ? null : input.seriesId
  const placement = suggestStart(shape, seriesId, input.fromStoryId)
  const title = suggestTitle(shape, seriesId, input.newSeries)
  return { placement, title, preview: previewStory(shape, { storyId: null, title, seriesId, placement }) }
}

// ---------- What story settings shows ----------

const ref = (s: StoryNode): StoryRef => ({ storyId: s.id, title: s.title })

/** "Should Book 2 now continue after it?": earlier books of its series that continue after the same story. */
export function mightFollow(shape: WorldShape, storyId: ID): StoryRef[] {
  const me = shape.stories.find((s) => s.id === storyId)
  if (!me || me.kind !== 'continues' || me.startAt !== 'end' || !me.startStoryId) return []
  return shape.stories
    .filter(
      (s) =>
        s.id !== me.id &&
        s.kind === 'continues' &&
        s.startAt === 'end' &&
        s.startStoryId === me.startStoryId &&
        s.seriesId === me.seriesId &&
        s.createdOrder < me.createdOrder
    )
    .sort(byShelf)
    .map(ref)
}

/**
 * Books written before a story that now continue after it, as after Adam's yes to "Should Book 2 now
 * continue after it?": the changes at their start may have happened before, during or after it, which
 * "When did these happen?" sorts out. A book written after it simply continues, so it isn't one.
 */
export function followers(shape: WorldShape, storyId: ID): StoryRef[] {
  const me = shape.stories.find((s) => s.id === storyId)
  if (!me) return []
  return shape.stories
    .filter(
      (s) => s.id !== me.id && s.kind === 'continues' && s.startAt === 'end' && s.startStoryId === me.id && s.createdOrder < me.createdOrder
    )
    .sort(byShelf)
    .map(ref)
}

/** Stories that start in this one, and where each would start if it were deleted (they take over its start point). */
export function startingHere(shape: WorldShape, storyId: ID): StoryDetails['startingHere'] {
  const byId = new Map(shape.stories.map((s) => [s.id, s]))
  const me = byId.get(storyId)
  if (!me) return []
  const wouldStart = pointWords(me.startStoryId ? byId.get(me.startStoryId) : undefined, me.startAt, me.startRefId)
  return shape.stories
    .filter((s) => s.startStoryId === storyId && s.id !== storyId)
    .sort(byShelf)
    .map((s) => ({ ...ref(s), wouldStart }))
}

/** The first story up a prequel chain that names the book it leads into (a prequel, or a story Adam pointed at a book). */
function chainHead(byId: Map<ID, StoryNode>, s: StoryNode): StoryNode | null {
  const seen = new Set<ID>()
  for (let cur: StoryNode | undefined = s; cur && !seen.has(cur.id); ) {
    seen.add(cur.id)
    if (cur.leadsIntoId) return cur
    cur = cur.kind === 'continues' && cur.startAt === 'end' && cur.startStoryId ? byId.get(cur.startStoryId) : undefined
  }
  return null
}

/** The stories of a story's prequel chain (those leading into the same book), or [] when it isn't in one. */
export function leadsGroup(shape: WorldShape, storyId: ID): StoryNode[] {
  const byId = new Map(shape.stories.map((s) => [s.id, s]))
  const me = byId.get(storyId)
  const head = me ? chainHead(byId, me) : null
  if (!head || !head.leadsIntoId || !byId.has(head.leadsIntoId)) return []
  return shape.stories.filter((s) => chainHead(byId, s)?.id === head.id)
}

/** For a story in a prequel chain: the book it leads into, and the story that leads in (the one Adam marked, else the last). */
export function leadsInto(shape: WorldShape, storyId: ID): StoryDetails['leadsInto'] {
  const group = leadsGroup(shape, storyId)
  const leader = group.find((s) => leadsIntoBook(shape, s.id) !== null)
  const bookId = leader ? leadsIntoBook(shape, leader.id) : null
  const book = bookId ? shape.stories.find((s) => s.id === bookId) : undefined
  return leader && book ? { book: ref(book), leader: ref(leader), marked: leader.leadsIn } : null
}
