// What the outline helper adds to a story, and the chapter and act changes the binder makes with acts:
// a chapter made straight into an act, what Adam kept from a suggested outline (acts, chapters, and
// scenes with their cards filled), and what deleting an act does to other stories. The SQL is in
// db/acts.ts and db/repo.ts; this puts the pieces together, each change in one transaction. No
// Electron imports.

import type Database from 'better-sqlite3'
import type { ChapterPlace, KeepItem, KeepRef, KeptItem } from '@shared/contracts/outline'
import type { Chapter, ID, SceneCard } from '@shared/types'
import { emptySceneCard } from '@shared/defaults'
import { withAiLink } from '@shared/threadLinks'
import type { WorldShape } from '../memory/types'
import * as repo from '../db/repo'
import * as acts from '../db/acts'
import { deleteNotes } from '../stories/points'
import { dayName } from '../worldViews/when'
import { isBlankPlan, storyPlan } from './context'
import { UserError } from '../util'

type DB = Database.Database

/** The longest title, purpose, goal, beat or When the helper keeps, and the most beats on one card. */
export const KEEP_LIMITS = { title: 200, text: 2000, beat: 500, beats: 12, when: 200 }

const oneLine = (s: unknown, max: number): string =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim()

/** The most plot threads one kept scene puts on each list of its card. */
const MOST_THREADS = 6

const threadKey = (s: string): string =>
  s
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/**
 * Plot threads by name for one keep (2026-10-08): an existing thread by its name or another name (in the story's
 * world), else a new one, AI-drafted, made in this story with the name as given. Each name is made once per keep.
 */
function threadFinder(db: DB, storyId: ID): (name: string) => { id: ID; made: boolean } | null {
  const known = new Map<string, ID>()
  for (const e of repo.listEntries(db)) {
    if (e.kind !== 'thread') continue
    for (const n of [e.name, ...e.aliases]) {
      const k = threadKey(n)
      if (k && !known.has(k)) known.set(k, e.id)
    }
  }
  return (raw) => {
    const name = oneLine(raw, KEEP_LIMITS.title)
    const k = threadKey(name)
    if (!k) return null
    const id = known.get(k)
    if (id) return { id, made: false }
    const e = repo.createEntry(db, 'thread', { name }, { origin: 'ai', originStoryId: storyId })
    known.set(k, e.id)
    return { id: e.id, made: true }
  }
}

/** The card with the kept scene's plot threads on it, marked as the AI's (never a second time, never one Adam took off). */
function withThreads(
  card: SceneCard,
  item: KeepItem,
  find: (name: string) => { id: ID; made: boolean } | null,
  made: ID[]
): SceneCard {
  let out = card
  for (const [list, names] of [
    ['setsUp', item.setsUp],
    ['paysOff', item.paysOff]
  ] as const) {
    for (const name of (Array.isArray(names) ? names : []).slice(0, MOST_THREADS)) {
      const t = find(String(name ?? ''))
      if (!t) continue
      if (t.made && !made.includes(t.id)) made.push(t.id)
      out = withAiLink(out, list, t.id) ?? out
    }
  }
  return out
}

/**
 * Undo of a keep: the plot threads it made go to Recently deleted while nothing else uses them (not edited by Adam,
 * on no other scene's card, nothing in the memory about them).
 */
export function takeBackThreads(db: DB, kept: Pick<KeptItem, 'threadIds'>[]): void {
  const ids = [...new Set(kept.flatMap((k) => k.threadIds ?? []))]
  if (!ids.length) return
  const onCards = new Set<ID>()
  for (const r of db.prepare('SELECT card_json FROM scenes WHERE deleted_at IS NULL').all() as { card_json: string | null }[]) {
    try {
      const c = JSON.parse(r.card_json ?? '{}') as Partial<SceneCard>
      for (const id of [...(c.setsUpIds ?? []), ...(c.paysOffIds ?? [])]) onCards.add(id)
    } catch {
      // A damaged card names nothing.
    }
  }
  for (const e of repo.getEntries(db, ids)) {
    if (e.origin !== 'ai' || e.byHand || onCards.has(e.id)) continue
    if (db.prepare('SELECT 1 FROM changes WHERE entry_id = ? AND deleted_at IS NULL LIMIT 1').get(e.id)) continue
    repo.deleteEntry(db, e.id, { origin: 'ai' })
  }
}

/** A scene's beats as the card keeps them: one line each, no empty ones, at most KEEP_LIMITS.beats. */
export const cleanBeats = (beats: unknown): string[] =>
  (Array.isArray(beats) ? beats : [])
    .map((b) => oneLine(b, KEEP_LIMITS.beat))
    .filter(Boolean)
    .slice(0, KEEP_LIMITS.beats)

