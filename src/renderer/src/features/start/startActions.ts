// What the start screen does: Continue, opening a world or a story where Adam last was, renaming worlds and
// stories in place (open or not), their settings pages, deleting a story (the usual flow) or a whole world (with
// Undo and Recently deleted), and starting a new story in a chosen world. Each ends in the right place: the
// workspace for what opens something, the start screen for what changes the list.
//
// Anything that opens, closes or changes a world runs `exclusive`ly: while one runs (a slow story delete in
// another world, say), the start screen's other such controls rest, so nothing switches worlds under it.

import type { ID } from '@shared/types'
import type { DeletedWorld, LastPlace, LibraryStory, LibraryWorld } from '@shared/contracts/library'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { flushBeforeWorldChange } from '@/lib/flush'
import { keepHome, useApp } from '@/lib/store'
import { openStyleTab } from '@/features/style/StyleView'
import { deleteStory, openStory } from '@/features/stories/storyActions'
import { requestEditorFocus } from '@/features/editor/focusRequest'
import { focusBeforeHome } from './home'
import { dropWorld, exclusive, loadLibrary, patchStory, patchWorld, useLibrary } from './libraryStore'

const app = useApp.getState

const failed = (e: unknown): void => void toast((e as Error)?.message || 'That didn’t work. Please try again.', { tone: 'danger' })

/** Opens a world underneath the start screen (saving the open one first, and stopping a draft in it), if it isn't open. */
async function openBehind(worldId: ID): Promise<void> {
  if (app().world?.id === worldId) return
  await flushBeforeWorldChange()
  await keepHome(() => app().openWorld(worldId))
}

/**
 * Picking something on the start screen lands on the story's home (the book page) in the desk look, not on the
 * writing page. The classic look has no story home, so it keeps the writing page.
 */
function landOnStoryHome(): void {
  const { storyId } = app()
  const root = document.documentElement
  if (!storyId || root.dataset.arrangement !== 'desk' || root.dataset.look !== 'new') return
  app().navigate({ kind: 'storyHome', storyId })
}

/**
 * Once the start screen has gone: the caret back in the page on the writing page, else the keyboard back where it
 * was before the start screen showed (if that is still there).
 */
function keyboardBack(): void {
  requestAnimationFrame(() => {
    const { home, view, sceneId } = app()
    if (home) return
    if (view.kind === 'write' && sceneId) requestEditorFocus(sceneId)
    else focusBeforeHome()
  })
}

/** Continue: straight back where Adam left off. The open world just shows again; another opens at its last story and scene. */
export function continueWriting(last: Pick<LastPlace, 'worldId'>): Promise<void> {
  if (app().world?.id === last.worldId) {
    if (useLibrary.getState().busy) return Promise.resolve()
    app().leaveHome()
    landOnStoryHome()
    keyboardBack()
    return Promise.resolve()
  }
  return exclusive(async () => {
    try {
      await flushBeforeWorldChange()
      await app().openWorld(last.worldId)
      landOnStoryHome()
      keyboardBack()
    } catch (e) {
      failed(e)
    }
  })
}

/** Opens a world at the story and scene Adam was last in there (the open one just shows again). */
export function openWorldFromStart(worldId: ID): Promise<void> {
  return continueWriting({ worldId })
}

/** Opens a story where Adam last was in it, opening its world first if needed. */
export function openStoryFromStart(worldId: ID, storyId: ID): Promise<void> {
  return exclusive(async () => {
    try {
      await openBehind(worldId)
      await openStory(storyId)
      app().leaveHome()
      landOnStoryHome()
      keyboardBack()
    } catch (e) {
      failed(e)
    }
  })
}

/** Renames a world (open or not) without opening it. */
export async function renameWorldFromStart(w: Pick<LibraryWorld, 'id' | 'name'>, name: string): Promise<void> {
  const clean = name.trim()
  if (!clean || clean === w.name) return
  patchWorld(w.id, { name: clean })
  try {
    await api.renameWorldIn(w.id, clean)
    if (app().world?.id === w.id) await app().refreshWorld()
  } catch (e) {
    failed(e)
  } finally {
    void loadLibrary()
  }
}

/** Renames a story in any world, without opening it. */
export async function renameStoryFromStart(worldId: ID, s: Pick<LibraryStory, 'id' | 'title'>, title: string): Promise<void> {
  const clean = title.trim()
  if (!clean || clean === s.title) return
  patchStory(worldId, s.id, { title: clean })
  try {
    await api.renameStoryIn(worldId, s.id, clean)
    if (app().world?.id === worldId) {
      await app().refreshStories()
      app().bumpOutline()
    }
  } catch (e) {
    failed(e)
  } finally {
    void loadLibrary()
  }
}

