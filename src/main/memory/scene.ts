// Reads the open world's database and works out what counts for one scene: the SceneMemory the
// briefing (src/main/ai/context.ts) and the memory keeper (src/main/keeper) are given.
// No Electron imports, so it can be tested against an in-memory database. The SQL is in
// src/main/db/memory.ts; this file only puts the pieces together.
//
// Readings chosen where the rules are silent (each is tested):
// - Story-so-far for a whole earlier story uses its story summary; if it has none yet, the same
//   paragraph is built from its chapter summaries (or a chapter's scene summaries when the chapter
//   has none), so a missing roll-up never drops a whole book from the briefing.
// - A series roll-up covers the series' stories except prequels, own versions and stories that
//   follow on from either (a prequel trilogy's later books, say), since none of those can ever be on
//   the same walk as the books.
// - "Leads into": a prequel names the book; stories that continue after its end (and name no book
//   of their own) lead into the same book. The one Adam marked leads in; otherwise the last in that
//   chain, taking the first on the shelf where it branches.
// - An entry that doesn't exist here is "not in the story yet at this point" when one of its
//   first-exists points is in a story this scene's walk goes into (it comes later there), and
//   otherwise "from <the story of its first point>, not in this story so far".

import type Database from 'better-sqlite3'
import type { Change, ChangeView, EntryState, ID } from '@shared/types'
import type { Line, MemoryData, SceneMemory, StoryNode, StorySoFar, SummaryIndex, WorldShape } from './types'
import { summaryKey } from './types'
import { buildLine, compareOrder, knowsSentence, labeler, previousSceneStep, storyOrder, storyOfScene } from './line'
import { indexChanges, stateAt, type ChangeIndex, type MemoryStateAll } from './state'
import * as mem from '../db/memory'
import { linksForFacts } from '../db/history'
import * as repo from '../db/repo'
import { UserError } from '../util'

type DB = Database.Database

/** Every live story with its live chapters and scenes (no text), and Adam's answers. */
export function loadShape(db: DB): WorldShape {
  return mem.loadShape(db)
}

/** Every live entry, change and first-exists point. */
export function loadMemoryData(db: DB): MemoryData {
  const entries = repo.listEntries(db)
  const live = new Set(entries.map((e) => e.id))
  return {
    entries,
    changes: mem.listAllChanges(db).filter((c) => live.has(c.entryId)),
    exists: mem.listExistsPoints(db).filter((p) => live.has(p.entryId)),
    answers: mem.listAnswers(db)
  }
}

/** What counts for drafting (or reading) this scene. */
export function sceneMemory(db: DB, sceneId: ID): SceneMemory {
  const shape = loadShape(db)
  const story = storyOfScene(shape, sceneId)
  if (!story) throw new UserError('That scene no longer exists.')
  const data = loadMemoryData(db)
  const changes = indexChanges(data.changes)
  const line = buildLine(shape, { storyId: story.id, before: sceneId })
  const state = stateAt(data, shape, line, changes)

  const prevStep = previousSceneStep(line)
  const prevText = prevStep ? mem.sceneText(db, prevStep.sceneId) : null
  const summaries: SummaryIndex = new Map(mem.listSummaries(db).map((s) => [summaryKey(s.level, s.targetId), s]))

  return {
    storyId: story.id,
    sceneId,
    knows: knowsSentence(shape, line),
    previous: prevStep && prevText ? { sceneId: prevStep.sceneId, title: prevText.title, text: prevText.text } : null,
    entries: [...state.entries.values()],
    firstHere: [...state.firstHere],
    elsewhere: elsewhere(shape, line, data, state),
    relationships: state.relationships,
    facts: state.facts,
    threads: state.threads,
    storySoFar: storySoFar(shape, line, summaries, mem.seriesNames(db), leadsInto(shape, line, data, changes, state, summaries)),
    bringAbout: changes.byScene.get(sceneId) ?? []
  }
}

/** Entries that don't exist here, each with the label to send if Adam pins or lists it. */
function elsewhere(shape: WorldShape, line: Line, data: MemoryData, state: MemoryStateAll): SceneMemory['elsewhere'] {
  const onWalk = new Set(line.segments.map((s) => s.storyId))
  const titles = new Map(shape.stories.map((s) => [s.id, s.title]))
  const sceneStory = new Map<ID, ID>()
  for (const s of shape.stories) for (const c of s.chapters) for (const sc of c.scenes) sceneStory.set(sc.id, s.id)
  const pointsOf = new Map<ID, MemoryData['exists']>()
  for (const p of data.exists) {
    const list = pointsOf.get(p.entryId)
    if (list) list.push(p)
    else pointsOf.set(p.entryId, [p])
  }

  const out: SceneMemory['elsewhere'] = []
  for (const [id, entry] of state.absent) {
    const stories = (pointsOf.get(id) ?? []).map((p) =>
      p.kind === 'scene' && p.sceneId ? (sceneStory.get(p.sceneId) ?? p.storyId) : p.storyId
    )
    const from = stories.find((s): s is ID => !!s && titles.has(s))
    const label = stories.some((s) => s && onWalk.has(s))
      ? 'not in the story yet at this point'
      : from
        ? `from ${titles.get(from)}, not in this story so far`
        : 'not in this story so far'
    out.push({ entry, label })
  }
  return out
}

