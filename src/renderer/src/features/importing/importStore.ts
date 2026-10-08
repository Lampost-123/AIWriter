// What the import page holds between visits (milestone 6): the manuscript read from its file, the proposed
// split and Adam's changes to it, the story's title, and how the last import went; plus the import catch-up
// as the main process reports it (which stories have unread scenes, one being read, how it ended), followed
// from the start whichever page is showing. Owned by the Manuscript import part.

import { create } from 'zustand'
import type { CatchUpState, ImportResult, Manuscript } from '@shared/contracts/importing'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { flushBeforeWorldChange } from '@/lib/flush'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { buildOutline, countsText, noEdits, proposeRoles, toPlan, type Role, type SplitEdits } from './split'

export interface ImportSession {
  /**
   * What the page shows: picking a file and the split ('file'), the import just made with the offer to build
   * the memory from it ('done'), or that offer alone for a story chosen from its menu or the palette ('memory').
   */
  page: 'file' | 'done' | 'memory'
  /** The file is being read (after Adam picked it). */
  reading: boolean
  manuscript: Manuscript | null
  proposed: Record<number, Role>
  edits: SplitEdits
  title: string
  importing: boolean
  /** The last import, while its story is still there. */
  result: (ImportResult & { title: string }) | null
  /** The story the 'memory' page is for. */
  memoryStoryId: ID | null
  /** Plain words when the file couldn't be read or imported. */
  problem: string | null
  /** The import catch-up in the open world, as last reported. */
  catchUp: CatchUpState
  /**
   * Started from the start screen: the import makes a new world named after the book even while another world is
   * open (behind the start screen), as it does with no world open.
   */
  forNewWorld: boolean
}

const NO_CATCH_UP: CatchUpState = { running: null, unread: {}, finished: null }

export const useImport = create<ImportSession>(() => ({
  page: 'file',
  reading: false,
  manuscript: null,
  proposed: {},
  edits: noEdits(),
  title: '',
  importing: false,
  result: null,
  memoryStoryId: null,
  problem: null,
  catchUp: NO_CATCH_UP,
  forNewWorld: false
}))

const get = useImport.getState
const set = useImport.setState
const app = useApp.getState

// ---------- Following the catch-up ----------

let seenFinish: string | null = null

/** "The memory has read “The Ferry”." when a catch-up ends (once, and only for one that ran while the app was open). */
function sayFinished(s: CatchUpState): void {
  const f = s.finished
  if (!f || f.at === seenFinish) return
  const first = seenFinish === null
  seenFinish = f.at
  if (first && Date.now() - Date.parse(f.at) > 10_000) return
  const missed = f.missed
    ? ` ${f.missed === 1 ? 'One scene' : `${f.missed} scenes`} couldn’t be read yet; the memory will try again by itself.`
    : ''
  toast(`The memory has read “${f.storyTitle}”.${missed}`, {
    tone: 'success',
    secondary: { label: 'What changed', run: () => app().navigate({ kind: 'memory', sceneId: null }) }
  })
}

function took(s: CatchUpState): void {
  sayFinished(s)
  set({ catchUp: s })
}

/** Reads the catch-up afresh (the world changed, or the memory moved on, which can change what is unread). */
export async function refreshCatchUp(): Promise<void> {
  const worldId = app().world?.id ?? null
  if (!worldId) {
    set({ catchUp: NO_CATCH_UP })
    return
  }
  try {
    const s = await api.getCatchUp()
    if (app().world?.id === worldId) took(s)
  } catch {
    // What shows stays as it was.
  }
}

let listening = false
let refreshTimer: ReturnType<typeof setTimeout> | null = null

/** Follows the catch-up for as long as the window is open. Called once the app has started. */
export function listenForCatchUp(): void {
  if (listening) return
  listening = true
  onEvent('importing:catchUp', (s) => took(s))
  // The memory read or saved something: an imported scene edited by hand is no longer unread.
  onEvent('memory:status', () => {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void refreshCatchUp(), 800)
  })
  let worldId = app().world?.id ?? null
  useApp.subscribe((s) => {
    const now = s.world?.id ?? null
    if (now === worldId) return
    worldId = now
    seenFinish = null
    // The last import and the memory page were in the world before.
    set({ catchUp: NO_CATCH_UP, result: null, page: 'file', memoryStoryId: null })
    void refreshCatchUp()
  })
  void refreshCatchUp()
}

// ---------- Ways in ----------

/** "Import a manuscript…" (the story menu, the palette): the import page, asking for the file straight away. */
export function startImport(forNewWorld = false): void {
  listenForCatchUp()
  set({ page: 'file', problem: null, forNewWorld })
  app().navigate({ kind: 'import' })
  void chooseFile()
}

/**
 * For the start screen and the first run: the same, and importing then makes a world named after the book (the
 * story's title), with the book as its first story, whether or not a world is open behind the start screen.
 */
export function importManuscriptFromWelcome(): void {
  startImport(true)
}

/** "Build the memory from this story" (the story menu, the palette): the page with what it would cost, and one button. */
export function offerMemory(storyId: ID): void {
  listenForCatchUp()
  set({ page: 'memory', memoryStoryId: storyId, forNewWorld: false })
  app().navigate({ kind: 'import' })
}

