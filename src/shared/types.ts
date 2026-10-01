// Domain types shared by the main process and the interface.
// This file is the contract every part of the app builds against. Add to it;
// don't rename or remove fields without a migration (see src/main/db/migrations.ts).

export type ID = string

// ---------- Library and worlds ----------

export interface WorldSummary {
  id: ID
  name: string
  folder: string
  updatedAt: string
}

export interface World {
  id: ID
  name: string
  folder: string
  themes: string
  tone: string
  style: StyleGuide
  createdAt: string
  updatedAt: string
}

export type Spelling = 'UK' | 'US'

/** The world's style guide. A story can override any field (see Story.style). */
export interface StyleGuide {
  pov: string
  tense: string
  proseStyle: string
  samplePassage: string
  avoidPhrases: string[]
  spelling: Spelling | ''
  contentLimits: string
  notes: string
}

/** Adam's own preferences, shared by every world. Stored in the library folder. */
export interface WritingPrefs {
  spelling: Spelling
  pov: string
  tense: string
  voiceNotes: string
  avoidWords: string[]
}

// ---------- Story structure ----------

export interface Series {
  id: ID
  name: string
  themes: string
  tone: string
  position: number
}

/** Stored now so the data model doesn't churn; only 'continues' is used in milestone 1. */
export type StoryKind = 'continues' | 'side' | 'prequel' | 'own'

export interface Story {
  id: ID
  seriesId: ID | null
  title: string
  premise: string
  themes: string
  tone: string
  kind: StoryKind
  /** The story this one continues after (or is set against). Null = beginning of the world. */
  startStoryId: ID | null
  /** Shelf order, for display only. */
  position: number
  createdOrder: number
  /** Story-level overrides of the world style guide. Empty strings / empty arrays mean "use the world's". */
  style: Partial<StyleGuide>
  createdAt: string
  updatedAt: string
}

export interface Chapter {
  id: ID
  storyId: ID
  title: string
  goal: string
  position: number
}

export type SceneStatus = 'planned' | 'drafted' | 'revised' | 'done'

export interface SceneCard {
  povId: ID | null
  presentIds: ID[]
  locationId: ID | null
  /** Free-text in-world date and time, e.g. "Day 12, Year 3, dusk". */
  when: string
  beats: string[]
  goal: string
  conflict: string
  outcome: string
  mood: string
  /** Target length in words. */
  targetWords: number
  /** Notes for the AI. */
  notes: string
}

export interface SceneMeta {
  id: ID
  chapterId: ID
  title: string
  position: number
  status: SceneStatus
  wordCount: number
  updatedAt: string
}

export interface Scene extends SceneMeta {
  card: SceneCard
  /** TipTap / ProseMirror JSON document, or null for an empty scene. */
  doc: unknown | null
  /** Plain text of the scene, paragraphs separated by blank lines. */
  text: string
}

export interface Outline {
  story: Story
  chapters: Chapter[]
  scenes: SceneMeta[]
}

// ---------- World bible ----------

export type EntryKind =
  | 'character'
  | 'place'
  | 'group'
  | 'item'
  | 'lore'
  | 'event'
  | 'thread'
  | 'glossary'

export interface Entry {
  id: ID
  kind: EntryKind
  name: string
  aliases: string[]
  /** One line. */
  summary: string
  description: string
  tags: string[]
  /** Private notes, never sent to the AI. */
  notes: string
  /** Kind-specific fields, keyed by the field keys in src/shared/fields.ts. */
  fields: Record<string, string>
  /** Parent place (a room inside a castle inside a city). */
  parentId: ID | null
  /** Lore flagged as a rule never to break; always sent to the AI. */
  hardRule: boolean
  createdAt: string
  updatedAt: string
}

export type EntryInput = Partial<Omit<Entry, 'id' | 'kind' | 'createdAt' | 'updatedAt'>>

// ---------- Settings, providers, models ----------

export type ProviderKind = 'openrouter' | 'custom'

