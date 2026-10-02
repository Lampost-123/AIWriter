// What the story screens do: make a story and then ask what follows from it, change what a story is
// with Undo, answer "Should Book 2 now continue after it?", end a still-running side story first, and
// delete a story with Undo. Each updates the story list and leaves the screen in a sensible place.
// Undo always puts back what a story was as the memory had it (getStoryPlacement): a start or end at
// something deleted has moved, and the stored one would be refused.
import { create } from 'zustand'
import type { StoryPlacement } from '@shared/api'
import type { CreatedStory, NewStoryInput, StoryRef } from '@shared/contracts/stories'
import type { ID, Story } from '@shared/types'
import { toast, useToasts } from '@/components/ui/Toast'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { announceDelete } from '@/lib/undoDelete'
import { requestEditorFocus } from '@/features/editor/focusRequest'
import { lastSceneOf } from '@/features/binder/lastScene'
import { openStyleTab } from '@/features/style/StyleView'
import { runFlow } from './flows'

const app = useApp.getState

const reason = (e: unknown): string => (e as Error)?.message || 'That didn’t work. Please try again.'
const failed = (e: unknown): void => void toast(reason(e), { tone: 'danger' })
const refresh = (): Promise<void> =>
  app()
    .refreshStories()
    .catch(() => undefined)

/** Undo: puts a story's placement back, then reloads the stories. */
const putBack = (storyId: ID, was: StoryPlacement): void =>
  void api
    .setStoryPlacement(storyId, was)
    .then(() => refresh())
    .catch(failed)

/** Runs `then` once a toast has gone: timed out, closed, or cleared by a world switch. */
function afterToast(toastId: number, then: () => void): void {
  const off = useToasts.subscribe((s) => {
    if (s.items.some((t) => t.id === toastId)) return
    off()
    then()
  })
}

/**
 * A section of a story's settings to open at ("Choose cast" in a toast): that story's page brings it
 * into view and takes it, whether it opens now or is already open.
 */
export const useSectionRequest = create<{ request: { storyId: ID; section: string } | null }>(() => ({ request: null }))

/**
 * Stories whose yes to "Should Book 2 now continue after it?" can still be undone. Story settings doesn't
 * offer "When did these happen?" for them meanwhile: the sort starts by itself once Undo has gone.
 */
export const useFollowUndo = create<{ storyIds: ID[] }>(() => ({ storyIds: [] }))
const holdSort = (storyId: ID, on: boolean): void =>
  useFollowUndo.setState((s) => {
    const i = s.storyIds.indexOf(storyId)
    return { storyIds: on ? [...s.storyIds, storyId] : s.storyIds.filter((_, j) => j !== i) }
  })

/** Opens a story's settings, at a section if given. */
export function openStorySettings(storyId: ID, section?: string): void {
  useSectionRequest.setState({ request: section ? { storyId, section } : null })
  app().navigate({ kind: 'story', storyId })
}

/** Opens a story at the scene last open in it, else its first scene. */
export async function openStory(storyId: ID): Promise<void> {
  await editorBridge()?.flush()
  const outline = await api.getOutline(storyId)
  const remembered = lastSceneOf(storyId)
  const scene = outline.scenes.find((s) => s.id === remembered) ?? outline.scenes[0] ?? null
  app().selectScene(scene?.id ?? null, storyId)
}

/**
 * Makes the story (with its first chapter and scene, ending first any side story Adam chose to) and
 * opens it, then, where it applies: says which stories now end first (with Undo), fills in what changed
 * in its time gap, asks "Should Book 2 now continue after it?", and asks for a prequel's cast. `onMade`
 * runs as soon as it exists (the dialog closes then, so the new scene keeps the focus). Returns why it
 * couldn't be made, in plain words, for the dialog to show; null once it is made.
 */
export async function createStory(input: NewStoryInput, onMade?: () => void): Promise<string | null> {
  let made: CreatedStory
  try {
    await editorBridge()?.flush()
    made = await api.createStoryAs(input)
  } catch (e) {
    return reason(e)
  }
  const { story, sceneId } = made
  onMade?.()
  await refresh()
  app().selectScene(sceneId, story.id)
  requestEditorFocus(sceneId)
  for (const e of made.endedFirst) {
    toast(`${e.title} now ends after ${e.chapter}.`, { action: { label: 'Undo', run: () => putBack(e.storyId, e.was) } })
  }
  const gap = story.timeGap.trim()
  if (gap) runFlow(story.id, 'time-gap', () => api.fillTimeGap(story.id), gap)
  const follow = made.mightFollow[0]
  if (follow) askToFollow(story, follow)
  if (story.kind === 'prequel') {
    toast(`${story.title} is a prequel. Choose who and what it starts with, and the AI drafts how each of them was back then.`, {
      action: { label: 'Choose cast', run: () => openStorySettings(story.id, 'cast') }
    })
  }
  return null
}

/** "Should Book 2 now continue after it?", as a question in a toast. Story settings asks it too, until answered. */
export function askToFollow(story: Pick<Story, 'id' | 'title'>, book: StoryRef): void {
  toast(`Should ${book.title} now continue after ${story.title}?`, {
    action: { label: 'Yes', run: () => void moveToFollow(story, book) }
  })
}

/**
 * Adam's yes: the book now continues after the new story, with Undo. The AI sorts the book's
 * start-of-story changes into before, during and after the new story ("When did these happen?") only
 * once Undo is no longer offered, so an Undo never leaves them sorted for a book that went back.
 */