/** Asks for the file and reads it (or reads one dropped on the page, by its path). Cancelling leaves the page as it was. */
export async function chooseFile(dropped?: string): Promise<void> {
  if (get().reading) return
  set({ reading: true, problem: null })
  try {
    const m = dropped ? await api.readDroppedManuscript(dropped) : await api.chooseManuscript()
    if (!m) {
      set({ reading: false })
      return
    }
    set({ reading: false, manuscript: m, proposed: proposeRoles(m.blocks), edits: noEdits(), title: m.title, page: 'file' })
  } catch (e) {
    set({ reading: false, problem: plainReason(e) })
  }
}

export const setEdits = (edits: SplitEdits): void => set({ edits })
export const setStoryTitle = (title: string): void => set({ title })

/** Back to the split as it was proposed. */
export const resetSplit = (): void => set({ edits: noEdits() })

// ---------- Importing ----------

/** The world an import from the start screen made for the book, until the import into it works. */
let madeForBook: ID | null = null

/**
 * Imports the split into the open world (or, from the start screen, a new world named after the book) as a
 * new story, in one go. The page then offers to build the memory from it; a toast offers Undo.
 */
export async function importNow(): Promise<void> {
  const s = get()
  if (!s.manuscript || s.importing) return
  set({ importing: true, problem: null })
  const title = s.title.trim() || s.manuscript.title
  const outline = buildOutline(s.manuscript, s.proposed, s.edits)
  let result: ImportResult
  // A world made for the book by an import that then failed is still the book's: trying again replaces its empty first story too.
  let newWorld = !!madeForBook && app().world?.id === madeForBook
  try {
    if (!app().world || (s.forNewWorld && !newWorld)) {
      // A world open behind the start screen is saved (and any draft in it stopped) before the new one opens.
      if (app().world) await flushBeforeWorldChange()
      await app().createWorld(title)
      newWorld = true
      madeForBook = app().world?.id ?? null
      // Making the world opens its writing page: this page stays in view instead.
      app().navigate({ kind: 'import' })
    }
    await editorBridge()?.flush()
    result = await api.importManuscript(toPlan(s.manuscript, outline, title, newWorld))
    madeForBook = null
    // The book's world is the open one now: importing again (after Undo) goes into it.
    set({ forNewWorld: false })
  } catch (e) {
    set({ importing: false, problem: plainReason(e) })
    if (newWorld) app().navigate({ kind: 'import' })
    return
  }
  await app().refreshStories()
  // The story opens behind this page (the binder shows its chapters), and the page offers the memory.
  useApp.setState({ storyId: result.storyId, sceneId: result.sceneId })
  void api.updateSettings({ lastStoryId: result.storyId, lastSceneId: result.sceneId }).catch(() => undefined)
  app().bumpOutline()
  set({ importing: false, result: { ...result, title }, page: 'done', memoryStoryId: result.storyId })
  app().navigate({ kind: 'import' })
  void refreshCatchUp()
  const worldId = app().world?.id
  toast(`Imported “${title}”: ${countsText(result.acts, result.chapters, result.scenes)}.`, {
    action: { label: 'Undo', run: () => void undoImport(result.storyId, title, worldId) }
  })
}

/** Undo: the whole import goes (its story, with everything in it), and the split is back to change and import again. */
export async function undoImport(storyId: ID, title: string, worldId: ID | undefined): Promise<void> {
  if (app().world?.id !== worldId) return
  const wasOpen = app().storyId === storyId
  try {
    if (get().catchUp.running?.storyId === storyId) await api.stopCatchUp()
    if (wasOpen) await editorBridge()?.stopDraft('deleted')
    await editorBridge()?.flush()
    await api.deleteStory(storyId)
  } catch (e) {
    toast(plainReason(e), { tone: 'danger' })
    return
  }
  await app().refreshStories()
  if (wasOpen) {
    const next = app().stories[0]
    if (next) {
      const { scenes } = await api.getOutline(next.id).catch(() => ({ scenes: [] as { id: ID }[] }))
      useApp.setState({ storyId: next.id, sceneId: scenes[0]?.id ?? null })
    } else useApp.setState({ storyId: null, sceneId: null })
  }
  app().bumpOutline()
  if (get().result?.storyId === storyId) set({ result: null, page: 'file', memoryStoryId: null })
  void refreshCatchUp()
  toast(`“${title}” was taken out again. Change the split and import it once more, or leave it.`)
}

// ---------- The catch-up ----------

/** Starts building the memory from a story's unread scenes (or carries on after a pause). */
export async function buildMemory(storyId: ID): Promise<boolean> {
  try {
    await api.startCatchUp(storyId)
    await refreshCatchUp()
    return true
  } catch (e) {
    toast(plainReason(e), { tone: 'danger' })
    return false
  }
}

export async function stopBuildingMemory(): Promise<void> {
  try {
    await api.stopCatchUp()
  } catch (e) {
    toast(plainReason(e), { tone: 'danger' })
  }
  await refreshCatchUp()
}

/** Goes to the story the import made, on its first scene. */
export async function openImported(storyId: ID): Promise<void> {
  await editorBridge()?.flush()
  const { scenes } = await api.getOutline(storyId)
  app().selectScene(scenes[0]?.id ?? null, storyId)
}

/** True when this story has scenes the memory hasn't read since they were imported, and isn't being read now. */
export const canBuildMemory = (s: CatchUpState, storyId: ID | null): boolean =>
  !!storyId && (s.unread[storyId] ?? 0) > 0 && s.running?.storyId !== storyId
