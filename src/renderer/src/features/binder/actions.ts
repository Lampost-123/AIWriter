// What the binder (and the scene header) do to chapters and scenes. Each action
// updates the tree straight away, calls the API, then reloads the outline.
// Deletes are immediate and undoable from a toast (and from Recently deleted for 30 days);
// there are no confirmations.

import type { ID, SceneStatus } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import type { Noun } from '@/lib/deleteWords'
import { announceDelete, type Deletion } from '@/lib/undoDelete'
import { useApp } from '@/lib/store'
import {
  actOf,
  chapterRuns,
  moveToActPlace,
  neighbourAfterRemoval,
  placeChapterIn,
  readingOrder,
  shownOrder,
  withActStartedAt
} from './outlineModel'
import { useOutlineStore } from './outlineStore'

const app = useApp.getState
const outlineStore = useOutlineStore.getState

function failed(e: unknown): void {
  toast((e as Error).message || 'That didn’t work. Please try again.', { tone: 'danger' })
  app().bumpOutline()
}

/**
 * Saves the open scene first if it's about to disappear, so no typing is lost. A draft being written
 * into it stops first and its last words are saved too, so nothing is ever written into a deleted scene.
 */
async function saveIfOpen(sceneIds: ID[]): Promise<void> {
  const bridge = editorBridge()
  if (!bridge?.sceneId || !sceneIds.includes(bridge.sceneId)) return
  await bridge.stopDraft('deleted')
  await bridge.flush()
}

export async function addChapter(storyId: ID, afterId?: ID | null): Promise<ID | null> {
  try {
    const chapter = await api.createChapter(storyId, { afterId: afterId ?? null })
    outlineStore().patch((o) => {
      if (o.story.id !== storyId) return o
      const chapters = o.chapters.slice()
      const at = afterId ? chapters.findIndex((c) => c.id === afterId) + 1 : chapters.length
      chapters.splice(at > 0 ? at : chapters.length, 0, chapter)
      return { ...o, chapters: chapters.map((c, position) => ({ ...c, position })) }
    })
    app().bumpOutline()
    return chapter.id
  } catch (e) {
    failed(e)
    return null
  }
}

/** Adds a scene (after `afterId`, else at the end of the chapter) and opens it. */
export async function addScene(chapterId: ID, afterId?: ID | null): Promise<ID | null> {
  try {
    const scene = await api.createScene(chapterId, { afterId: afterId ?? null })
    outlineStore().patch((o) => {
      if (!o.chapters.some((c) => c.id === chapterId)) return o
      const inChapter = o.scenes.filter((s) => s.chapterId === chapterId)
      const at = afterId ? inChapter.findIndex((s) => s.id === afterId) + 1 : inChapter.length
      inChapter.splice(at > 0 ? at : inChapter.length, 0, scene)
      const renumbered = new Map(inChapter.map((s, position) => [s.id, { ...s, position }]))
      const others = o.scenes.filter((s) => s.chapterId !== chapterId)
      return { ...o, scenes: [...others, ...renumbered.values()] }
    })
    const storyId = outlineStore().outline?.story.id ?? app().storyId ?? undefined
    app().selectScene(scene.id, storyId)
    app().bumpOutline()
    return scene.id
  } catch (e) {
    failed(e)
    return null
  }
}

export async function renameScene(id: ID, title: string): Promise<void> {
  const clean = title.trim()
  if (!clean) return
  outlineStore().patch((o) => ({ ...o, scenes: o.scenes.map((s) => (s.id === id ? { ...s, title: clean } : s)) }))
  try {
    await api.updateScene(id, { title: clean })
    app().bumpOutline()
  } catch (e) {
    failed(e)
  }
}

export async function setSceneStatus(id: ID, status: SceneStatus): Promise<void> {
  outlineStore().patch((o) => ({ ...o, scenes: o.scenes.map((s) => (s.id === id ? { ...s, status } : s)) }))
  try {
    await api.updateScene(id, { status })
    app().bumpOutline()
  } catch (e) {
    failed(e)
  }
}

export async function renameChapter(id: ID, title: string): Promise<void> {
  const clean = title.trim()
  if (!clean) return
  outlineStore().patch((o) => ({ ...o, chapters: o.chapters.map((c) => (c.id === id ? { ...c, title: clean } : c)) }))
  try {
    await api.updateChapter(id, { title: clean })
    app().bumpOutline()
  } catch (e) {
    failed(e)
  }
}

