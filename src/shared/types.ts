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

/**
 * What a story is (the spec's "What is it?"): continues after a story, a side story during one,
 * a prequel to a book, or its own version of events. See "Multi-story rules" in the spec.
 */
export type StoryKind = 'continues' | 'side' | 'prequel' | 'own'

/**
 * Where in its start story a story starts. With no start story it starts at the beginning of the world.
 * - 'pre': at the start story's start, before its start-of-story changes (prequels)
 * - 'post': at its start, after its start-of-story changes
 * - 'chapter' / 'scene': after that chapter or scene (startRefId)
 * - 'end': after its end (the default: "Continues after")
 */
export type StartAt = 'pre' | 'post' | 'chapter' | 'scene' | 'end'

/** Where a side story ends in its host: the host's end, or after one of its chapters (endRefId). */
export type EndAt = 'end' | 'chapter'

export interface Story {
  id: ID
  seriesId: ID | null
  title: string
  premise: string
  themes: string
  tone: string
  kind: StoryKind
  /** The story this one starts in (continues after, runs alongside, is a prequel to...). Null = the beginning of the world. */
  startStoryId: ID | null
  /** Where in the start story it starts. Ignored when startStoryId is null. */
  startAt: StartAt
  /** The chapter or scene it starts after, when startAt is 'chapter' or 'scene'. */
  startRefId: ID | null
  /** Side stories only: where it ends in its host (the start story). Null for every other kind. */
  endAt: EndAt | null
  /** The host's chapter it ends after, when endAt is 'chapter'. */
  endRefId: ID | null
  /** Set on a prequel: the book it leads into. Stories that continue after a prequel lead into the same book. */
  leadsIntoId: ID | null
  /** Adam marked this story as the one that leads into the book (otherwise the last story in the prequel chain does). */
  leadsIn: boolean
  /** Optional free text: time since the previous story, such as "200 years". */
  timeGap: string
  /** Shelf order, for display only. */
  position: number
  createdOrder: number
  /** Story-level overrides of the world style guide. Empty strings / empty arrays mean "use the world's". */
  style: Partial<StyleGuide>
  createdAt: string
  updatedAt: string
}

/** Stored from milestone 2 (the data model freezes then); screens come with the outline helper. */
export interface Act {
  id: ID
  storyId: ID
  title: string
  purpose: string
  position: number
}

export interface Chapter {
  id: ID
  storyId: ID
  title: string
  goal: string
  position: number
  /** The act it belongs to, if the story has acts. */
  actId: ID | null
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
  /** Sortable number for the in-world date (for the timeline; never decides what the AI sees). */
  whenSort: number | null
  /** Plot threads (entry ids, kind 'thread') this scene sets up. */
  setsUpIds: ID[]
  /** Plot threads this scene pays off. */
  paysOffIds: ID[]
}

export interface SceneMeta {
  id: ID
  chapterId: ID
  title: string
  position: number
  status: SceneStatus
  wordCount: number
  updatedAt: string
  /** When Adam last marked the scene done (Ctrl+Enter); null if never or reopened since. */
  acceptedAt: string | null
  /** Where the scene's memory stands ("Memory not updated" when 'failed'). */
  memoryState: SceneMemoryState
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
  /** Who made it: Adam, the memory keeper reading a scene's text, or the AI drafting it (prequel starting cast, time gaps). */
  origin: Origin
  /** Who each field's current value comes from (keys: field keys and 'name', 'aliases', 'summary', 'description', 'tags'); missing keys follow `origin`. */
  fieldOrigins: Record<string, Origin>
  /** The story Adam was working in when it was made (decides its default first-exists point). */
  originStoryId: ID | null
  /** For entries found in the text: the scene it was found in. */
  originSceneId: ID | null
  /** Made by a start-of-story change (it then first exists after that story's start-of-story changes). */
  originStart: boolean
  /** True once Adam has edited any of it himself: the memory keeper never removes it after that. */
  byHand: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Where a fact comes from (spec, Multi-story rules: "Source links and automatic upkeep"):
 * - 'adam': typed or edited by Adam. Never changed or removed automatically.
 * - 'text': read from a scene's text by the memory keeper; carries source links to the words.
 * - 'ai': drafted by the AI (prequel starting states, time-gap changes); replaced when the text says otherwise.
 */
export type Origin = 'adam' | 'text' | 'ai'

/** @deprecated use Origin */
export type EntryOrigin = Origin

export type EntryInput = Partial<Omit<Entry, 'id' | 'kind' | 'createdAt' | 'updatedAt' | 'origin' | 'fieldOrigins' | 'originSceneId' | 'originStart' | 'byHand'>>

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
  /** The last connection test (or a key the provider turned down since). Cleared when the key or address changes. */
  lastCheck?: { ok: boolean; at: string }
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
  /** The most the model will write in one reply (tokens), when the provider says. */
  maxOutput?: number | null
  /** False when the provider says the model sets its own creativity (takes no temperature). */
  sampling?: boolean
}