/** Stories that are prequels or own versions of events, or follow on from one: never on the same walk as the books. */
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

function storySoFar(
  shape: WorldShape,
  line: Line,
  summaries: SummaryIndex,
  seriesNames: Map<ID, string>,
  leads: StorySoFar['leadsInto']
): StorySoFar {
  const label = labeler(shape)
  const text = (level: 'scene' | 'chapter' | 'story' | 'series', id: ID): string => summaries.get(summaryKey(level, id))?.text.trim() ?? ''
  const targetId = line.target.storyId
  const walked = new Map<ID, { scenes: Set<ID>; chapterEnds: Set<ID> }>()
  for (const step of line.steps) {
    let w = walked.get(step.storyId)
    if (!w) walked.set(step.storyId, (w = { scenes: new Set(), chapterEnds: new Set() }))
    if (step.type === 'scene') w.scenes.add(step.sceneId)
    else if (step.type === 'chapter-end') w.chapterEnds.add(step.chapterId)
  }

  const out: StorySoFar = { scenes: [], chapters: [], stories: [], series: [], leadsInto: leads }
  for (const step of line.steps) {
    if (step.storyId !== targetId || step.via !== 'line') continue
    if (step.type === 'scene') {
      const t = text('scene', step.sceneId)
      if (t)
        out.scenes.push({
          sceneId: step.sceneId,
          chapterId: step.chapterId,
          label: label({ storyId: targetId, sceneId: step.sceneId }),
          text: t
        })
    } else if (step.type === 'chapter-end') {
      const t = text('chapter', step.chapterId)
      if (t) out.chapters.push({ chapterId: step.chapterId, label: label({ storyId: targetId, chapterId: step.chapterId }), text: t })
    }
  }

  const byId = new Map(shape.stories.map((s) => [s.id, s]))
  for (const seg of line.segments) {
    const story = byId.get(seg.storyId)
    if (!story || seg.storyId === targetId || (!seg.whole && seg.stop?.at === 'pre')) continue
    let t = seg.whole ? text('story', story.id) : ''
    if (!t) {
      // Chapter summaries up to the cut (a chapter's scene summaries when it has none), then the
      // scene summaries of the chapter the cut falls inside. Never the whole-story summary for a cut.
      const w = walked.get(story.id)
      const parts: string[] = []
      for (const c of story.chapters) {
        const scenes = c.scenes.filter((s) => w?.scenes.has(s.id)).map((s) => text('scene', s.id))
        parts.push(w?.chapterEnds.has(c.id) ? text('chapter', c.id) || scenes.filter(Boolean).join(' ') : scenes.filter(Boolean).join(' '))
      }
      t = parts.filter(Boolean).join(' ')
    }
    if (t) out.stories.push({ storyId: story.id, title: story.title, meanwhile: seg.via === 'side', cut: !seg.whole, text: t })
  }

  const whole = new Set(line.segments.filter((s) => s.whole).map((s) => s.storyId))
  const apart = apartFromBooks(shape)
  for (const [seriesId, name] of seriesNames) {
    const t = text('series', seriesId)
    const covered = shape.stories.filter((s) => s.seriesId === seriesId && !apart(s))
    if (t && covered.length && covered.every((s) => whole.has(s.id)))
      out.series.push({ seriesId, name, storyIds: covered.map((s) => s.id), text: t })
  }
  return out
}

