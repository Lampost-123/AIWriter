import { create } from 'zustand'
import type { DeepPartial, EntryKind, ID, MemoryStatus, Settings, Story, World } from '@shared/types'
import type { BuilderKind, BuilderStart } from '@shared/contracts/builder'
import { useToasts } from '@/components/ui/Toast'
import { lastSceneOf } from '@/features/binder/lastScene'
import { patchDraftOptions, type SceneDraftOptions } from '@/features/generate/draftOptions'
import { pageTransition } from '@/features/look/viewTransition'
import { areaOf } from '@/layout/areas'
import { api } from './api'

export type SettingsTab = 'models' | 'preferences' | 'appearance' | 'speech' | 'editor' | 'backups' | 'trash' | 'usage' | 'about'

/** What fills the centre of the window. The binder stays on the left throughout. */
export type View =
  | { kind: 'write' }
  /** `from`: opened from a draft's "What the AI saw", so the page offers the way back. */
  | { kind: 'entries'; entryKind: EntryKind; entryId: ID | null; from?: { generationId: ID } }
  | { kind: 'style' }
  | { kind: 'settings'; tab: SettingsTab }
  /** `back`: opened from somewhere other than the scene a draft was for (the outline helper, say). */
  | { kind: 'generation'; generationId: ID; back?: RecordBack }
  /** The "What changed" list: what the memory keeper did, for the whole world or (sceneId) one scene. */
  | { kind: 'memory'; sceneId: ID | null }
  // ----- Milestone 3 -----
  /** The codex: cards for every entry, grouped by kind. */
  | { kind: 'codex' }
  /** The character builder (or a lighter builder): a new entry (entryId null) or an existing one. */
  | { kind: 'builder'; entryKind: BuilderKind; entryId: ID | null; start?: BuilderStart }
  | { kind: 'timeline' }
  /** The relationship map. */
  | { kind: 'map' }
  /** The plot threads board. */
  | { kind: 'threads' }
  /** A story's settings: what it is, where it starts, its time gap, the style the AI gets for it. */
  | { kind: 'story'; storyId: ID }
  // ----- Milestone 4 -----
  /** A scene's history: its snapshots, each compared side by side with the scene now, and restored in one click. */
  | { kind: 'history'; sceneId: ID; snapshotId?: ID | null }
  /** Variants: 2 or 3 drafts of a scene side by side, to pick one or take paragraphs from each. */
  | { kind: 'variants'; sceneId: ID }
  /**
   * The outline helper: acts, chapters and scene cards suggested from a premise. With `chapterId`, one
   * chapter planned from its interview (its goal and scene cards).
   */
  | { kind: 'outline'; storyId: ID; chapterId?: ID }
  /** Build the world from a summary (the World builder): lays out everything a summary names, and lists what it made. */
  | { kind: 'worldBuilder' }
  // ----- Milestone 5 -----
  /** A story's consistency: its issues by chapter and scene, checking a chapter or the story, and the reports. */
  | { kind: 'consistency'; storyId: ID }
  // Milestone 6: importing a manuscript (the split preview, then the import catch-up's progress)
  | { kind: 'import' }
  // Story recipes: the recipe library ('list'), making one from a story ('make'), one recipe ('recipe')
  | { kind: 'recipes'; page?: 'list' | 'make' | 'recipe'; recipeId?: ID | null }
  /** A new story from a recipe: its premise, chapters and scene cards suggested, to keep, edit or discard. */
  | { kind: 'recipePlan'; storyId: ID; recipeId: ID }

/**
 * "What the AI saw" opened from another page (milestone 4): the page to go back to, the Back button's words
 * ("Back to the outline helper", "Back to History"), and, for an AI call that isn't a scene's draft, what the
 * record is of ("this outline").
 */