export interface ModelChoice {
  providerId: ID
  modelId: string
  label: string
  contextLength: number | null
  promptPrice: number | null
  completionPrice: number | null
  /** The most the model will write in one reply (tokens), when the provider says. */
  maxOutput?: number | null
  /** False when the provider says the model sets its own creativity (takes no temperature); null when not known. */
  sampling?: boolean | null
}

export type Job = 'writer' | 'memory' | 'chat'

export type Creativity = 'steady' | 'balanced' | 'adventurous'

/** How much a model thinks before it answers, set for each job: 'auto' leaves it to the model. */
export type ThinkingLevel = 'auto' | 'off' | 'low' | 'medium' | 'high'

export type ThemeName = 'system' | 'light' | 'dark' | 'sepia'

export interface Settings {
  libraryPath: string
  providers: ProviderConfig[]
  models: Record<Job, ModelChoice | null>
  /** How much each job's model thinks before it answers. */
  thinking: Record<Job, ThinkingLevel>
  creativity: Creativity
  theme: ThemeName
  editor: { fontSize: number; lineHeight: number; pageWidth: number }
  layout: { binderWidth: number; inspectorWidth: number; binderOpen: boolean; inspectorOpen: boolean }
  lastWorldId: ID | null
  lastStoryId: ID | null
  lastSceneId: ID | null
  /** Where Adam was in each world (by world id), so switching back reopens that story and scene. */
  lastPlaces: Record<ID, { storyId: ID | null; sceneId: ID | null }>
  /** Optional second backup folder (e.g. inside Dropbox, OneDrive or iCloud). Copies go to <extraFolder>/<world folder name>/. */
  backup: { extraFolder: string | null }
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
  /** Stable id, e.g. 'instructions', 'scene-card', 'previous-scene', 'pov', 'present', 'relationships', 'setting', 'world-rules', 'story-so-far', 'mentioned', 'themes'. */
  id: string
  /** 1 (most important) to 10. */
  priority: number
  title: string
  /** The text as sent (its short form when `short` is true). */
  text: string
  tokens: number
  /** Memory entries included in this block. */
  entryIds: ID[]
  /** True when the block didn't fit the budget and wasn't sent. */
  dropped: boolean
  /** True when the block was sent in its short form (to fit, or because Adam chose it). Records from milestone 1 leave it out. */
  short?: boolean
  /** True when the block has a short form at all. */
  hasShort?: boolean
  /** Adam's choice for this scene, from the Context tab: 'auto' lets the budget decide. */
  mode?: BlockMode
}

export type BlockMode = 'auto' | 'full' | 'short'

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
  /** "This story knows what happened in: Book 1; Kell's Road; Book 2 up to the end of Ch 5." (milestone 2) */
  knows?: string
  /** Every memory entry in the briefing (or kept out of it), and why, for the Context tab. (milestone 2) */
  entries?: ContextEntry[]
}

