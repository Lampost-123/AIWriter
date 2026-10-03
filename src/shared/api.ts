// The one API between the interface (renderer) and the main process.
// Every method is an async IPC call named `api:<method>`. Main implements them in
// src/main/ipc/*.ts; the renderer calls them through `api` in src/renderer/src/lib/api.ts.

import type {
  AsOf,
  AsOfStop,
  EntryAsOf,
  AppInfo,
  BlockMode,
  ChangeInput,
  ChangeView,
  EndAt,
  ExistsPoint,
  FactVersion,
  MemoryLogItem,
  SourceLink,
  MemoryStatus,
  PinScope,
  StartAt,
  Summary,
  SummaryLevel,
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
  ReplacedText,
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
import type { BuilderApi, BuilderEvents } from './contracts/builder'
import type { EntryViewsApi, EntryViewsEvents } from './contracts/entryViews'
import type { WorldViewsApi, WorldViewsEvents } from './contracts/worldViews'
import type { ManuscriptApi, ManuscriptEvents } from './contracts/manuscript'
import type { SearchApi, SearchEvents } from './contracts/search'
import type { StoriesApi, StoriesEvents } from './contracts/stories'
import type { StoryFlowsApi, StoryFlowsEvents } from './contracts/storyFlows'
import type { TasksApi, TasksEvents } from './contracts/tasks'
import type { HistoryApi, HistoryEvents } from './contracts/history'
import type { VariantsApi, VariantsEvents } from './contracts/variants'
import type { BeatsApi, BeatsEvents } from './contracts/beats'
import type { EditsApi, EditsEvents } from './contracts/edits'
import type { AskApi, AskEvents } from './contracts/ask'
import type { OutlineApi, OutlineEvents } from './contracts/outline'
import type { SpeechApi, SpeechEvents } from './contracts/speech'
import type { ReadAloudApi, ReadAloudEvents } from './contracts/readAloud'
import type { DictationApi, DictationEvents } from './contracts/dictation'
import type { WorldBuilderApi, WorldBuilderEvents } from './contracts/worldBuilder'
import type { ChecksApi, ChecksEvents } from './contracts/checks'
import type { TransferApi, TransferEvents } from './contracts/transfer'
import type { ImportingApi, ImportingEvents } from './contracts/importing'
import type { UsageApi, UsageEvents } from './contracts/usage'
import type { SetupApi, SetupEvents } from './contracts/setup'
import type { LookApi, LookEvents } from './contracts/look'
import type { RecipesApi, RecipesEvents } from './contracts/recipes'
import type { FindApi, FindEvents } from './contracts/find'
import type { SpellingApi, SpellingEvents } from './contracts/spelling'
import type { SoundsApi, SoundsEvents } from './contracts/sounds'

/** Every call the interface can make. Each milestone's parts (3 to 6) add theirs in src/shared/contracts/. */
export interface AppApi
  extends BuilderApi,
    EntryViewsApi,
    WorldViewsApi,
    ManuscriptApi,
    SearchApi,
    StoriesApi,
    StoryFlowsApi,
    TasksApi,
    HistoryApi,
    VariantsApi,
    BeatsApi,
    EditsApi,
    AskApi,
    OutlineApi,
    SpeechApi,
    ReadAloudApi,
    DictationApi,
    WorldBuilderApi,
    ChecksApi,
    TransferApi,
    ImportingApi,
    UsageApi,
    SetupApi,
    LookApi,
    RecipesApi,
    FindApi,
    SpellingApi,
    SoundsApi {
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
  updateStory(id: ID, patch: Partial<Pick<Story, 'title' | 'premise' | 'themes' | 'tone' | 'style' | 'seriesId' | 'timeGap'>>): Promise<Story>
  deleteStory(id: ID): Promise<void>
  /**
   * Sets what a story is and where it starts (and ends, for a side story). Refuses, in plain words,
   * any start or end that would make a story follow on from itself. Screens arrive in milestone 3.
   */
  setStoryPlacement(id: ID, placement: StoryPlacement): Promise<Story>

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
  /** Marks a scene done (Ctrl+Enter): sets its status, and the memory and its summary catch up with it now. */
  markSceneDone(id: ID): Promise<SceneMeta>
  /** Opens a scene marked done for more work (status back to revised). */
  reopenScene(id: ID): Promise<SceneMeta>
  /** Adam left this scene (opened another, or another page): the memory keeper reads it if it changed. */
  sceneLeft(id: ID): Promise<void>

  // ----- World bible entries -----
  listEntries(kind?: EntryKind): Promise<Entry[]>
  getEntry(id: ID): Promise<Entry>
  createEntry(kind: EntryKind, input?: EntryInput): Promise<Entry>
  updateEntry(id: ID, patch: EntryInput): Promise<Entry>
  deleteEntry(id: ID): Promise<void>

  // ----- Memory over time (milestone 2) -----
  /** Every change to an entry (baseline relationships and knowledge, start-of-story and scene changes), in story order. */
  listChanges(entryId: ID): Promise<ChangeView[]>
  /** A change Adam makes himself (source 'hand'). The memory keeper never overwrites or removes these. */
  createChange(input: ChangeInput): Promise<ChangeView>
  updateChange(id: ID, input: ChangeInput): Promise<ChangeView>
  deleteChange(id: ID): Promise<void>
  /** Undoes deleteChange (for the Undo toast). */
  restoreChange(id: ID): Promise<void>
  /** Every fact any character knows, for picking the same fact again. */
  listFacts(): Promise<{ factId: ID; fact: string }[]>
  /** Where an entry first exists (shown on its page). */
  listExistsPoints(entryId: ID): Promise<ExistsPoint[]>
  /** Changes pinned to this scene: on a redraft the scene card shows them as "what this scene should bring about". */
  listSceneChanges(sceneId: ID): Promise<ChangeView[]>

  // ----- The memory keeper (milestone 2) -----
  /** What the memory keeper is doing: shown quietly in the top bar. */
  getMemoryStatus(): Promise<MemoryStatus>
  /** The quiet "What changed" list, newest first. */
  listMemoryLog(options?: { sceneId?: ID; entryId?: ID; limit?: number }): Promise<MemoryLogItem[]>
  /** Undoes one thing the memory keeper did (restores the previous version); it won't do that again from the same words. */
  undoMemoryItem(id: ID): Promise<void>
  /** Answers a question-marked line (a judgement call made with a default). Optional, any time. */
  answerMemoryQuestion(id: ID, optionId: string): Promise<void>
  /** An entry's memory history: every version of it and of its changes, newest first. */
  listEntryHistory(entryId: ID): Promise<FactVersion[]>
  /** Restores an entry (its own fields) to an earlier version; this writes a new version, so it can be undone too. */
  restoreEntryVersion(entryId: ID, versionId: ID): Promise<Entry>
  /** The words each of an entry's facts came from (the entry itself and its fields). */
  listEntryLinks(entryId: ID): Promise<SourceLink[]>
  /** Brings the memory up to date with a scene now (or every scene that is behind), e.g. after an error. */
  updateMemoryNow(sceneId?: ID): Promise<void>

  // ----- Portraits and the memory as of a point (milestone 3) -----
  /**
   * Gives an entry a portrait (image bytes the interface has already made small, see lib/image.ts),
   * or removes it (null). Returns the entry with its new `image` address.
   */
  setEntryImage(entryId: ID, image: { bytes: Uint8Array; type: string } | null): Promise<Entry>
  /**
   * The stops of an as-of slider for a story: the start of each story on its line and every scene
   * on it, through the story's end, in reading order. With an entry, each stop counts that entry's
   * changes there, so the slider can mark where it changed.
   */
  listAsOfStops(storyId: ID, entryId?: ID | null): Promise<AsOfStop[]>
  /** An entry as it is at a point (its state, relationships, what it knows, a thread's status). */
  getEntryAsOf(entryId: ID, at: AsOf): Promise<EntryAsOf>

  // ----- Summaries (milestone 2) -----
  getSummary(level: SummaryLevel, targetId: ID): Promise<Summary | null>
  /** Adam's own words for a summary: kept from then on, never replaced automatically. */
  setSummary(level: SummaryLevel, targetId: ID, text: string): Promise<Summary>
  /** A story's scene and chapter summaries and its own summary. */
  listStorySummaries(storyId: ID): Promise<Summary[]>

  // ----- Briefing choices, from the Context tab (milestone 2) -----
  /** Pins an entry to briefings for a scene, a story or the world ('pin'), keeps it out ('hide'), or clears that (null). */
  setPin(entryId: ID, scope: PinScope, scopeId: ID | null, action: 'pin' | 'hide' | null): Promise<void>
  /** Sends a block of this scene's briefing in full, short, or as the budget decides. */
  setBlockMode(sceneId: ID, blockId: string, mode: BlockMode): Promise<void>

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
  /**
   * Stops a draft of this scene that hasn't begun yet (the memory may still be catching up with
   * earlier scenes first). Nothing is sent to the model, and that startDraft fails with the code
   * 'cancelled'. Does nothing when no draft of the scene is starting.
   */
  cancelDraftStart(sceneId: ID): Promise<void>
  listGenerations(sceneId: ID): Promise<GenerationSummary[]>
  getGeneration(id: ID): Promise<GenerationRecord>
  /**
   * Keeps the scene's text a draft took the place of with the draft's record, the moment its first
   * words replace it (or forgets it, with null, when the old text was put back because nothing came).
   */
  keepReplacedText(generationId: ID, replaced: ReplacedText | null): Promise<void>

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

/** What a story is and where it starts (see Story). */
export interface StoryPlacement {
  kind: Story['kind']
  startStoryId: ID | null
  startAt: StartAt
  startRefId: ID | null
  endAt: EndAt | null
  endRefId: ID | null
  leadsIntoId: ID | null
}

export type ApiMethod = keyof AppApi

/** Events sent from the main process to the renderer. Each milestone's parts (3 to 6) add theirs in src/shared/contracts/. */
export interface AppEvents
  extends BuilderEvents,
    EntryViewsEvents,
    WorldViewsEvents,
    ManuscriptEvents,
    SearchEvents,
    StoriesEvents,
    StoryFlowsEvents,
    TasksEvents,
    HistoryEvents,
    VariantsEvents,
    BeatsEvents,
    EditsEvents,
    AskEvents,
    OutlineEvents,
    SpeechEvents,
    ReadAloudEvents,
    DictationEvents,
    WorldBuilderEvents,
    ChecksEvents,
    TransferEvents,
    ImportingEvents,
    UsageEvents,
    SetupEvents,
    LookEvents,
    RecipesEvents,
    FindEvents,
    SpellingEvents,
    SoundsEvents {
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
  /** The memory changed (by the memory keeper, an undo or Adam): lists, the scene card and the Context tab reload. */
  'memory:changed': { sceneId: ID | null; entryIds: ID[] }
  /** The memory keeper's status changed. */
  'memory:status': MemoryStatus
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
  /** Milestone 6: the accent colour the window opened in (an AccentId), or null for the theme's own; applied as the theme is. */
  initialAccent?: string | null
}