/** A world's Details: its style guide, on the world's tab. */
export function worldDetails(worldId: ID): Promise<void> {
  return exclusive(async () => {
    try {
      await openBehind(worldId)
      openStyleTab('world')
      app().navigate({ kind: 'style' })
    } catch (e) {
      failed(e)
    }
  })
}

/** A story's Details: its settings page. */
export function storyDetails(worldId: ID, storyId: ID): Promise<void> {
  return exclusive(async () => {
    try {
      await openBehind(worldId)
      app().navigate({ kind: 'story', storyId })
    } catch (e) {
      failed(e)
    }
  })
}

/** New story in a chosen world: the world opens behind the start screen, then the New story dialog shows. */
export function newStoryIn(worldId: ID): Promise<void> {
  return exclusive(async () => {
    try {
      await openBehind(worldId)
      app().setNewStoryOpen(true)
    } catch (e) {
      failed(e)
    }
  })
}

/**
 * Deletes a story as story settings does (Recently deleted for 30 days, with Undo; a backup first when other
 * stories start in it). Its world opens behind the start screen first if it isn't open; the start screen stays,
 * and Undo brings the story back onto its list.
 */
export function deleteStoryFromStart(worldId: ID, s: Pick<LibraryStory, 'id' | 'title'>): Promise<void> {
  return exclusive(async () => {
    try {
      await openBehind(worldId)
      const othersStartHere = await api
        .getStoryDetails(s.id)
        .then((d) => d.startingHere.length > 0)
        // Not known: a backup costs little, so make one.
        .catch(() => true)
      await keepHome(() => deleteStory(s, othersStartHere, { afterUndo: () => void loadLibrary() }))
    } catch (e) {
      failed(e)
    } finally {
      void loadLibrary()
    }
  })
}

/**
 * Deletes a whole world into Recently deleted (after Adam confirmed). The open world is saved first, with any
 * draft in it stopped (its words kept), and then nothing is open. Undo is offered at once. True once deleted.
 */
export async function deleteWorldFromStart(w: Pick<LibraryWorld, 'id' | 'name'>): Promise<boolean> {
  let done = false
  await exclusive(async () => {
    done = await deleteWorldNow(w)
  })
  return done
}

async function deleteWorldNow(w: Pick<LibraryWorld, 'id' | 'name'>): Promise<boolean> {
  const wasOpen = app().world?.id === w.id
  let gone: DeletedWorld
  try {
    if (wasOpen) await flushBeforeWorldChange()
    gone = await api.deleteWorld(w.id)
  } catch (e) {
    failed(e)
    return false
  }
  if (wasOpen) app().closeWorld()
  // Gone from the list and from Continue at once, before the library is read again.
  dropWorld(w.id, gone)
  void loadLibrary()
  toast(`“${w.name}” deleted. It’s in Recently deleted for 30 days.`, {
    action: { label: 'Undo', run: () => void restoreWorldFromStart(gone, { reopen: wasOpen, quiet: true }) }
  })
  return true
}

/**
 * Brings a world back from Recently deleted. `reopen` (an Undo of deleting the open world): it opens again, behind
 * the start screen while that shows, unless Adam has opened another world meanwhile.
 */
export function restoreWorldFromStart(d: Pick<DeletedWorld, 'trashId' | 'name'>, opts: { reopen?: boolean; quiet?: boolean } = {}): Promise<void> {
  return exclusive(async () => {
    try {
      const back = await api.restoreWorld(d.trashId)
      if (opts.reopen && !app().world) {
        if (app().home) await keepHome(() => app().openWorld(back.id))
        else await app().openWorld(back.id)
      }
      void loadLibrary()
      if (!opts.quiet) {
        toast(`“${back.name}” is back.`, { tone: 'success', action: { label: 'Open', run: () => void openWorldFromStart(back.id) } })
      }
    } catch (e) {
      failed(e)
      void loadLibrary()
    }
  })
}

/** "Empty now": every deleted world goes for good (after Adam confirmed). */
export function emptyDeletedWorlds(count: number): Promise<void> {
  return exclusive(async () => {
    try {
      await api.emptyDeletedWorlds()
      toast(count === 1 ? 'The deleted world is gone for good.' : `The ${count} deleted worlds are gone for good.`)
    } catch (e) {
      failed(e)
    } finally {
      void loadLibrary()
    }
  })
}
