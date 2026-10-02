// What the story screens do: make a story and then ask what follows from it, change what a story is
// with Undo, answer "Should Book 2 now continue after it?", end a still-running side story first, and
// delete a story with Undo. Each updates the story list and leaves the screen in a sensible place.
import type { StoryPlacement } from '@shared/api'
import type { NewStoryInput, StoryRef } from '@shared/contracts/stories'
import type { ID, Story } from '@shared/types'
import { toast, useToasts } from '@/components/ui/Toast'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { announceDelete } from '@/lib/undoDelete'
import { requestEditorFocus } from '@/features/editor/focusRequest'
import { lastSceneOf } from '@/features/binder/lastScene'
import { runFlow } from './flows'
import { placementOf } from './storiesLogic'

const app = useApp.getState

const failed = (e: unknown): void => void toast((e as Error).message || 'That didn’t work. Please try again.', { tone: 'danger' })

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
 * Makes the story (with its first chapter and scene) and opens it, then, where it applies: fills in
 * what changed in its time gap, asks "Should Book 2 now continue after it?", and asks for a prequel's
 * cast. `onMade` runs as soon as it exists (the dialog closes then, so the new scene keeps the focus).
 * Returns false (having said why) when it couldn't be made.
 */
export async function createStory(input: NewStoryInput, onMade?: () => void): Promise<boolean> {
  let made: Awaited<ReturnType<typeof api.createStoryAs>>
  try {
    await editorBridge()?.flush()
    made = await api.createStoryAs(input)
  } catch (e) {
    failed(e)
    return false
  }
  const { story, sceneId } = made
  onMade?.()
  await app()
    .refreshStories()
    .catch(() => undefined)
  app().selectScene(sceneId, story.id)
  requestEditorFocus(sceneId)
  if (story.timeGap.trim()) runFlow(story.id, 'time-gap', () => api.fillTimeGap(story.id))
  const follow = made.mightFollow[0]
  if (follow) askToFollow(story, follow)
  if (story.kind === 'prequel') {
    toast(`${story.title} is a prequel. Choose who and what it starts with, and the AI drafts how each of them was back then.`, {
      action: { label: 'Choose cast', run: () => openStorySettings(story.id, 'cast') }
    })
  }
  return true
}

/** "Should Book 2 now continue after it?", as a question in a toast. Story settings asks it too, until answered. */
export function askToFollow(story: Pick<Story, 'id' | 'title'>, book: StoryRef): void {
  toast(`Should ${book.title} now continue after ${story.title}?`, {
    action: { label: 'Yes', run: () => void moveToFollow(story, book) }
  })
}

/**
 * Adam's yes: the book now continues after the new story, and the start-of-story changes of the book
 * are sorted into before, during and after it. Undo puts the book back where it was.
 */
export async function moveToFollow(story: Pick<Story, 'id' | 'title'>, book: StoryRef): Promise<void> {
  const before = app().stories.find((s) => s.id === book.storyId)
  if (!before) return
  const was = placementOf(before)
  try {
    await api.setStoryPlacement(book.storyId, { ...was, kind: 'continues', startStoryId: story.id, startAt: 'end', startRefId: null, endAt: null, endRefId: null })
  } catch (e) {
    failed(e)
    return
  }
  dismissFollowQuestion(story.id)
  await app()
    .refreshStories()
    .catch(() => undefined)
  runFlow(story.id, 'when', () => api.sortStartChanges(story.id, book.storyId))
  toast(`${book.title} now continues after ${story.title}.`, {
    action: {
      label: 'Undo',
      run: () =>
        void api
          .setStoryPlacement(book.storyId, was)
          .then(() => app().refreshStories())
          .catch(failed)
    }
  })
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

// ---------- "No" to the question, remembered on this computer ----------

const NO_KEY = 'aiwrite.stories.followAnswered'

function answered(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(NO_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Adam answered "Should Book 2 now continue after it?" for this story, so story settings stops asking. */
export function dismissFollowQuestion(storyId: ID): void {
  try {
    const list = answered().filter((x) => x !== storyId)
    localStorage.setItem(NO_KEY, JSON.stringify([...list, storyId].slice(-200)))
  } catch {
    // Asked again next time; nothing else to do.
  }
}

export const followQuestionAnswered = (storyId: ID): boolean => answered().includes(storyId)

// ---------- Changing what a story is ----------

/** The placement changes shown in one toast while it is up, so Undo puts back how the story was before all of them. */
let batch: { toastId: number; storyId: ID; before: StoryPlacement } | null = null

const liveBatch = (storyId: ID): typeof batch =>
  batch && batch.storyId === storyId && useToasts.getState().items.some((t) => t.id === batch!.toastId) ? batch : null

/** Saves what a story is (the memory is worked out fresh) and offers Undo. Returns the saved story, or null when refused. */
export async function savePlacement(story: Story, next: StoryPlacement, summary: string): Promise<Story | null> {
  const before = placementOf(story)
  let saved: Story
  try {
    saved = await api.setStoryPlacement(story.id, next)
  } catch (e) {
    failed(e)
    return null
  }
  await app()
    .refreshStories()
    .catch(() => undefined)
  const message = `${saved.title}: ${summary}.`
  const live = liveBatch(story.id)
  if (live) {
    useToasts.getState().update(live.toastId, { message })
    return saved
  }
  const mine = { toastId: 0, storyId: story.id, before }
  mine.toastId = toast(message, {
    action: {
      label: 'Undo',
      run: () => {
        if (batch === mine) batch = null
        void api
          .setStoryPlacement(story.id, mine.before)
          .then(() => app().refreshStories())
          .catch(failed)
      }
    }
  })
  batch = mine
  return saved
}

/** "End Ash after Ch 1": a still-running side story ends before this one starts, so this one knows it. */
export async function endFirst(storyId: ID, endRefId: ID, label: string): Promise<void> {
  const story = app().stories.find((s) => s.id === storyId)
  if (!story) return
  const was = placementOf(story)
  try {
    await api.setStoryPlacement(storyId, { ...was, endAt: 'chapter', endRefId })
  } catch (e) {
    failed(e)
    return
  }
  await app()
    .refreshStories()
    .catch(() => undefined)
  // "End Ash after Ch 1" → "Ash now ends after Ch 1."
  toast(`${label.replace(/^End (.*) after (Ch \d+)$/, '$1 now ends after $2')}.`, {
    action: {
      label: 'Undo',
      run: () =>
        void api
          .setStoryPlacement(storyId, was)
          .then(() => app().refreshStories())
          .catch(failed)
    }
  })
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
  await app()
    .refreshStories()
    .catch(() => undefined)
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