export async function renameStory(id: ID, title: string): Promise<void> {
  const clean = title.trim()
  if (!clean) return
  useApp.setState((s) => ({ stories: s.stories.map((st) => (st.id === id ? { ...st, title: clean } : st)) }))
  outlineStore().patch((o) => (o.story.id === id ? { ...o, story: { ...o.story, title: clean } } : o))
  try {
    await api.updateStory(id, { title: clean })
    await app().refreshStories()
  } catch (e) {
    toast((e as Error).message, { tone: 'danger' })
    void app().refreshStories()
  }
}

/**
 * What a move or delete does to other stories that start or end there ("This moved “The ferry” before
 * where Mara's Hand starts, so that story now includes it."). Asked before the change; a failure to ask
 * never stops the change itself. A delete's notes go in its own toast, so Undo takes them away with it.
 */
const notesFor = (ask: () => Promise<string[]>): Promise<string[]> => ask().catch(() => [])

/**
 * A delete for the Undo toast: "“Ashore” deleted." with where another story now starts or ends ("Kell's
 * Road now starts after Book 1, Ch 1 instead."). The notes also travel on their own, for a toast that
 * gathers several deletes to keep (see the report's "Needs from integration" for lib/undoDelete.ts).
 */
const deletion = (message: string, notes: string[], noun: Noun, undo: () => Promise<void>): Deletion => ({
  message: [message, ...notes].join(' '),
  notes,
  noun,
  undo
})

/** Tells Adam what a move changed for other stories, with Undo (moving it back). */
function tellMoved(notes: string[], undo: () => Promise<void>): void {
  if (!notes.length) return
  toast(notes.join(' '), {
    action: {
      label: 'Undo',
      run: () =>
        void undo()
          .then(() => app().bumpOutline())
          .catch(failed)
    }
  })
}

function removeFromOutline(sceneIds: ID[], chapterId?: ID): void {
  const gone = new Set(sceneIds)
  outlineStore().patch((o) => ({
    ...o,
    chapters: chapterId ? o.chapters.filter((c) => c.id !== chapterId) : o.chapters,
    scenes: o.scenes.filter((s) => !gone.has(s.id))
  }))
}

/** Opens a scene without leaving the page Adam is on (the outline helper, say). */
function openWithoutLeaving(id: ID | null, storyId?: ID): void {
  const view = app().view
  app().selectScene(id, storyId)
  app().navigate(view)
}

/**
 * Picks a neighbour when the open scene is going away. Returns whether the open scene was affected.
 * `stay`: on the page Adam is on, rather than going to the scene.
 */
function moveSelectionAway(sceneIds: ID[], stay = false): boolean {
  const o = outlineStore().outline
  const openId = app().sceneId
  if (!o || !openId || !sceneIds.includes(openId)) return false
  const next = neighbourAfterRemoval(readingOrder(o), sceneIds, openId)
  if (stay) openWithoutLeaving(next, o.story.id)
  else app().selectScene(next, o.story.id)
  return true
}

export async function deleteScene(id: ID): Promise<void> {
  const o = outlineStore().outline
  const scene = o?.scenes.find((s) => s.id === id)
  const storyId = o?.story.id
  const notes = await notesFor(() => api.deleteNotes('scene', id))
  try {
    await saveIfOpen([id])
    await api.deleteScene(id)
  } catch (e) {
    failed(e)
    return
  }
  const wasOpen = moveSelectionAway([id])
  removeFromOutline([id])
  app().bumpOutline()
  announceDelete(
    deletion(`“${scene?.title || 'Untitled scene'}” deleted.`, notes, ['scene', 'scenes'], () =>
      api
        .restoreDeleted('scene', id)
        .then(() => {
          app().bumpOutline()
          if (wasOpen && storyId && app().storyId === storyId) app().selectScene(id, storyId)
        })
        .catch((e: Error) => void toast(e.message, { tone: 'danger' }))
    )
  )
}