/** The book this story leads into, when it is the story that leads into it; else null. */
export function leadsIntoBook(shape: WorldShape, storyId: ID): ID | null {
  const byId = new Map(shape.stories.map((s) => [s.id, s]))
  const headOf = (s: StoryNode): { head: StoryNode; book: ID } | null => {
    const seen = new Set<ID>()
    for (let cur: StoryNode | undefined = s; cur && !seen.has(cur.id); ) {
      seen.add(cur.id)
      if (cur.leadsIntoId) return { head: cur, book: cur.leadsIntoId }
      cur = cur.kind === 'continues' && cur.startAt === 'end' && cur.startStoryId ? byId.get(cur.startStoryId) : undefined
    }
    return null
  }
  const story = byId.get(storyId)
  const mine = story ? headOf(story) : null
  if (!mine || !byId.has(mine.book)) return null
  const group = shape.stories.filter((s) => {
    const h = headOf(s)
    return h?.head.id === mine.head.id && h.book === mine.book
  })
  const byShelf = (a: StoryNode, b: StoryNode): number => a.position - b.position || a.createdOrder - b.createdOrder
  let leader = group.filter((s) => s.leadsIn).sort((a, b) => a.createdOrder - b.createdOrder)[0]
  if (!leader) {
    leader = mine.head
    const seen = new Set<ID>([leader.id])
    for (;;) {
      const next = group
        .filter((s) => s.startStoryId === leader.id && s.kind === 'continues' && s.startAt === 'end' && !s.leadsIntoId && !seen.has(s.id))
        .sort(byShelf)[0]
      if (!next) break
      seen.add(next.id)
      leader = next
    }
  }
  return leader.id === storyId ? mine.book : null
}

const firstSentence = (s: string): string => {
  const one = s.trim().split(/(?<=[.!?])\s+/)[0] ?? ''
  return one.length > 200 ? `${one.slice(0, 199).trimEnd()}…` : one
}

/** For the story that leads into a book: the book's opening summary and how the cast is when it begins. */
function leadsInto(
  shape: WorldShape,
  line: Line,
  data: MemoryData,
  changes: ChangeIndex,
  here: MemoryStateAll,
  summaries: SummaryIndex
): StorySoFar['leadsInto'] {
  const bookId = leadsIntoBook(shape, line.target.storyId)
  const book = bookId ? shape.stories.find((s) => s.id === bookId) : undefined
  if (!book) return null
  const text = (level: 'scene' | 'chapter', id: ID): string => summaries.get(summaryKey(level, id))?.text.trim() ?? ''
  const first = book.chapters[0]
  const opening = first
    ? text('chapter', first.id) ||
      first.scenes
        .map((s) => text('scene', s.id))
        .filter(Boolean)
        .join(' ')
    : ''
  const atStart = stateAt(data, shape, buildLine(shape, { storyId: book.id, through: 'start' }), changes)
  const cast = [...here.entries.values()]
    .filter((e) => e.kind === 'character' && atStart.entries.has(e.id))
    .map((e) => {
      const then: EntryState = atStart.entries.get(e.id)!
      const what = then.summary.trim() || firstSentence(then.description)
      return what ? `${then.name}: ${what}` : ''
    })
    .filter(Boolean)
  const parts = [opening, cast.length ? `How the cast is when ${book.title} begins:\n${cast.join('\n')}` : ''].filter(Boolean)
  return parts.length ? { storyId: book.id, title: book.title, text: parts.join('\n\n') } : null
}

/**
 * Changes as entry pages list them: in story order (before any story first, then each story in
 * the order it starts, its start-of-story changes then its scenes; at one place by position), each
 * with where it happened in plain words and the words it came from. Changes pinned to a scene or
 * story that was deleted don't count anywhere, so they are left out.
 */
export function changeViews(db: DB, changes: Change[], shape: WorldShape = loadShape(db)): ChangeView[] {
  const label = labeler(shape)
  const order = storyOrder(shape)
  // A scene's story as it is now (a change keeps the story its scene was in when it was made).
  const storyOf = new Map<ID, ID>()
  for (const s of shape.stories) for (const c of s.chapters) for (const sc of c.scenes) storyOf.set(sc.id, s.id)
  const keyed = changes
    .map((c) => ({
      c,
      key:
        c.anchor === 'baseline'
          ? [-1]
          : c.anchor === 'scene' && c.sceneId
            ? order({ storyId: storyOf.get(c.sceneId) ?? c.storyId, sceneId: c.sceneId })
            : order({ storyId: c.storyId, sceneId: null })
    }))
    .filter(({ key }) => key[0] !== Infinity)
  keyed.sort(
    (a, b) =>
      compareOrder(a.key, b.key) ||
      a.c.position - b.c.position ||
      (a.c.createdAt < b.c.createdAt ? -1 : a.c.createdAt > b.c.createdAt ? 1 : 0)
  )
  const links = linksForFacts(
    db,
    'change',
    keyed.map(({ c }) => c.id)
  )
  return keyed.map(({ c }) => ({
    ...c,
    where: c.anchor === 'baseline' ? 'Before any story' : label({ storyId: c.storyId, sceneId: c.anchor === 'scene' ? c.sceneId : null }),
    links: links.get(c.id) ?? []
  }))
}
