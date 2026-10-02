import { create } from 'zustand'
import type { DeepPartial, EntryKind, ID, Settings, Story, World } from '@shared/types'
import { useToasts } from '@/components/ui/Toast'
import { lastSceneOf } from '@/features/binder/lastScene'
import { api } from './api'

export type SettingsTab = 'models' | 'preferences' | 'appearance' | 'backups' | 'about'

/** What fills the centre of the window. The binder stays on the left throughout. */
export type View =
  | { kind: 'write' }
  | { kind: 'entries'; entryKind: EntryKind; entryId: ID | null }
  | { kind: 'style' }
  | { kind: 'settings'; tab: SettingsTab }
  | { kind: 'generation'; generationId: ID }

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
}

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
  return { world, stories, storyId: story?.id ?? null, sceneId, view: { kind: 'write' }, outlineRev: 0 }
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
  activeGeneration: null
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
  setActiveGeneration: (activeGeneration) => set({ activeGeneration })
}))
