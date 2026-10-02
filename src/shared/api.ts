// The one API between the interface (renderer) and the main process.
// Every method is an async IPC call named `api:<method>`. Main implements them in
// src/main/ipc/*.ts; the renderer calls them through `api` in src/renderer/src/lib/api.ts.

import type {
  AppInfo,
  BackupFolderStatus,
  BackupInfo,
  Chapter,
  ContextPreview,
  DeepPartial,
  DeletedItem,
  DraftOptions,
  Entry,
  EntryInput,
  EntryKind,
  GenerationRecord,
  GenerationStatus,
  GenerationSummary,
  ID,
  ModelInfo,
  Outline,
  ProviderConfig,
  ProviderInput,
  RecoveryItem,
  Scene,
  SceneCard,
  SceneMeta,
  SceneStatus,
  Series,
  Settings,
  Story,
  ThemeName,
  UpdateStatus,
  World,
  WorldSummary,
  WritingPrefs
} from './types'

export interface AppApi {
  // ----- App, settings, preferences -----
  getAppInfo(): Promise<AppInfo>
  getSettings(): Promise<Settings>
  updateSettings(patch: DeepPartial<Settings>): Promise<Settings>
  getWritingPrefs(): Promise<WritingPrefs>
  setWritingPrefs(prefs: WritingPrefs): Promise<WritingPrefs>
  /** Opens a folder picker; returns the new library path or null if cancelled. */
  chooseLibraryFolder(): Promise<string | null>
  /** Opens a folder or file in the system file browser. */
  showInFolder(path: string): Promise<void>
  /** Called by the renderer once pending saves are flushed after an 'app:flush' event. */
  flushDone(): Promise<void>
  /** Called once the interface has painted its first frame, so the window appears fully drawn in the right theme. */
  showWindow(): Promise<void>

  // ----- Worlds -----
  listWorlds(): Promise<WorldSummary[]>
  createWorld(name: string): Promise<World>
  /** Opens a world (closing any open one) and returns it. */
  openWorld(id: ID): Promise<World>
  getWorld(): Promise<World | null>
  updateWorld(patch: Partial<Pick<World, 'name' | 'themes' | 'tone' | 'style'>>): Promise<World>

  // ----- Series and stories (in the open world) -----
  listSeries(): Promise<Series[]>
  listStories(): Promise<Story[]>
  createStory(input: { title: string; seriesId?: ID | null; startStoryId?: ID | null }): Promise<Story>
  updateStory(id: ID, patch: Partial<Pick<Story, 'title' | 'premise' | 'themes' | 'tone' | 'style' | 'seriesId'>>): Promise<Story>
  deleteStory(id: ID): Promise<void>

  // ----- Chapters and scenes -----
  getOutline(storyId: ID): Promise<Outline>
  createChapter(storyId: ID, input?: { title?: string; afterId?: ID | null }): Promise<Chapter>
  updateChapter(id: ID, patch: Partial<Pick<Chapter, 'title' | 'goal'>>): Promise<Chapter>
  deleteChapter(id: ID): Promise<void>
  /** Moves a chapter to `index` within its story. */
  moveChapter(id: ID, index: number): Promise<void>
  createScene(chapterId: ID, input?: { title?: string; afterId?: ID | null }): Promise<SceneMeta>
  getScene(id: ID): Promise<Scene>
  updateScene(id: ID, patch: { title?: string; status?: SceneStatus }): Promise<SceneMeta>
  /** Saves the editor content. Returns the new word count, time and status (planned and drafted follow the text). */
  saveSceneText(id: ID, doc: unknown, text: string): Promise<{ wordCount: number; updatedAt: string; status: SceneStatus }>
  updateSceneCard(id: ID, card: SceneCard): Promise<SceneCard>
  deleteScene(id: ID): Promise<void>
  /** Moves a scene to `index` within `chapterId` (which may be a different chapter). */
  moveScene(id: ID, chapterId: ID, index: number): Promise<void>

  // ----- World bible entries -----
  listEntries(kind?: EntryKind): Promise<Entry[]>
  getEntry(id: ID): Promise<Entry>
  createEntry(kind: EntryKind, input?: EntryInput): Promise<Entry>
  updateEntry(id: ID, patch: EntryInput): Promise<Entry>
  deleteEntry(id: ID): Promise<void>