export interface RecordBack {
  view: View
  label: string
  what?: string
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface AppState {
  ready: boolean
  settings: Settings | null
  world: World | null
  stories: Story[]
  storyId: ID | null
  sceneId: ID | null
  view: View
  /** The editor's save state, shown in the top bar. */
  saveState: SaveState
  /** Word count of the open scene, shown in the top bar. */
  sceneWords: number
  /** Bumped whenever chapters or scenes change, so the binder reloads. */
  outlineRev: number
  /** Bumped whenever world bible entries change, so lists and pickers reload. */
  entriesRev: number
  /** The draft currently streaming, if any. */
  activeGeneration: { id: ID; sceneId: ID } | null
  /** The scene panel's open tab, kept while moving between pages. */
  inspectorTab: InspectorTab
  /** A backup is being restored: the workspace takes no input until the world has reloaded. */
  restoring: boolean
  /** Each scene's draft options (direction, length, creativity), kept while the app is open. Generate and the Context tab share them. */
  draftOptions: Record<ID, SceneDraftOptions>
  /** What the memory keeper is doing, shown quietly in the top bar. Null until known. */
  memoryStatus: MemoryStatus | null
  /** Bumped whenever the memory changes (the memory keeper, an undo), so summaries, the scene's changes and the Context tab reload. */
  memoryRev: number
  /** Bumped whenever something the open scene's briefing is built from changes (its card, pins, block choices, summaries). */
  briefingRev: number
  /** The entry shown in the scene panel beside the page (a name clicked in the scene), if any. */
  peekEntryId: ID | null
  /** The New story dialog is open. */
  newStoryOpen: boolean
  /** Ask the world (milestone 4) shows in the right-hand panel beside the page, in place of the scene panel's tabs. */
  askOpen: boolean
  /**
   * The start screen is showing (features/start/). It shows over the workspace, which stays as it was underneath (a
   * draft keeps writing). Opening a world or a page leaves it; with no world open it always shows (but for Settings
   * and the manuscript import, which can be open without a world).
   */
  home: boolean

  /**
   * Loads settings and the open world. The first time (at launch) it also asks whether the start screen shows:
   * `startScreen: false` (a first-run setup is showing) skips that, and the start screen then shows only with no world.
   */
  init(opts?: { startScreen?: boolean }): Promise<void>
  updateSettings(patch: DeepPartial<Settings>): Promise<void>
  createWorld(name: string): Promise<void>
  openWorld(id: ID): Promise<void>
  /** After a failed switch: make the screen match the world that is really open. */
  resync(): Promise<void>
  refreshWorld(): Promise<void>
  refreshStories(): Promise<void>
  selectStory(id: ID | null): void
  selectScene(id: ID | null, storyId?: ID): void
  navigate(view: View): void
  setSaveState(s: SaveState): void
  setSceneWords(n: number): void
  bumpOutline(): void
  bumpEntries(): void
  setActiveGeneration(g: { id: ID; sceneId: ID } | null): void
  setInspectorTab(tab: InspectorTab): void
  setDraftOptions(sceneId: ID, patch: Partial<SceneDraftOptions>): void
  setMemoryStatus(status: MemoryStatus | null): void
  bumpMemory(): void
  bumpBriefing(): void
  /** Shows an entry in the scene panel without leaving the scene (opens the panel); null closes it. */
  peekEntry(id: ID | null): void
  setNewStoryOpen(open: boolean): void
  /** Opens Ask the world beside the page (opening the panel), or closes it. */
  setAskOpen(open: boolean): void
  /** Shows the start screen over the workspace (the Home button, the world menu, the palette). */
  goHome(): void
  /** Closes the start screen, back to the workspace as it was. */
  leaveHome(): void
  /** The open world has gone (deleted from the start screen): nothing of it is left on screen, and the start screen shows. */
  closeWorld(): void
}

/** 'sounds': the Sounds tab, shown while sound effects are on (features/sounds/SoundsPanel.tsx). */
export type InspectorTab = 'card' | 'context' | 'drafts' | 'cast' | 'issues' | 'sounds'

/**
 * Opens the story and scene Adam was last in. The last place anywhere (lastStoryId, lastSceneId)
 * wins when it is in this world; otherwise where he was the last time he had this world open.
 */
async function loadWorldState(world: World, settings: Settings): Promise<Partial<AppState>> {
  const stories = await api.listStories()
  const place = settings.lastPlaces?.[world.id]
  const story =
    stories.find((s) => s.id === settings.lastStoryId) ?? stories.find((s) => s.id === place?.storyId) ?? stories[0] ?? null
  let sceneId: ID | null = null
  if (story) {
    const { scenes } = await api.getOutline(story.id)
    const find = (id: ID | null | undefined): ID | undefined => (id ? scenes.find((s) => s.id === id)?.id : undefined)
    sceneId = find(settings.lastSceneId) ?? find(place?.sceneId) ?? find(lastSceneOf(story.id)) ?? scenes[0]?.id ?? null
  }
  // The new world's scene shows its own count once loaded; never the old scene's meanwhile.
  return { world, stories, storyId: story?.id ?? null, sceneId, view: { kind: 'write' }, outlineRev: 0, sceneWords: 0, saveState: 'idle', peekEntryId: null }
}

/** Nothing of a world left on screen: the start screen shows instead. */
const NO_WORLD: Partial<AppState> = {
  world: null,
  stories: [],
  storyId: null,
  sceneId: null,
  view: { kind: 'write' },
  outlineRev: 0,
  sceneWords: 0,
  saveState: 'idle',
  activeGeneration: null,
  memoryStatus: null,
  peekEntryId: null,
  newStoryOpen: false,
  askOpen: false
}

/** The settings patch remembering where Adam is in this world. */
const placeIn = (world: World | null, storyId: ID | null, sceneId: ID | null): DeepPartial<Settings> =>
  world ? { lastPlaces: { [world.id]: { storyId, sceneId } } } : {}

/** Undo toasts act on the open world, so they must never outlive it. */
const dropUndoToasts = (): void => useToasts.getState().clearActions()

/** While above 0, opening a world, a story or a page leaves the start screen up (see keepHome). */
let homeHolds = 0
/** The start screen was asked about once, at launch (a later init, after a failed switch, keeps it as it is). */
let askedAtLaunch = false

/** The patch that closes the start screen, unless something on it is opening a world it stays up for. */
const leaveHomePatch = (): Partial<AppState> => (homeHolds > 0 ? {} : { home: false })

/**
 * The page a view shows: another entry of the same kind, another chapter's plan or another Settings page is still the
 * same page (it changes in place, at once).
 */
const pageKey = (v: View): string =>
  v.kind === 'entries' || v.kind === 'builder' ? `${v.kind}:${v.entryKind}` : v.kind === 'outline' ? `outline:${v.chapterId ? 'chapter' : 'helper'}` : v.kind

/** Counts calls to navigate, so a page change still waiting for its crossfade gives way to a later one. */
let navTurn = 0

/**
 * Runs something from the start screen that opens a world, story or page underneath it (to delete a story in
 * another world, say) while the start screen stays up.
 */
export async function keepHome<T>(run: () => Promise<T>): Promise<T> {
  homeHolds++
  try {
    return await run()
  } finally {
    homeHolds--
  }
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  settings: null,
  world: null,
  stories: [],
  storyId: null,
  sceneId: null,
  view: { kind: 'write' },
  saveState: 'idle',
  sceneWords: 0,
  outlineRev: 0,
  entriesRev: 0,
  activeGeneration: null,
  inspectorTab: 'card',
  restoring: false,
  draftOptions: {},
  memoryStatus: null,
  memoryRev: 0,
  briefingRev: 0,
  peekEntryId: null,
  newStoryOpen: false,
  askOpen: false,
  home: false,

  async init(opts) {
    // Asked once per launch, alongside the settings (it never holds up the window).
    const ask = !askedAtLaunch && opts?.startScreen !== false
    askedAtLaunch = true
    const [settings, world, atLaunch] = await Promise.all([
      api.getSettings(),
      api.getWorld(),
      ask ? api.startScreenAtLaunch().catch(() => false) : Promise.resolve(null)
    ])
    const extra = world ? await loadWorldState(world, settings) : NO_WORLD
    const home = !world || (atLaunch ?? (get().ready ? get().home : false))
    set({ settings, ...extra, home, ready: true })
  },

  async updateSettings(patch) {
    const settings = await api.updateSettings(patch)
    set({ settings })
  },

  async createWorld(name) {
    dropUndoToasts()
    try {
      const world = await api.createWorld(name)
      const settings = await api.getSettings()
      set({ settings, ...(await loadWorldState(world, settings)), ...leaveHomePatch() })
    } catch (e) {
      await get().resync()
      throw e
    }
  },

  async openWorld(id) {
    dropUndoToasts()
    try {
      const world = await api.openWorld(id)
      const settings = await api.getSettings()
      set({ settings, ...(await loadWorldState(world, settings)), ...leaveHomePatch() })
    } catch (e) {
      await get().resync()
      throw e
    }
  },

  async resync() {
    // Show whatever world is really open, never a workspace for one that isn't.
    const open = await api.getWorld().catch(() => null)
    if (open?.id !== get().world?.id) await get().init().catch(() => undefined)
  },

  async refreshWorld() {
    set({ world: await api.getWorld() })
  },

  async refreshStories() {
    set({ stories: await api.listStories() })
  },

  selectStory(id) {
    set({ storyId: id, sceneId: null, view: { kind: 'write' }, ...leaveHomePatch() })
    void api.updateSettings({ lastStoryId: id, ...placeIn(get().world, id, null) })
  },

  selectScene(id, storyId) {
    const patch: Partial<AppState> = { sceneId: id, view: { kind: 'write' }, ...leaveHomePatch() }
    if (storyId) patch.storyId = storyId
    set(patch)
    void api.updateSettings({ lastSceneId: id, ...(storyId ? { lastStoryId: storyId } : {}), ...placeIn(get().world, get().storyId, id) })
  },

  navigate(view) {
    const before = get().view
    const turn = ++navTurn
    // The New look: a new page crossfades in (features/look/viewTransition.ts). The writing page coming back, the same
    // page, the start screen, and anything done from the keyboard never animate.
    if (view.kind === 'write' || pageKey(view) === pageKey(before) || get().home) {
      set({ view, ...leaveHomePatch() })
      return
    }
    const from = areaOf(before)
    const to = areaOf(view)
    pageTransition(
      () => {
        // The crossfade starts on the next frame: if another page was opened meanwhile (a scene, another page), that wins.
        if (turn !== navTurn || get().view !== before) return false
        set({ view, ...leaveHomePatch() })
      },
      { areaChanges: from !== to && from !== null && to !== null }
    )
  },

  setSaveState: (saveState) => set({ saveState }),
  setSceneWords: (sceneWords) => set({ sceneWords }),
  bumpOutline: () => set({ outlineRev: get().outlineRev + 1 }),
  bumpEntries: () => set({ entriesRev: get().entriesRev + 1 }),
  setActiveGeneration: (activeGeneration) => set({ activeGeneration }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  setDraftOptions: (sceneId, patch) => set({ draftOptions: patchDraftOptions(get().draftOptions, sceneId, patch) }),
  setMemoryStatus: (memoryStatus) => set({ memoryStatus }),
  bumpMemory: () => set({ memoryRev: get().memoryRev + 1 }),
  bumpBriefing: () => set({ briefingRev: get().briefingRev + 1 }),
  peekEntry(id) {
    set({ peekEntryId: id })
    const layout = get().settings?.layout
    if (id && layout && !layout.inspectorOpen) void get().updateSettings({ layout: { inspectorOpen: true } })
  },
  setNewStoryOpen: (newStoryOpen) => set({ newStoryOpen }),
  setAskOpen(askOpen) {
    set({ askOpen, ...(askOpen ? { peekEntryId: null } : {}) })
    const layout = get().settings?.layout
    if (askOpen && layout && !layout.inspectorOpen) void get().updateSettings({ layout: { inspectorOpen: true } })
  },
  goHome: () => set({ home: true }),
  leaveHome: () => set({ home: false }),
  closeWorld() {
    dropUndoToasts()
    set({ ...NO_WORLD, home: true })
  }
}))
