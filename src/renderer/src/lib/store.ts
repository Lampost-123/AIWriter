import { create } from 'zustand'
import type { DeepPartial, EntryKind, ID, Settings, Story, World } from '@shared/types'
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

async function loadWorldState(world: World, settings: Settings): Promise<Partial<AppState>> {
  const stories = await api.listStories()
  const storyId = stories.find((s) => s.id === settings.lastStoryId)?.id ?? stories[0]?.id ?? null
  let sceneId: ID | null = null
  if (storyId) {
    const outline = await api.getOutline(storyId)
    sceneId = outline.scenes.find((s) => s.id === settings.lastSceneId)?.id ?? outline.scenes[0]?.id ?? null
  }
  return { world, stories, storyId, sceneId, view: { kind: 'write' }, outlineRev: 0 }
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

  async init() {
    const settings = await api.getSettings()
    const world = await api.getWorld()
    const extra = world ? await loadWorldState(world, settings) : {}
    set({ settings, ...extra, ready: true })
  },

  async updateSettings(patch) {
    const settings = await api.updateSettings(patch)
    set({ settings })
  },

  async createWorld(name) {
    const world = await api.createWorld(name)
    const settings = await api.getSettings()
    set({ settings, ...(await loadWorldState(world, settings)) })
  },

  async openWorld(id) {
    const world = await api.openWorld(id)
    const settings = await api.getSettings()
    set({ settings, ...(await loadWorldState(world, settings)) })
  },

  async refreshWorld() {
    set({ world: await api.getWorld() })
  },

  async refreshStories() {
    set({ stories: await api.listStories() })
  },

  selectStory(id) {
    set({ storyId: id, sceneId: null, view: { kind: 'write' } })
    void api.updateSettings({ lastStoryId: id })
  },

  selectScene(id, storyId) {
    const patch: Partial<AppState> = { sceneId: id, view: { kind: 'write' } }
    if (storyId) patch.storyId = storyId
    set(patch)
    void api.updateSettings({ lastSceneId: id, ...(storyId ? { lastStoryId: storyId } : {}) })
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
