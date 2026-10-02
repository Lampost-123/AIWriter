// What the outline helper adds to a story, and the chapter and act changes the binder makes with acts:
// a chapter made straight into an act, what Adam kept from a suggested outline (acts, chapters, and
// scenes with their cards filled), and what deleting an act does to other stories. The SQL is in
// db/acts.ts and db/repo.ts; this puts the pieces together, each change in one transaction. No
// Electron imports.

import type Database from 'better-sqlite3'
import type { ChapterPlace, KeepItem, KeepRef, KeptItem } from '@shared/contracts/outline'
import type { Chapter, ID } from '@shared/types'
import { emptySceneCard } from '@shared/defaults'
import type { WorldShape } from '../memory/types'
import * as repo from '../db/repo'
import * as acts from '../db/acts'
import { deleteNotes } from '../stories/points'
import { isBlankPlan, storyPlan } from './context'
import { UserError } from '../util'

type DB = Database.Database

/** The longest title, purpose, goal or beat the helper keeps, and the most beats on one card. */
export const KEEP_LIMITS = { title: 200, text: 2000, beat: 500, beats: 12 }

const oneLine = (s: unknown, max: number): string =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim()

/** A scene's beats as the card keeps them: one line each, no empty ones, at most KEEP_LIMITS.beats. */
export const cleanBeats = (beats: unknown): string[] =>
  (Array.isArray(beats) ? beats : [])
    .map((b) => oneLine(b, KEEP_LIMITS.beat))
    .filter(Boolean)
    .slice(0, KEEP_LIMITS.beats)

/** A new chapter, straight into an act (or among the chapters with no act): see ChapterPlace for where. */
export function createChapterAt(db: DB, storyId: ID, place: ChapterPlace & { title?: string }): Chapter {
  return db.transaction(() => {
    const title = oneLine(place.title, KEEP_LIMITS.title)
    const made = repo.createChapter(db, storyId, title ? { title } : {})
    acts.placeChapter(db, made.id, { actId: place.actId ?? null, afterId: place.afterId, beforeId: place.beforeId, index: place.index })
    return repo.getChapter(db, made.id)
  })()
}

/**
 * Adds what Adam kept from the outline helper, in the order given (see KeepItem): acts, chapters with
 * their goals, and scenes whose cards carry the suggestion's summary (as the goal) and beats. Says what
 * was made from each item, so the helper can mark it kept and its Undo can take it back. All or nothing.
 *
 * A story with nothing in it yet but the empty "Chapter 1" and "Scene 1" it was made with (no words, no
 * card): the first chapter kept becomes that chapter, and the first scene kept into it that scene, so
 * they don't stay behind above the outline. Anything with words or a card in it is never touched.
 */