export interface ProviderConfig {
  id: ID
  name: string
  kind: ProviderKind
  /** e.g. https://openrouter.ai/api/v1 or http://localhost:1234/v1 */
  baseUrl: string
  /** True when an API key is stored (keys never reach the interface). */
  hasKey: boolean
}

export interface ProviderInput {
  id?: ID
  name: string
  kind: ProviderKind
  baseUrl: string
  /** New key to store. Omit to keep the existing key, '' to remove it. */
  apiKey?: string
}

export interface ModelInfo {
  id: string
  name: string
  contextLength: number | null
  /** USD per token, when known. */
  promptPrice: number | null
  completionPrice: number | null
}

export interface ModelChoice {
  providerId: ID
  modelId: string
  label: string
  contextLength: number | null
  promptPrice: number | null
  completionPrice: number | null
}

export type Job = 'writer' | 'memory' | 'chat'

export type Creativity = 'steady' | 'balanced' | 'adventurous'

export type ThemeName = 'system' | 'light' | 'dark' | 'sepia'

export interface Settings {
  libraryPath: string
  providers: ProviderConfig[]
  models: Record<Job, ModelChoice | null>
  creativity: Creativity
  theme: ThemeName
  editor: { fontSize: number; lineHeight: number; pageWidth: number }
  layout: { binderWidth: number; inspectorWidth: number; binderOpen: boolean; inspectorOpen: boolean }
  lastWorldId: ID | null
  lastStoryId: ID | null
  lastSceneId: ID | null
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[]
    ? U[]
    : T[K] extends object | null
      ? DeepPartial<NonNullable<T[K]>> | null
      : T[K]
}

// ---------- Generation ----------

export interface ContextBlock {
  /** Stable id, e.g. 'instructions', 'scene-card', 'previous-scene', 'pov', 'present', 'relationships', 'setting', 'story-so-far', 'mentioned', 'themes'. */
  id: string
  /** 1 (most important) to 10. */
  priority: number
  title: string
  text: string
  tokens: number
  /** Memory entries included in this block. */
  entryIds: ID[]
  /** True when the block didn't fit the budget and wasn't sent. */
  dropped: boolean
}

export interface ContextBudget {
  contextLength: number
  /** Room kept for the reply. */
  reserved: number
  /** Tokens available for the briefing. */
  available: number
  /** Tokens the briefing actually uses. */
  used: number
}

export interface ContextPreview {
  blocks: ContextBlock[]
  budget: ContextBudget
  messages: ChatMessage[]
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface DraftOptions {
  /** Adam's direction for this draft ("make it tense, end on the knock at the door"). */
  direction: string
  targetWords: number
  creativity: Creativity
}

export type GenerationStatus = 'streaming' | 'complete' | 'stopped' | 'error'

export interface GenerationSummary {
  id: ID
  sceneId: ID
  job: 'draft'
  status: GenerationStatus
  modelId: string
  providerName: string
  words: number
  cost: number | null
  createdAt: string
}

export interface GenerationRecord extends GenerationSummary {
  error: string | null
  providerId: ID
  params: { temperature: number; top_p: number; max_tokens: number }
  direction: string
  blocks: ContextBlock[]
  messages: ChatMessage[]
  response: string
  budget: ContextBudget
  promptTokens: number | null
  completionTokens: number | null
  /** Each memory entry included, with the version (updatedAt) that was sent. */
  entries: { entryId: ID; name: string; kind: EntryKind; version: string }[]
  finishedAt: string | null
}

// ---------- Backups and updates ----------

export interface BackupInfo {
  id: string
  worldId: ID
  file: string
  createdAt: string
  sizeBytes: number
  reason: 'launch' | 'timer' | 'manual' | 'before-restore' | 'before-migration'
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'none' }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string; notes: string }
  | { state: 'error'; message: string }
  | { state: 'disabled'; message: string }

export interface AppInfo {
  version: string
  platform: string
  libraryPath: string
  dataPath: string
}

export interface RecoveryItem {
  worldId: ID
  sceneId: ID
  doc: unknown
  text: string
  savedAt: string
}
