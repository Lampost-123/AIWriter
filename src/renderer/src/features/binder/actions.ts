// What the binder (and the scene header) do to chapters and scenes. Each action
// updates the tree straight away, calls the API, then reloads the outline.
// Deletes are immediate and undoable from a toast; there are no confirmations.

import type { ID, SceneStatus } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { neighbourAfterRemoval, readingOrder } from './outlineModel'
import { useOutlineStore } from './outlineStore'

const app = useApp.getState
const outlineStore = useOutlineStore.getState

function failed(e: unknown): void {
  toast((e as Error).message || 'That didn’t work. Please try again.', { tone: 'danger' })
  app().bumpOutline()
}

/** Saves the open scene first if it's about to disappear, so no typing is lost. */
async function saveIfOpen(sceneIds: ID[]): Promise<void> {
  const bridge = editorBridge()
  if (bridge?.sceneId && sceneIds.includes(bridge.sceneId)) await bridge.flush()
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

/** Creates a story that continues after the last one, with a first chapter and scene, and opens it. */
export async function newStory(): Promise<ID | null> {
  try {
    const n = app().stories.length + 1
    const story = await api.createStory({ title: `Book ${n}` })
    const chapter = await api.createChapter(story.id, {})
    const scene = await api.createScene(chapter.id, {})
    await editorBridge()?.flush()
    await app().refreshStories()
    app().selectScene(scene.id, story.id)
    return story.id
  } catch (e) {
    toast((e as Error).message, { tone: 'danger' })
    return null
  }
}

function removeFromOutline(sceneIds: ID[], chapterId?: ID): void {
  const gone = new Set(sceneIds)
  outlineStore().patch((o) => ({
    ...o,
    chapters: chapterId ? o.chapters.filter((c) => c.id !== chapterId) : o.chapters,
    scenes: o.scenes.filter((s) => !gone.has(s.id))
  }))
}

/** Picks a neighbour when the open scene is going away. Returns whether the open scene was affected. */
function moveSelectionAway(sceneIds: ID[]): boolean {
  const o = outlineStore().outline
  const openId = app().sceneId
  if (!o || !openId || !sceneIds.includes(openId)) return false
  const next = neighbourAfterRemoval(readingOrder(o), sceneIds, openId)
  app().selectScene(next, o.story.id)
  return true
}

export async function deleteScene(id: ID): Promise<void> {
  const o = outlineStore().outline
  const scene = o?.scenes.find((s) => s.id === id)
  const storyId = o?.story.id
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
  toast(`“${scene?.title ?? 'Scene'}” deleted.`, {
    action: {
      label: 'Undo',
      run: () =>
        void api
          .restoreDeleted('scene', id)
          .then(() => {
            app().bumpOutline()
            if (wasOpen && storyId && app().storyId === storyId) app().selectScene(id, storyId)
          })
          .catch((e: Error) => toast(e.message, { tone: 'danger' }))
    }
  })
}

export async function deleteChapter(id: ID): Promise<void> {
  const o = outlineStore().outline
  const chapter = o?.chapters.find((c) => c.id === id)
  const sceneIds = o?.scenes.filter((s) => s.chapterId === id).map((s) => s.id) ?? []
  const storyId = o?.story.id
  const openBefore = app().sceneId
  try {
    await saveIfOpen(sceneIds)
    await api.deleteChapter(id)
  } catch (e) {
    failed(e)
    return
  }
  const wasOpen = moveSelectionAway(sceneIds)
  removeFromOutline(sceneIds, id)
  app().bumpOutline()
  const count = sceneIds.length
  const what = count === 0 ? '' : count === 1 ? ' and its scene' : ` and its ${count} scenes`
  toast(`“${chapter?.title ?? 'Chapter'}”${what} deleted.`, {
    action: {
      label: 'Undo',
      run: () =>
        void api
          .restoreDeleted('chapter', id)
          .then(() => {
            app().bumpOutline()
            if (wasOpen && openBefore && storyId && app().storyId === storyId) app().selectScene(openBefore, storyId)
          })
          .catch((e: Error) => toast(e.message, { tone: 'danger' }))
    }
  })
}

export async function moveScene(id: ID, chapterId: ID, index: number): Promise<void> {
  try {
    await api.moveScene(id, chapterId, index)
  } catch (e) {
    failed(e)
    return
  }
  app().bumpOutline()
}

export async function moveChapter(id: ID, index: number): Promise<void> {
  try {
    await api.moveChapter(id, index)
  } catch (e) {
    failed(e)
    return
  }
  app().bumpOutline()
}
