// What the story screens do: make a story and then ask what follows from it, change what a story is
// with Undo, answer "Should Book 2 now continue after it?", end a still-running side story first, and
// delete a story with Undo. Each updates the story list and leaves the screen in a sensible place.
// Undo always puts back what a story was as the memory had it (getStoryPlacement): a start or end at
// something deleted has moved, and the stored one would be refused.
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

/** Story settings opens at a section once (after "Choose cast" in a toast). */
let pendingSection: string | null = null
export const takePendingSection = (): string | null => {
  const s = pendingSection
  pendingSection = null
  return s
}

/** Opens a story's settings, at a section if given. */
export function openStorySettings(storyId: ID, section?: string): void {
  pendingSection = section ?? null
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
  await refresh()
  let undone = false
  const shown = toast(`${book.title} now continues after ${story.title}.`, {
    action: {
      label: 'Undo',
      run: () => {
        undone = true
        putBack(book.storyId, was)
      }
    }
  })
  afterToast(shown, () => {
    if (undone || app().world?.id !== worldId) return
    runFlow(story.id, 'when', () => api.sortStartChanges(story.id, book.storyId), book.title)
  })
}

/** Adam's "No" to "Should Book 2 now continue after it?": kept with the world, so story settings stops asking. */
export async function declineFollow(storyId: ID): Promise<boolean> {
  try {
    await api.declineFollow(storyId)
    return true
  } catch (e) {
    failed(e)
    return false
  }
}

/**
 * Opens the style guide on this story's own style (opening the story first, since the style guide
 * edits the open story's).
 */
export async function editStoryStyle(storyId: ID): Promise<void> {
  if (app().storyId !== storyId) await openStory(storyId).catch(failed)
  app().navigate({ kind: 'style' })
  // The style guide remembers its last tab and has no way to be opened on one yet (see the report's
  // "Needs from integration"); its tabs switch when focused, so focusing "This story" opens it.
  let frames = 0
  const focusTab = (): void => {
    const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.trim() === 'This story')
    if (tab) tab.focus()
    // The page may still be loading Adam's preferences for a frame or two.
    else if (++frames < 30 && app().view.kind === 'style') requestAnimationFrame(focusTab)
  }
  requestAnimationFrame(focusTab)
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
  await refresh()
  const next = app().stories[0]
  if (wasOpen) {
    if (next) await openStory(next.id).catch(() => app().selectStory(next.id))
    else app().selectStory(null)
  } else app().navigate({ kind: 'write' })
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
