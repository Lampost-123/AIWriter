// Moving or deleting a chapter or scene that other stories start or end after (spec, Multi-story rules:
// "Changing a story's kind, start or end"). Nothing is stored differently: a story's start or end keeps
// pointing at its chapter or scene wherever it goes, and loadShape moves a point at a deleted one to
// the one before it. These say, in plain words, what that does to the other stories, so the binder can
// tell Adam: "This moved “The ferry” before where Mara's Hand starts, so that story now includes it."
import type { ID } from '@shared/types'
import type { OutlineMove } from '@shared/contracts/stories'
import type { ChapterNode, StoryNode, WorldShape } from '../memory/types'
import { pointWords, sideAddStep, startStep, stepsOf } from './rules'

const quoted = (title: string, fallback: string): string => `“${title.trim() || fallback}”`
const scenes = (n: number): string => (n === 1 ? '1 scene' : `${n} scenes`)
const more = (n: number): string => (n === 1 ? '1 more scene' : `${n} more scenes`)

/** The story a scene or chapter is in, with the chapter and its place. */
function locate(shape: WorldShape, kind: 'scene' | 'chapter', id: ID): { story: StoryNode; chapter: ChapterNode; index: number } | null {
  for (const story of shape.stories) {
    for (const [ci, chapter] of story.chapters.entries()) {
      if (kind === 'chapter' && chapter.id === id) return { story, chapter, index: ci }
      const si = chapter.scenes.findIndex((s) => s.id === id)
      if (kind === 'scene' && si >= 0) return { story, chapter, index: si }
    }
  }
  return null
}

const cloneStory = (s: StoryNode): StoryNode => ({ ...s, chapters: s.chapters.map((c) => ({ ...c, scenes: [...c.scenes] })) })

/** The scenes of a story at or before a step of its walk. */
function scenesUpTo(s: StoryNode, step: number): Set<ID> {
  const st = stepsOf(s)
  return new Set([...st.sceneStep].filter(([, i]) => i <= step).map(([id]) => id))
}

const minus = (a: Set<ID>, b: Set<ID>): Set<ID> => new Set([...a].filter((x) => !b.has(x)))

/**
 * What moving a scene or chapter (as moveScene and moveChapter would) changes for the stories that
 * start after a chapter or scene of its story, and for its side stories that end after a chapter.
 * Also where it is now, so the move can be undone.
 */
export function previewMove(shape: WorldShape, move: OutlineMove): { notes: string[]; from: { chapterId: ID | null; index: number } } {
  const at = locate(shape, move.kind, move.id)
  if (!at) return { notes: [], from: { chapterId: null, index: 0 } }
  const from = { chapterId: move.kind === 'scene' ? at.chapter.id : null, index: at.index }
  const before = at.story
  const after = cloneStory(before)
  let moved: Set<ID>
  let what: string
  if (move.kind === 'scene') {
    const scene = at.chapter.scenes[at.index]
    const to = after.chapters.find((c) => c.id === move.chapterId)
    if (!to) return { notes: [], from }
    after.chapters.find((c) => c.id === at.chapter.id)!.scenes.splice(at.index, 1)
    to.scenes.splice(Math.max(0, Math.min(move.index, to.scenes.length)), 0, scene)
    moved = new Set([scene.id])
    what = quoted(scene.title, 'Untitled scene')
  } else {
    const [chapter] = after.chapters.splice(at.index, 1)
    after.chapters.splice(Math.max(0, Math.min(move.index, after.chapters.length)), 0, chapter)
    moved = new Set(chapter.scenes.map((s) => s.id))
    what = quoted(at.chapter.title, 'Untitled chapter')
  }
  /** Every scene that changed side is one Adam moved, so the note can name it. */
  const isMoved = (set: Set<ID>): boolean => set.size > 0 && set.size === moved.size && [...set].every((id) => moved.has(id))

  const notes: string[] = []
  const stepsBefore = stepsOf(before)
  const stepsAfter = stepsOf(after)
  for (const t of shape.stories) {
    if (t.id === before.id || t.startStoryId !== before.id) continue
    if (t.startAt === 'chapter' || t.startAt === 'scene') {
      const was = scenesUpTo(before, startStep(stepsBefore, t.startAt, t.startRefId))
      const now = scenesUpTo(after, startStep(stepsAfter, t.startAt, t.startRefId))
      const gained = minus(now, was)
      const lost = minus(was, now)
      if (isMoved(gained) && !lost.size) notes.push(`This moved ${what} before where ${t.title} starts, so that story now includes it.`)
      else if (isMoved(lost) && !gained.size) notes.push(`This moved ${what} after where ${t.title} starts, so that story no longer includes it.`)
      else {
        if (gained.size) notes.push(`${t.title} now includes ${more(gained.size)} of ${before.title}.`)
        if (lost.size) notes.push(`${t.title} no longer includes ${scenes(lost.size)} of ${before.title}.`)
      }
    }
    if (t.kind === 'side' && t.endAt === 'chapter') {
      // The host's scenes after a side story's end know what happened in it.
      const all = new Set(before.chapters.flatMap((c) => c.scenes.map((s) => s.id)))
      const was = minus(all, scenesUpTo(before, sideAddStep(stepsBefore, t)))
      const now = minus(all, scenesUpTo(after, sideAddStep(stepsAfter, t)))
      const gained = minus(now, was)
      const lost = minus(was, now)
      if (isMoved(gained) && !lost.size) notes.push(`This moved ${what} after where ${t.title} ends, so it now knows what happened in ${t.title}.`)
      else if (isMoved(lost) && !gained.size) notes.push(`This moved ${what} before where ${t.title} ends, so it no longer knows what happened in ${t.title}.`)
      else {
        if (gained.size) notes.push(`${more(gained.size)} of ${before.title} now ${gained.size === 1 ? 'knows' : 'know'} what happened in ${t.title}.`)
        if (lost.size) notes.push(`${scenes(lost.size)} of ${before.title} no longer ${lost.size === 1 ? 'knows' : 'know'} what happened in ${t.title}.`)
      }
    }
  }
  return { notes, from }
}