export function keepOutline(db: DB, storyId: ID, items: KeepItem[]): KeptItem[] {
  if (!Array.isArray(items) || !items.length) return []
  repo.getStory(db, storyId)
  return db.transaction(() => {
    const start = repo.getOutline(db, storyId)
    const blank = isBlankPlan(storyPlan(db, storyId))
    let spareChapter: ID | null = blank ? (start.chapters[0]?.id ?? null) : null
    let spareScene: ID | null = blank && spareChapter ? (start.scenes.find((sc) => sc.chapterId === spareChapter)?.id ?? null) : null
    const made = new Map<string, KeptItem>()
    const resolve = (ref: KeepRef | undefined, kind: KeptItem['kind']): ID | null => {
      if (!ref) return null
      if (ref.key) {
        const k = made.get(ref.key)
        if (k?.kind === kind) return k.id
      }
      return ref.id ?? null
    }
    const kept: KeptItem[] = []
    for (const item of items) {
      const key = String(item?.key ?? '')
      if (!key || made.has(key)) throw new UserError('Those suggestions are muddled. Please suggest again.')
      const title = oneLine(item.title, KEEP_LIMITS.title)
      const text = String(item.text ?? '')
        .trim()
        .slice(0, KEEP_LIMITS.text)
        .trim()
      let id: ID
      let reused = false
      if (item.kind === 'act') {
        id = acts.createAct(db, storyId, {
          title,
          purpose: text,
          afterId: resolve(item.after, 'act'),
          beforeId: resolve(item.before, 'act')
        }).id
      } else if (item.kind === 'chapter') {
        // Into its act; with none given, into the story's last act (if it has acts).
        const all = acts.listActs(db, storyId)
        const actId = resolve(item.parent, 'act') ?? (item.parent ? null : (all[all.length - 1]?.id ?? null))
        if (item.parent && !actId) throw new UserError('That act no longer exists.')
        // The story's untouched first chapter takes this one's place, rather than staying behind.
        const chapter = spareChapter ? repo.getChapter(db, spareChapter) : repo.createChapter(db, storyId, title ? { title } : {})
        if (spareChapter && title) repo.updateChapter(db, chapter.id, { title })
        reused = !!spareChapter
        spareChapter = null
        if (text) repo.updateChapter(db, chapter.id, { goal: text })
        acts.placeChapter(db, chapter.id, { actId, afterId: resolve(item.after, 'chapter'), beforeId: resolve(item.before, 'chapter') })
        id = chapter.id
      } else if (item.kind === 'scene') {
        const chapterId = resolve(item.parent, 'chapter')
        if (!chapterId) throw new UserError('That chapter no longer exists.')
        const after = resolve(item.after, 'scene')
        const before = after ? null : resolve(item.before, 'scene')
        const others = (except: ID): ID[] =>
          repo
            .getOutline(db, storyId)
            .scenes.filter((s) => s.chapterId === chapterId && s.id !== except)
            .map((s) => s.id)
        // The story's untouched first scene, when this goes into the chapter it is in, takes this one's place.
        const reuse = spareScene && repo.getSceneMeta(db, spareScene).chapterId === chapterId ? spareScene : null
        let scene: { id: ID }
        if (reuse) {
          if (title) repo.updateScene(db, reuse, { title })
          const order = others(reuse)
          const at =
            after && order.includes(after) ? order.indexOf(after) + 1 : before && order.includes(before) ? order.indexOf(before) : 0
          repo.moveScene(db, reuse, chapterId, at)
          scene = { id: reuse }
          spareScene = null
          reused = true
        } else {
          scene = repo.createScene(db, chapterId, { ...(title ? { title } : {}), afterId: after })
          if (before) {
            const order = others(scene.id)
            if (order.includes(before)) repo.moveScene(db, scene.id, chapterId, order.indexOf(before))
          }
        }
        repo.updateSceneCard(db, scene.id, { ...emptySceneCard(), goal: text, beats: cleanBeats(item.beats) })
        id = scene.id
      } else throw new UserError('Those suggestions are muddled. Please suggest again.')
      // Its Undo can then tell whether Adam has changed it since.
      acts.markMade(db, item.kind, id)
      const k: KeptItem = reused ? { key, kind: item.kind, id, reused } : { key, kind: item.kind, id }
      made.set(key, k)
      kept.push(k)
    }
    return kept
  })()
}

/**
 * Before an act is deleted: where the other stories that start or end in its chapters will start or end
 * instead ("Kell's Road now starts after Book 1, Ch 2 instead."). Worked out a chapter at a time, as if
 * deleted first to last, so each note names a place that is still there afterwards.
 */
export function actDeleteNotes(shape: WorldShape, chapterIds: ID[]): string[] {
  let now = shape
  const notes: string[] = []
  for (const id of chapterIds) {
    for (const n of deleteNotes(now, 'chapter', id)) if (!notes.includes(n)) notes.push(n)
    now = {
      ...now,
      stories: now.stories.map((s) => (s.chapters.some((c) => c.id === id) ? { ...s, chapters: s.chapters.filter((c) => c.id !== id) } : s))
    }
  }
  return notes
}