export async function moveToFollow(story: Pick<Story, 'id' | 'title'>, book: StoryRef): Promise<void> {
  const worldId = app().world?.id
  let was: StoryPlacement
  try {
    was = await api.getStoryPlacement(book.storyId)
    await api.setStoryPlacement(book.storyId, {
      ...was,
      kind: 'continues',
      startStoryId: story.id,
      startAt: 'end',
      startRefId: null,
      endAt: null,
      endRefId: null
    })
  } catch (e) {
    failed(e)
    return
  }
  holdSort(story.id, true)
  await refresh()
  let undone = false
  const shown = toast(`${book.title} now continues after ${story.title}.`, {
    action: {
      label: 'Undo',
      run: () => {
        undone = true
        void api
          .setStoryPlacement(book.storyId, was)
          .then(() => refresh())
          .catch(failed)
          .finally(() => holdSort(story.id, false))
      }
    }
  })
  afterToast(shown, () => {
    if (undone) return
    // The toast also goes when Adam switches worlds, just before the switch reaches the main process.
    // Asked a moment later, the main process names the world that is open by then: the sort runs only
    // if it is still this one, and otherwise waits in story settings ("When did these happen?").
    setTimeout(() => {
      void api
        .getWorld()
        .then((open) => {
          holdSort(story.id, false)
          if (open?.id !== worldId || app().world?.id !== worldId) return
          runFlow(story.id, 'when', () => api.sortStartChanges(story.id, book.storyId), book.title)
        })
        .catch(() => holdSort(story.id, false))
    }, 0)
  })
}

/**
 * Adam's "No" to "Should Book 2 now continue after it?": kept with the world, so story settings stops
 * asking, with Undo (`onUndo` shows the question again). Returns whether it was saved.
 */
export async function declineFollow(story: Pick<Story, 'id' | 'title'>, book: StoryRef, onUndo?: () => void): Promise<boolean> {
  try {
    await api.declineFollow(story.id)
  } catch (e) {
    failed(e)
    return false
  }
  toast(`${book.title} stays where it is.`, {
    action: {
      label: 'Undo',
      run: () =>
        void api
          .declineFollow(story.id, false)
          .then(() => {
            onUndo?.()
            // Story settings read the question afresh.
            return refresh()
          })
          .catch(failed)
    }
  })
  return true
}

/**
 * Opens the style guide on this story's own style (opening the story first, since the style guide
 * edits the open story's).
 */
export async function editStoryStyle(storyId: ID): Promise<void> {
  if (app().storyId !== storyId) await openStory(storyId).catch(failed)
  openStyleTab('story')
  app().navigate({ kind: 'style' })
}

// ---------- Changing what a story is ----------

/** The placement changes shown in one toast while it is up, so Undo puts back how the story was before all of them. */
let batch: { toastId: number; storyId: ID; before: StoryPlacement } | null = null

const liveBatch = (storyId: ID): typeof batch =>
  batch && batch.storyId === storyId && useToasts.getState().items.some((t) => t.id === batch!.toastId) ? batch : null

/**
 * Saves what a story is (the memory is worked out fresh) and offers Undo, which puts back `before`: what
 * it was as the memory had it. Returns the saved story, or the plain-words reason it couldn't be saved
 * (shown where the change was made, not in a toast).
 */
export async function savePlacement(
  story: Story,
  before: StoryPlacement,
  next: StoryPlacement,
  summary: string
): Promise<{ saved: Story; error?: undefined } | { saved?: undefined; error: string }> {
  let saved: Story
  try {
    saved = await api.setStoryPlacement(story.id, next)
  } catch (e) {
    return { error: reason(e) }
  }
  await refresh()
  const message = `${saved.title}: ${summary}.`
  const live = liveBatch(story.id)
  if (live) {
    useToasts.getState().update(live.toastId, { message })
    return { saved }
  }
  const mine = { toastId: 0, storyId: story.id, before }
  mine.toastId = toast(message, {
    action: {
      label: 'Undo',
      run: () => {
        if (batch === mine) batch = null
        putBack(story.id, mine.before)
      }
    }
  })
  batch = mine
  return { saved }
}

/** "End Ash after Ch 1" in story settings: a still-running side story ends before this one starts, so this one knows it. */
export async function endFirst(storyId: ID, endRefId: ID, chapter: string): Promise<void> {
  let was: StoryPlacement
  let ended: Story
  try {
    was = await api.getStoryPlacement(storyId)
    ended = await api.setStoryPlacement(storyId, { ...was, endAt: 'chapter', endRefId })
  } catch (e) {
    failed(e)
    return
  }
  await refresh()
  toast(`${ended.title} now ends after ${chapter}.`, { action: { label: 'Undo', run: () => putBack(storyId, was) } })
}

// ---------- Deleting a story ----------

/**
 * Deletes a story with Undo (and keeps it in Recently deleted for 30 days). Stories that start in it
 * take over its start point; a backup is made first when there are any. If it was open, the first other
 * story opens.
 */
export async function deleteStory(story: Pick<Story, 'id' | 'title'>, othersStartHere: boolean): Promise<void> {
  const wasOpen = app().storyId === story.id
  try {
    await editorBridge()?.flush()
    if (othersStartHere) await api.backupNow().catch(() => undefined)
    await api.deleteStory(story.id)
  } catch (e) {
    failed(e)
    return
  }
  // Its settings page is left before the story list changes, so it never says the story isn't there.
  const next = app().stories.find((s) => s.id !== story.id)
  if (wasOpen) {
    if (next) await openStory(next.id).catch(() => app().selectStory(next.id))
    else app().selectStory(null)
  } else app().navigate({ kind: 'write' })
  await refresh()
  announceDelete({
    message: `“${story.title || 'Untitled story'}” deleted.`,
    noun: ['story', 'stories'],
    undo: () =>
      api
        .restoreDeleted('story', story.id)
        .then(() => app().refreshStories())
        .catch((e: Error) => void toast(e.message, { tone: 'danger' }))
  })
}