/** Deletes a chapter with its scenes. `stay`: from a page other than the binder (the outline helper), which it doesn't leave. */
export async function deleteChapter(id: ID, opts: { stay?: boolean } = {}): Promise<void> {
  const o = outlineStore().outline
  const chapter = o?.chapters.find((c) => c.id === id)
  const sceneIds = o?.scenes.filter((s) => s.chapterId === id).map((s) => s.id) ?? []
  const storyId = o?.story.id
  const openBefore = app().sceneId
  const notes = await notesFor(() => api.deleteNotes('chapter', id))
  try {
    await saveIfOpen(sceneIds)
    await api.deleteChapter(id)
  } catch (e) {
    failed(e)
    return
  }
  const wasOpen = moveSelectionAway(sceneIds, opts.stay)
  removeFromOutline(sceneIds, id)
  app().bumpOutline()
  const count = sceneIds.length
  const what = count === 0 ? '' : count === 1 ? ' and its scene' : ` and its ${count} scenes`
  announceDelete(
    deletion(`“${chapter?.title || 'Untitled chapter'}”${what} deleted.`, notes, ['chapter', 'chapters'], () =>
      api
        .restoreDeleted('chapter', id)
        .then(() => {
          app().bumpOutline()
          if (wasOpen && openBefore && storyId && app().storyId === storyId) {
            if (opts.stay) openWithoutLeaving(openBefore, storyId)
            else app().selectScene(openBefore, storyId)
          }
        })
        .catch((e: Error) => void toast(e.message, { tone: 'danger' }))
    )
  )
}

export async function moveScene(id: ID, chapterId: ID, index: number): Promise<void> {
  let preview: { notes: string[]; from: { chapterId: ID | null; index: number } } | null = null
  try {
    preview = await api.previewMove({ kind: 'scene', id, chapterId, index }).catch(() => null)
    await api.moveScene(id, chapterId, index)
  } catch (e) {
    failed(e)
    return
  }
  app().bumpOutline()
  const from = preview?.from
  if (preview && from?.chapterId) tellMoved(preview.notes, () => api.moveScene(id, from.chapterId!, from.index))
}

export async function moveChapter(id: ID, index: number): Promise<void> {
  let preview: { notes: string[]; from: { chapterId: ID | null; index: number } } | null = null
  try {
    preview = await api.previewMove({ kind: 'chapter', id, index }).catch(() => null)
    await api.moveChapter(id, index)
  } catch (e) {
    failed(e)
    return
  }
  app().bumpOutline()
  if (preview) tellMoved(preview.notes, () => api.moveChapter(id, preview!.from.index))
}

// ---------- Acts (milestone 4) ----------

/** A new act just after `afterId` (else after every act); resolves with its id. */
export async function addAct(storyId: ID, afterId?: ID | null): Promise<ID | null> {
  try {
    const act = await api.createAct(storyId, { afterId: afterId ?? null })
    outlineStore().patch((o) => {
      if (o.story.id !== storyId) return o
      const acts = (o.acts ?? []).slice()
      const at = afterId ? acts.findIndex((a) => a.id === afterId) + 1 : acts.length
      acts.splice(at > 0 ? at : acts.length, 0, act)
      return { ...o, acts: acts.map((a, position) => ({ ...a, position })) }
    })
    app().bumpOutline()
    return act.id
  } catch (e) {
    failed(e)
    return null
  }
}

export async function renameAct(id: ID, title: string): Promise<void> {
  const clean = title.trim()
  if (!clean) return
  outlineStore().patch((o) => ({ ...o, acts: o.acts?.map((a) => (a.id === id ? { ...a, title: clean } : a)) }))
  try {
    await api.updateAct(id, { title: clean })
    app().bumpOutline()
  } catch (e) {
    failed(e)
  }
}

/** What the act does for the story (the outline helper's "purpose"). */
export async function setActPurpose(id: ID, purpose: string): Promise<void> {
  const clean = purpose.replace(/\s+/g, ' ').trim()
  outlineStore().patch((o) => ({ ...o, acts: o.acts?.map((a) => (a.id === id ? { ...a, purpose: clean } : a)) }))
  try {
    await api.updateAct(id, { purpose: clean })
    app().bumpOutline()
  } catch (e) {
    failed(e)
  }
}

/** A new chapter at the end of an act; resolves with its id. */
export async function addChapterToAct(storyId: ID, actId: ID): Promise<ID | null> {
  try {
    const chapter = await api.createChapterAt(storyId, { actId })
    outlineStore().patch((o) => (o.story.id === storyId ? placeChapterIn({ ...o, chapters: [...o.chapters, chapter] }, chapter.id, { actId }) : o))
    app().bumpOutline()
    return chapter.id
  } catch (e) {
    failed(e)
    return null
  }
}

/**
 * Moves a chapter into another act (the start of a later act, the end of an earlier one). Says where
 * it went, with what that changes for other stories, and offers Undo.
 */