/**
 * The When for a kept scene the AI gave none: the same day as the nearest scene before it in the story
 * that has a When ("Day 3, dusk" gives "Day 3"; a When that names no day of its own, such as "the next
 * morning", gives "Later that day", which follows it), or "Day 1" when no scene before it has one.
 * `before`: the Whens of the scenes before it, in reading order.
 */
export function fallbackWhen(before: string[]): string {
  for (let i = before.length - 1; i >= 0; i--) {
    const when = before[i].replace(/\s+/g, ' ').trim()
    if (when) return dayName(when) ?? 'Later that day'
  }
  return 'Day 1'
}

/** The Whens of the story's scenes before this one, in reading order. */
function whensBefore(db: DB, storyId: ID, sceneId: ID): string[] {
  const order = repo.getOutline(db, storyId).scenes.map((s) => s.id)
  const cards = acts.storyCards(db, storyId)
  const at = order.indexOf(sceneId)
  return order.slice(0, at < 0 ? order.length : at).map((id) => cards.get(id)?.when ?? '')
}

/** The chapter's only scene, while it is an untouched "Scene 1": no words, an empty card. Else null. */
function loneScene(db: DB, storyId: ID, chapterId: ID): ID | null {
  const scenes = repo.getOutline(db, storyId).scenes.filter((s) => s.chapterId === chapterId)
  if (scenes.length !== 1) return null
  const [only] = scenes
  if (only.wordCount > 0 || !/^\s*scene\s*1\s*$/i.test(only.title)) return null
  const scene = repo.getScene(db, only.id)
  // Anything pointing at it (an AI call made for it, a pin...) would stop its Undo putting it back.
  if (scene.text.trim() || acts.sceneReferenced(db, only.id)) return null
  const c = { ...emptySceneCard(), ...scene.card }
  const empty =
    !c.povId &&
    !c.locationId &&
    !c.presentIds.length &&
    !c.setsUpIds.length &&
    !c.paysOffIds.length &&
    ![c.goal, c.conflict, c.outcome, c.mood, c.notes, c.when, ...c.beats].some((v) => v.trim())
  return empty ? only.id : null
}

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
 * their goals, and scenes whose cards carry the suggestion's summary (as the goal), beats and When (see
 * fallbackWhen for a scene the AI gave none). Says what
 * was made from each item, so the helper can mark it kept and its Undo can take it back. All or nothing.
 *
 * A story with nothing in it yet but the empty "Chapter 1" and "Scene 1" it was made with (no words, no
 * card): the first chapter kept becomes that chapter, and the first scene kept into it that scene, so
 * they don't stay behind above the outline. Anything with words or a card in it is never touched. So too
 * for a chapter planned from its interview whose only scene is such an empty "Scene 1": the first scene
 * kept into it becomes that scene.
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
    // Plot threads named on the kept scenes, found or made once each for the whole keep.
    let findThread: ReturnType<typeof threadFinder> | null = null
    // Chapters a scene has gone into already: their lone "Scene 1" is never taken after that.
    const lonesUsed = new Set<ID>()
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
      let whenKept = false
      const threadIds: ID[] = []
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
        // The story's untouched first scene, when this goes into the chapter it is in, takes this one's place,
        // as does a chapter's lone untouched "Scene 1".
        const reuse =
          spareScene && repo.getSceneMeta(db, spareScene).chapterId === chapterId
            ? spareScene
            : !blank && !lonesUsed.has(chapterId)
              ? loneScene(db, storyId, chapterId)
              : null
        lonesUsed.add(chapterId)
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
        // A reused scene keeps what its card has; a When already on it (Adam's) is never replaced.
        const card: SceneCard = reuse ? repo.getScene(db, scene.id).card : emptySceneCard()
        const had = !!card.when.trim()
        const when = had ? card.when : oneLine(item.when, KEEP_LIMITS.when) || fallbackWhen(whensBefore(db, storyId, scene.id))
        const filled: SceneCard = { ...card, goal: text, beats: cleanBeats(item.beats), when }
        const threaded =
          item.setsUp?.length || item.paysOff?.length ? withThreads(filled, item, (findThread ??= threadFinder(db, storyId)), threadIds) : filled
        repo.updateSceneCard(db, scene.id, threaded)
        whenKept = reuse !== null && had
        id = scene.id
      } else throw new UserError('Those suggestions are muddled. Please suggest again.')
      // Its Undo can then tell whether Adam has changed it since.
      acts.markMade(db, item.kind, id)
      const k: KeptItem = reused ? { key, kind: item.kind, id, reused, ...(whenKept ? { whenKept } : {}) } : { key, kind: item.kind, id }
      if (threadIds.length) k.threadIds = threadIds
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