/** One memory entry as the Context tab lists it. */
export interface ContextEntry {
  entryId: ID
  name: string
  kind: EntryKind
  /** The block it is in; null when Adam removed it from the briefing. */
  blockId: string | null
  /** Why it is included, in plain words: "On the scene card", "Named in the beats", "Pinned for this story", "A world rule". */
  why: string
  /** Where Adam pinned it, if he did. */
  pinned: PinScope | null
  /** Adam removed it from this scene's briefing. */
  hidden: boolean
  /** For an entry that doesn't exist yet at this point but was pinned or listed: "not in the story yet at this point". */
  label: string | null
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

/** What an AI call was for: a scene draft, a memory update from a scene's text, or a summary roll-up. */
export type GenerationJob = 'draft' | 'memory' | 'summary'

export interface GenerationSummary {
  id: ID
  sceneId: ID
  job: GenerationJob
  status: GenerationStatus
  modelId: string
  providerName: string
  words: number
  cost: number | null
  /** True when the provider didn't report usage and `cost` is AI Write's own estimate. */
  costEstimated?: boolean
  createdAt: string
}

export interface GenerationRecord extends GenerationSummary {
  error: string | null
  providerId: ID
  params: {
    temperature: number
    top_p: number
    max_tokens: number
    creativity?: Creativity
    targetWords?: number
    /** Set when the model wanted the reply limit sent as max_completion_tokens. */
    tokenParam?: 'max_tokens' | 'max_completion_tokens'
    /** False when the model sets its own creativity, so temperature and top_p weren't sent. */
    sampling?: boolean
    /** The reply reached the limit, so the scene stops before its end. */
    cutOff?: boolean
    /** How much the model was asked to think, as sent; left out when it was left to the model. */
    thinking?: Exclude<ThinkingLevel, 'auto'>
  }
  direction: string
  blocks: ContextBlock[]
  messages: ChatMessage[]
  response: string
  budget: ContextBudget
  promptTokens: number | null
  completionTokens: number | null
  /** Each memory entry included, with the version (updatedAt) that was sent. */
  entries: {
    entryId: ID
    name: string
    kind: EntryKind
    version: string
    /** The entry has been deleted since (it may be in the trash). */
    deleted?: boolean
    /** The entry has been edited since this draft, so the AI saw an older version. */
    changedSince?: boolean
  }[]
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

/** The optional second backup folder and whether the last copy to it worked. */
export interface BackupFolderStatus {
  folder: string | null
  /** False when the last copy failed (folder missing, disk full, cloud folder offline...). */
  ok: boolean
  /** Plain-words reason the last copy failed, with a next step. */
  message: string | null
  /** When a backup was last copied there successfully. */
  lastCopyAt: string | null
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
  /** False when the library folder can't be reached or made (e.g. it is on a drive that isn't plugged in). */
  libraryReachable: boolean
}

export interface RecoveryItem {
  worldId: ID
  sceneId: ID
  doc: unknown
  text: string
  savedAt: string
}

/** Something in the Trash (Recently deleted): kept for 30 days, then removed for good. */
export interface DeletedItem {
  kind: 'story' | 'chapter' | 'scene' | 'entry'
  id: ID
  /** Its title or name, as it was. */
  title: string
  deletedAt: string
  /** For an entry: character, place, lore... */
  entryKind: EntryKind | null
  /** The story a chapter or scene was in, and the chapter a scene was in. */
  storyId: ID | null
  storyTitle: string | null
  chapterTitle: string | null
  /** For a chapter: the scenes deleted along with it (they come back with it). */
  sceneCount: number
}

// ---------- Memory over time (milestone 2) ----------
// Every fact knows where on a story's line it became true. An entry's state at a scene is its
// baseline (the entry row) plus every change that counts there, in line order. Which changes
// count is decided by one function, the line (src/main/memory/line.ts), following the spec's
// "Multi-story rules" tab. Nothing here is ever shown with the words "line" or "main history".

/** Where a change is pinned: before any story (the baseline), at the start of a story, or to a scene (it happens in that scene). */
export type ChangeAnchor = 'baseline' | 'story-start' | 'scene'

/** @deprecated use Origin: 'adam' (typed by Adam), 'text' (read from a scene) or 'ai' (drafted by the AI). */
export type ChangeSource = Origin

/** "Mara: lost her left hand". The note says what is now different; fields and description give the new state. */
export interface UpdatePayload {
  note: string
  /** Kind-specific fields with their new values (keys from src/shared/fields.ts). */
  fields?: Record<string, string>
  description?: string
  summary?: string
}

/** A start-of-story full description: replaces the entry's description, what it knows and its relationships (both sides). */
export interface FullPayload {
  description: string
  summary?: string
  fields?: Record<string, string>
  knows: { factId: ID; fact: string }[]
  relationships: RelationshipPayload[]
}

/**
 * A link between two entries from the change's entry's side: sister, rival, member of (a group),
 * holds (an item), involved in (an event). One relationship per pair; a later one replaces it.
 */
export interface RelationshipPayload {
  otherId: ID
  /** Plain words: "sister", "rival", "member (lieutenant)", "holds". */
  type: string
  /** How this entry feels about the other (characters). */
  feels: string
  /** How the other feels about this entry. */
  otherFeels: string
  /** The relationship is over from here on. */
  ended?: boolean
}

/** A character learns a fact (or forgets it). Facts are shared by id, so "Tobin does not know Mara is the heir" can be worked out. */
export interface KnowledgePayload {
  factId: ID
  fact: string
  forgets?: boolean
}

/** A plot thread opens or is resolved. */
export interface ThreadPayload {
  status: 'open' | 'resolved'
  note: string
}

export type ChangeData =
  | { kind: 'update'; payload: UpdatePayload }
  | { kind: 'full'; payload: FullPayload }
  | { kind: 'relationship'; payload: RelationshipPayload }
  | { kind: 'knowledge'; payload: KnowledgePayload }
  | { kind: 'thread'; payload: ThreadPayload }

export type ChangeKind = ChangeData['kind']

export type Change = ChangeData & {
  id: ID
  entryId: ID
  anchor: ChangeAnchor
  /** The story for a story-start change; the scene's story for a scene change. */
  storyId: ID | null
  sceneId: ID | null
  /** Order among changes at the same anchor. */
  position: number
  /** Who it comes from. Text-origin changes have source links to the words they were read from. */
  origin: Origin
  /** The memory keeper run that made or last changed it. */
  runId: ID | null
  createdAt: string
  updatedAt: string
}

export type ChangeInput = ChangeData & {
  entryId: ID
  anchor: ChangeAnchor
  storyId?: ID | null
  sceneId?: ID | null
}

/** A change as an entry page lists it, with where it happened in plain words ("Book 1, Ch 12, Sc 3") and the words it came from. */
export type ChangeView = Change & { where: string; links: SourceLink[] }

/** Where an entry first exists. An entry counts at a scene only if one of these is on that story's line, at or before the scene. */
export type ExistsKind = 'world' | 'story-pre' | 'story-post' | 'scene'

export interface ExistsPoint {
  id: ID
  entryId: ID
  kind: ExistsKind
  storyId: ID | null
  sceneId: ID | null
  /** Set by Adam; defaults (byHand false) are worked out again when a story's kind or start changes. */
  byHand: boolean
}

/** An entry as it is at a point in the story: baseline plus every change that counts there. */
export interface EntryState extends Entry {
  /** What has happened to it so far, oldest first ("lost her left hand", with where). */
  happened: { note: string; where: string; changeId: ID }[]
  /** Field keys (and 'description' / 'summary') a change has set, so views can mark them. */
  changed: string[]
}

export interface RelationshipState {
  aId: ID
  bId: ID
  type: string
  /** How a feels about b, and b about a. */
  aFeels: string
  bFeels: string
  /** Where it last changed, in plain words; '' for the baseline. */
  where: string
}

export interface FactState {
  factId: ID
  fact: string
  /** Characters who know it at this point. */
  knownBy: ID[]
}

export interface ThreadState {
  entryId: ID
  status: 'open' | 'resolved'
  /** Where it was set up and paid off, in plain words. */
  setUp: string
  paidOff: string
}

// ---------- Summaries, pins, answers ----------

export type SummaryLevel = 'scene' | 'chapter' | 'story' | 'series'

/** A summary at one level. Chapter summaries roll up from scene summaries, stories from chapters, series from their books. */
export interface Summary {
  level: SummaryLevel
  targetId: ID
  text: string
  /** 'adam' when Adam wrote or edited it: never replaced automatically. Otherwise 'text' (kept up to date from the scenes). */
  origin: Origin
  /** What it was made from has changed since. */
  stale: boolean
  updatedAt: string
}

/** Pins decide extra entries for briefings: 'pin' always includes it, 'hide' keeps it out. */
export type PinScope = 'scene' | 'story' | 'world'

export interface Pin {
  id: ID
  scope: PinScope
  /** The scene or story; null for the world. */
  scopeId: ID | null
  entryId: ID
  action: 'pin' | 'hide'
}

/**
 * Adam's answers to multi-story questions:
 * - 'side-order': the order of side stories that end at the same point (key: host id + end point; value: story ids)
 * - 'which-last': "Which happened last?" for a side story and its host (key: side story id + entry id + aspect; value: 'host' | 'side')
 * - 'prequel-end': end-of-prequel choices (key: prequel id + item; value: 'ignore' | 'keep')
 */
export type AnswerKind = 'side-order' | 'which-last' | 'prequel-end'

export interface Answer {
  id: ID
  kind: AnswerKind
  key: string
  value: unknown
}

// ---------- The memory keeper (milestone 2) ----------
// Memory follows the text with no approvals (spec: Memory upkeep, and Multi-story rules "Source links
// and automatic upkeep"). Each fact read from a scene keeps source links to the words it came from:
// editing them updates the fact, deleting them removes it (a fact backed by several passages stays
// until the last goes). Adam's facts (origin 'adam') are never changed or removed automatically; if
// the text disagrees with one, a consistency issue is raised instead. Every change to a fact writes a
// version (memory history). A quiet "What changed" list, grouped by run, has Undo on every line.

/** A link from a fact to the words in a scene it was read from. */
export interface SourceLink {
  id: ID
  /** What the fact is: an entry (it was found here), one field of an entry, a change, a summary, or a voice sample line. */
  factKind: 'entry' | 'field' | 'change' | 'summary' | 'voice'
  /** The entry, change or summary id (summaries: `${level}:${targetId}`). */
  factId: ID
  /** For 'field' and 'voice' links: the field key. */
  field: string | null
  sceneId: ID
  /** The scene's text version the words were read from. */
  sceneVersion: number
  /** The paragraph's stable id in the editor, when it has one. */
  paragraphId: string | null
  /** Character range within the paragraph (or the scene's plain text when there is no paragraph id). */
  start: number
  end: number
  /** The exact words. */
  quote: string
  /** 'ok' while the words are there; 'changed' when they were edited; 'gone' when they were deleted. */
  state: 'ok' | 'changed' | 'gone'
}

/** One version of a fact in the memory history. Every change, automatic or by hand, writes one. */
export interface FactVersion {
  id: ID
  factKind: 'entry' | 'change' | 'summary'
  factId: ID
  /** The entry the fact belongs to (for an entry's history). */
  entryId: ID | null
  /** 1, 2, 3... per fact. */
  version: number
  /** The fact as it was saved (an Entry, a Change or a Summary); null when it was removed. */
  data: unknown
  origin: Origin
  /** The memory keeper run that wrote it; null for Adam's edits. */
  runId: ID | null
  createdAt: string
}

/** One line in the "What changed" list. */
export interface MemoryLogItem {
  id: ID
  /** The memory keeper run it belongs to (the list is grouped by run). */
  runId: ID
  sceneId: ID | null
  /** The entry it is about: "Mara", "Kell". */
  entryName: string
  /** Plain words: "Lost her left hand", "New character", "No longer knows Mara is the heir: those words were deleted". */
  text: string
  /** The change as before and after, in plain words ('' when there was nothing before, or nothing after). */
  before: string
  after: string
  action: 'added' | 'updated' | 'removed' | 'failed'
  what: 'entry' | 'change' | 'summary' | 'scene'
  entryId: ID | null
  factId: ID | null
  /** The words in the scene it came from. */
  quote: string
  /** Where, in plain words: "Book 1, Ch 2, Sc 3". */
  where: string
  /** A judgement call the app made with a default (the line shows a small question mark). Answering is optional. */
  question: { text: string; options: { id: string; label: string }[]; answer: string | null } | null
  createdAt: string
  /** Adam undid it. */
  undone: boolean
}

export interface MemoryStatus {
  /** Scenes whose latest text the memory hasn't read yet. */
  behind: number
  /** Scenes whose last update failed ("Memory not updated"); retried on the next trigger and at app start. */
  failed: number
  /** The scene being read now. */
  reading: { sceneId: ID; title: string } | null
  /** Plain words with a next step, when the last attempt failed ("Choose a writer model in Settings › Models to keep the memory up to date."). */
  error: string | null
  /** The last run that changed something, for the quiet "Memory updated" note. */
  lastUpdate: { at: string; runId: ID; changes: number } | null
}

/** Where a scene's memory stands: up to date, waiting to be read, or "Memory not updated". */
export type SceneMemoryState = 'current' | 'pending' | 'failed'