export async function moveChapterToAct(chapterId: ID, actId: ID): Promise<void> {
  const o = outlineStore().outline
  const place = o ? moveToActPlace(o, chapterId, actId) : null
  if (!o || !place) return
  const chapter = o.chapters.find((c) => c.id === chapterId)
  const act = o.acts?.find((a) => a.id === actId)
  const fromAct = actOf(o, chapterId)
  // Where it is now among its act's chapters, for Undo.
  const fromIndex = Math.max(0, chapterRuns(o, shownOrder(o, o.chapters.map((c) => c.id))).find((r) => (r.act?.id ?? null) === fromAct)?.chapters.indexOf(chapterId) ?? 0)
  const moved = placeChapterIn(o, chapterId, place)
  const index = moved.chapters.findIndex((c) => c.id === chapterId)
  const notes = await notesFor(() => api.previewMove({ kind: 'chapter', id: chapterId, index }).then((p) => p.notes))
  outlineStore().patch((now) => (now.story.id === o.story.id ? placeChapterIn(now, chapterId, place) : now))
  try {
    await api.placeChapter(chapterId, place)
  } catch (e) {
    failed(e)
    return
  }
  app().bumpOutline()
  const actName = act?.title.trim() ? `“${act.title.trim()}”` : 'the act'
  const message = `Moved “${chapter?.title || 'Untitled chapter'}” to ${actName}.`
  toast([message, ...notes].join(' '), {
    action: {
      label: 'Undo',
      run: () =>
        void api
          .placeChapter(chapterId, { actId: fromAct, index: fromIndex })
          .then(() => app().bumpOutline())
          .catch(failed)
    }
  })
}

/**
 * A new act starting at this chapter, with the chapters after it in its act (or those after it with no
 * act, so a story written without acts can be given them): the story reads in the same order. Undo in
 * the toast joins it back. Resolves with the act's id.
 */
export async function startActAt(chapterId: ID): Promise<ID | null> {
  const title = outlineStore().outline?.chapters.find((c) => c.id === chapterId)?.title || 'Untitled chapter'
  let made: Awaited<ReturnType<typeof api.startActAt>>
  try {
    made = await api.startActAt(chapterId)
  } catch (e) {
    failed(e)
    return null
  }
  outlineStore().patch((o) => (o.story.id === made.act.storyId ? withActStartedAt(o, made.act, made.chapterIds) : o))
  app().bumpOutline()
  toast(`Started a new act at “${title}”.`, {
    action: {
      label: 'Undo',
      run: () =>
        void api
          .joinActBack(made.act.id)
          .then(() => app().bumpOutline())
          .catch(failed)
    }
  })
  return made.act.id
}

/** Deletes an act with its chapters and their scenes; Undo in the toast brings them all back. */
export async function deleteAct(id: ID): Promise<void> {
  const o = outlineStore().outline
  const act = o?.acts?.find((a) => a.id === id)
  const chapterIds = o?.chapters.filter((c) => c.actId === id).map((c) => c.id) ?? []
  const gone = new Set(chapterIds)
  const sceneIds = o?.scenes.filter((s) => gone.has(s.chapterId)).map((s) => s.id) ?? []
  const storyId = o?.story.id
  const openBefore = app().sceneId
  const notes = await notesFor(() => api.actDeleteNotes(id))
  try {
    await saveIfOpen(sceneIds)
    await api.deleteAct(id)
  } catch (e) {
    failed(e)
    return
  }
  const wasOpen = moveSelectionAway(sceneIds)
  const scenesGone = new Set(sceneIds)
  outlineStore().patch((now) => ({
    ...now,
    acts: now.acts?.filter((a) => a.id !== id),
    chapters: now.chapters.filter((c) => !gone.has(c.id)),
    scenes: now.scenes.filter((s) => !scenesGone.has(s.id))
  }))
  app().bumpOutline()
  const count = chapterIds.length
  const what = count === 0 ? '' : count === 1 ? ' and its chapter' : ` and its ${count} chapters`
  announceDelete(
    deletion(`“${act?.title || 'Untitled act'}”${what} deleted.`, notes, ['act', 'acts'], () =>
      api
        .restoreAct(id)
        .then(() => {
          app().bumpOutline()
          if (wasOpen && openBefore && storyId && app().storyId === storyId) app().selectScene(openBefore, storyId)
        })
        .catch((e: Error) => void toast(e.message, { tone: 'danger' }))
    )
  )
}