  /** Undoes a delete (deleted items stay in the trash for 30 days). Used by "Undo" toasts and Recently deleted. */
  restoreDeleted(kind: 'story' | 'chapter' | 'scene' | 'entry', id: ID): Promise<void>
  /** What is in the trash of the open world, newest first. Scenes deleted with their chapter are counted in it. */
  listDeleted(): Promise<DeletedItem[]>

  // ----- Crash recovery of unsaved editor text -----
  writeRecovery(item: RecoveryItem): Promise<void>
  listRecovery(): Promise<RecoveryItem[]>
  clearRecovery(sceneId: ID): Promise<void>

  // ----- Providers and models -----
  listProviders(): Promise<ProviderConfig[]>
  saveProvider(input: ProviderInput): Promise<ProviderConfig>
  deleteProvider(id: ID): Promise<void>
  /** Undoes deleteProvider (this session only), with its key and the model choices that used it. */
  restoreProvider(id: ID): Promise<ProviderConfig>
  testProvider(id: ID, modelId?: string): Promise<{ ok: boolean; message: string; latencyMs: number | null }>
  listModels(providerId: ID): Promise<ModelInfo[]>

  // ----- Generation -----
  previewContext(sceneId: ID, options: DraftOptions): Promise<ContextPreview>
  /** Starts a streamed draft. Text arrives as 'generation:chunk' events. */
  startDraft(sceneId: ID, options: DraftOptions): Promise<{ generationId: ID }>
  stopGeneration(generationId: ID): Promise<void>
  listGenerations(sceneId: ID): Promise<GenerationSummary[]>
  getGeneration(id: ID): Promise<GenerationRecord>

  // ----- Backups -----
  listBackups(): Promise<BackupInfo[]>
  backupNow(): Promise<BackupInfo>
  /** Restores a backup of the open world, backing up the current state first. */
  restoreBackup(id: string): Promise<World>
  /** Opens a folder picker for the optional second backup folder (e.g. inside Dropbox). Returns the folder, or null if cancelled. */
  chooseBackupFolder(): Promise<string | null>
  /** Stops copying backups to the second backup folder (copies already there are left alone). */
  clearBackupFolder(): Promise<void>
  getBackupFolderStatus(): Promise<BackupFolderStatus>

  // ----- Updates -----
  getUpdateStatus(): Promise<UpdateStatus>
  checkForUpdates(): Promise<UpdateStatus>
  /** Restarts the app to install a downloaded update. */
  installUpdate(): Promise<void>
}

export type ApiMethod = keyof AppApi

/** Events sent from the main process to the renderer. */
export interface AppEvents {
  'generation:chunk': { generationId: ID; sceneId: ID; text: string }
  'generation:done': {
    generationId: ID
    sceneId: ID
    status: GenerationStatus
    /** Plain-words error with a next step, when status is 'error'. */
    error: string | null
    promptTokens: number | null
    completionTokens: number | null
    cost: number | null
    /** The reply ran into the reply limit, so the draft stops before the scene's end (the text is kept). */
    cutOff?: boolean
  }
  /** Shown while a request is being retried after a rate limit or server error. */
  'generation:retrying': { generationId: ID; attempt: number; waitMs: number; reason: string }
  'update:status': UpdateStatus
  'backup:done': BackupInfo
  /** The window is closing: save anything pending, then call api.flushDone(). */
  'app:flush': Record<string, never>
}

export type AppEventName = keyof AppEvents

/** Shape of every IPC reply, so errors keep their plain-words message across the bridge. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: { message: string; code?: string } }

/** A theme as painted ('system' resolved to light or dark). */
export type PaintedTheme = Exclude<ThemeName, 'system'>

/** What the preload script exposes on window.aiwrite. */
export interface Bridge {
  invoke(method: ApiMethod, ...args: unknown[]): Promise<IpcResult<unknown>>
  on<E extends AppEventName>(event: E, listener: (payload: AppEvents[E]) => void): () => void
  platform: string
  /** The theme the window opened in, applied before the first frame so nothing flashes. */
  initialTheme: PaintedTheme
}