/**
 * Where the stories that start or end after a scene or chapter will start or end once it is deleted,
 * worked out as loadShape does: the scene before it in its chapter, else the end of the chapter before,
 * else the story's start (after its start-of-story changes).
 */
export function deleteNotes(shape: WorldShape, kind: 'scene' | 'chapter', id: ID): string[] {
  const at = locate(shape, kind, id)
  if (!at) return []
  const story = at.story
  const after = cloneStory(story)
  if (kind === 'scene') after.chapters[after.chapters.findIndex((c) => c.id === at.chapter.id)].scenes.splice(at.index, 1)
  else after.chapters.splice(at.index, 1)
  const chapterIndex = story.chapters.findIndex((c) => c.id === at.chapter.id)
  const gone = new Set(kind === 'scene' ? [id] : at.chapter.scenes.map((s) => s.id))
  /** The chapter before the deleted one (or before the deleted scene's chapter), in the story as it will be. */
  const chapterBefore = story.chapters[chapterIndex - 1]?.id ?? null
  const where = (point: { at: 'chapter' | 'scene' | 'post'; refId: ID | null }): string => pointWords(after, point.at, point.refId)

  const notes: string[] = []
  for (const t of shape.stories) {
    if (t.id === story.id || t.startStoryId !== story.id) continue
    const startGone = (t.startAt === 'chapter' && kind === 'chapter' && t.startRefId === id) || (t.startAt === 'scene' && !!t.startRefId && gone.has(t.startRefId))
    if (startGone) {
      let point: { at: 'chapter' | 'scene' | 'post'; refId: ID | null }
      const earlier = kind === 'scene' ? at.chapter.scenes.slice(0, at.index) : []
      if (t.startAt === 'scene' && kind === 'scene' && earlier.length) point = { at: 'scene', refId: earlier[earlier.length - 1].id }
      else if (t.startAt === 'scene' && kind === 'scene') point = chapterBefore ? { at: 'chapter', refId: chapterBefore } : { at: 'post', refId: null }
      else point = chapterBefore ? { at: 'chapter', refId: chapterBefore } : { at: 'post', refId: null }
      notes.push(`${t.title} now starts ${where(point)}, because the ${t.startAt === 'scene' ? 'scene' : 'chapter'} it started after was deleted.`)
    }
    if (t.kind === 'side' && t.endAt === 'chapter' && kind === 'chapter' && t.endRefId === id) {
      notes.push(
        chapterBefore
          ? `${t.title} now ends after ${story.title}, Ch ${chapterIndex}, because the chapter it ended after was deleted.`
          : `${t.title} now ends at the beginning of ${story.title}, because the chapter it ended after was deleted.`
      )
    }
  }
  return notes
}
