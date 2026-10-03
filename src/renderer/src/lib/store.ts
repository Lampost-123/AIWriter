import { create } from 'zustand'
import type { DeepPartial, EntryKind, ID, MemoryStatus, Settings, Story, World } from '@shared/types'
import type { BuilderKind, BuilderStart } from '@shared/contracts/builder'
import { useToasts } from '@/components/ui/Toast'
import { lastSceneOf } from '@/features/binder/lastScene'
import { patchDraftOptions, type SceneDraftOptions } from '@/features/generate/draftOptions'
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
  /** The outline helper: acts, chapters and scene cards suggested from a premise. */
  | { kind: 'outline'; storyId: ID }
  /** Build the world from a summary (the World builder): lays out everything a summary names, and lists what it made. */
  | { kind: 'worldBuilder' }
  // ----- Milestone 5 -----
  /** A story's consistency: its issues by chapter and scene, checking a chapter or the story, and the reports. */
  | { kind: 'consistency'; storyId: ID }
  // Milestone 6: importing a manuscript (the split preview, then the import catch-up's progress)
  | { kind: 'import' }

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

  init(): Promise<void>
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
}

export type InspectorTab = 'card' | 'context' | 'drafts' | 'cast' | 'issues'

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

/** Nothing of a world left on screen: the welcome screen shows instead. */
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

  async init() {
    const settings = await api.getSettings()
    const world = await api.getWorld()
    const extra = world ? await loadWorldState(world, settings) : NO_WORLD
    set({ settings, ...extra, ready: true })
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
      set({ settings, ...(await loadWorldState(world, settings)) })
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
      set({ settings, ...(await loadWorldState(world, settings)) })
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
    set({ storyId: id, sceneId: null, view: { kind: 'write' } })
    void api.updateSettings({ lastStoryId: id, ...placeIn(get().world, id, null) })
  },

  selectScene(id, storyId) {
    const patch: Partial<AppState> = { sceneId: id, view: { kind: 'write' } }
    if (storyId) patch.storyId = storyId
    set(patch)
    void api.updateSettings({ lastSceneId: id, ...(storyId ? { lastStoryId: storyId } : {}), ...placeIn(get().world, get().storyId, id) })
  },

  navigate(view) {
    set({ view })
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
  }
}))
