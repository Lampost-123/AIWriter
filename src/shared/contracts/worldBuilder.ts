// Build the world from a summary (milestone 4): Quick start for a whole world. Adam types or pastes a
// summary of his world or story, from a paragraph to several pages, and one click lays out everything in
// it: characters with full profiles (as Quick start makes them), places inside one another, groups,
// items, lore and rules (a rule the summary states as absolute is never to be broken), events with their
// dates, plot threads open before the story starts, glossary words, relationships between characters,
// and the world's themes and tone. His own words are kept word for word as his; the AI fills the gaps,
// marked "drafted by AI". Into a world that has entries already, it adds only what is missing and never
// changes what is there; where the summary disagrees with a page, that becomes a consistency issue.
// Owned by the World builder part. See docs/ARCHITECTURE.md, "Milestone 4".
//
// A build saves as it goes and is one run in What changed (lines with no scene), so any line can be
// undone there, and undoWorldBuild undoes the whole build in one go. Its AI calls are 'world' generation
// records run by the shared task runner, with the World builder model (jobModel('world')). The summary is
// kept in the world's meta table (key 'world_summary'), so the page reopens with it.

import type { EntryKind, ID } from '../types'

export interface WorldBuildInput {
  /** Made by the interface (any unique id), so every event can be matched to it. */
  buildId: ID
  summary: string
  /** Where the summary's setup is true: null for the beginning of the world, else that story's start (a prequel or side story). */
  storyId: ID | null
}

/** What a build is doing, in the order it does it: characters and places first, so later parts can link to them. */
export type WorldBuildStage =
  | 'reading'
  | 'characters'
  | 'places'
  | 'groups'
  | 'items'
  | 'lore'
  | 'events'
  | 'threads'
  | 'glossary'
  | 'relationships'
  | 'themes'
  | 'checking'

/** One thing a build made, for its results page. */
export interface WorldBuildItem {
  /** Its line in What changed. */
  lineId: ID
  /** A new entry, a relationship, or the world's themes or tone. */
  what: 'entry' | 'relationship' | 'themes' | 'tone'
  /** The entry; for a relationship, the one it is recorded on. Null for themes and tone. */
  entryId: ID | null
  kind: EntryKind | null
  /** "Mara Venn"; for a relationship, the one it is recorded on ("Tobin"); "Themes" or "Tone". */
  name: string
  /** One line about it: the entry's short summary, the relationship as What changed words it ("Younger brother: Mara Venn"), the themes. */
  detail: string
  /** Lore made as a rule never to break. */
  hardRule: boolean
  /** The other side of a relationship. */
  otherId: ID | null
  /** No longer there: undone since (one line at a time from What changed, or the whole build), or deleted. */
  undone: boolean
}

export interface WorldBuildProgress {
  buildId: ID
  stage: WorldBuildStage
  /** Plain words: "Laying out characters: 4 of 7". */
  step: string
  /** Everything saved so far, in the order it was made. */
  made: WorldBuildItem[]
  /** Plain words while a busy service is being tried again; null otherwise. */
  retrying: string | null
}

/** Something the summary says that disagrees with a page already in the world: raised as a consistency issue, nothing changed. */
export interface WorldBuildConflict {
  entryId: ID
  kind: EntryKind
  /** The page's name: "Mara Venn". */
  name: string
  /** The field it is about ('age'). */
  field: string
  /** Plain words: "Mara Venn: your summary says age or birth date is “34”, but the page says “29”." */
  message: string
}

export interface WorldBuildDone {
  buildId: ID
  /** 'cancelled' (Cancel, or the world closed) and 'error' keep everything saved before. */
  status: 'complete' | 'cancelled' | 'error'
  /** Plain words with a next step, when status is 'error'. */
  error: string | null
  /** 'no-writer-model' or 'no-key' when the fix is in Settings › Models. */
  code: string | null
  /** The build's run in What changed; null when it saved nothing. */
  runId: ID | null
  made: WorldBuildItem[]
  /** What the summary names that is already in the world, left as it is. */
  found: { entryId: ID; kind: EntryKind; name: string }[]
  /** Names it couldn't lay out, because the AI's reply couldn't be used even when asked again. */
  missed: string[]
  /** Names it left out because Adam undid or deleted them after an earlier build, and the summary's words about them haven't changed. */
  skipped: string[]
  conflicts: WorldBuildConflict[]
  /** USD; null when unknown. */
  cost: number | null
  storyId: ID | null
  finishedAt: string
}

/** The World builder page's state in the open world. */
export interface WorldBuilderState {
  /** The summary as last kept ('' when there is none). */
  summary: string
  /** A build still running (it goes on while Adam is on other pages), as it stands. */
  running: (WorldBuildProgress & { storyId: ID | null }) | null
  /**
   * The last build to end, with what it made as it is now (undone or not). After a restart, the newest one
   * saved in the world: its buildId is '' and only what it made is known (found, missed, skipped and
   * conflicts are empty).
   */
  last: WorldBuildDone | null
}

/** Roughly what a build would cost, before it starts. */
export interface WorldBuildEstimate {
  /** USD; null when the World builder model's prices aren't known. */
  cost: number | null
  /** The World builder model, as Settings › Models names it; null when there is none. */
  model: string | null
  /** Plain words when there is no model to build with ("Choose a writer model first, in Settings › Models."). */
  problem: string | null
  /** 'no-writer-model' or 'no-key' with a problem whose fix is in Settings › Models. */
  code: string | null
}

export interface WorldBuilderApi {
  /** The page's state for the open world: the summary kept, a build running, the last one finished. */
  getWorldBuilder(): Promise<WorldBuilderState>
  /** Keeps the summary in the world as Adam types, so the page reopens with it. */
  saveWorldSummary(summary: string): Promise<void>
  /** Roughly what building from this summary would cost with the World builder model. Says so in `problem` when there is no model. */
  estimateWorldBuild(input: { summary: string; storyId: ID | null }): Promise<WorldBuildEstimate>
  /** Keeps the summary and starts a build in the background (one at a time); its events say how it goes. */
  startWorldBuild(input: WorldBuildInput): Promise<void>
  /** Cancels a build. What it has saved stays (one Undo removes it). Resolves once it has stopped. */
  cancelWorldBuild(buildId: ID): Promise<void>
  /** Undoes everything a build made that is still there, in one go. Returns the lines it undid, for redoWorldBuild. */
  undoWorldBuild(runId: ID): Promise<{ lineIds: ID[] }>
  /** Brings back what undoWorldBuild took away (the Undo on its toast). */
  redoWorldBuild(runId: ID, lineIds: ID[]): Promise<void>
  /** "Interview me": asks the World builder model for the next question about the summary as it stands. Stop is stopTask(taskId). */
  askWorldQuestion(input: WorldInterviewInput): Promise<WorldInterviewQuestion>
}

export interface WorldBuilderEvents {
  'worldBuilder:progress': WorldBuildProgress
  'worldBuilder:done': WorldBuildDone
}

// ---------- "Interview me" ----------
// The AI asks one short question at a time about what the summary is missing or thin on. Each answer is
// added to the summary by the interface, in Adam's own words under the question's topic ("Setting: ..."),
// with no AI call, and kept as the summary always is (saveWorldSummary). Nothing else about an interview is
// stored. Each question is one 'world' generation record, run by the shared task runner (task:* events).

/** A question asked earlier in the same interview. */
export interface WorldInterviewAsked {
  topic: string
  question: string
  /** Skipped rather than answered (its topic isn't asked about again). */
  skipped: boolean
}

export interface WorldInterviewInput {
  /** Made by the interface (any unique id), so the question can be stopped with stopTask. */
  taskId: ID
  /** The summary as it stands now, Adam's answers included. */
  summary: string
  /** The questions asked so far in this interview, oldest first. */
  asked: WorldInterviewAsked[]
}

export interface WorldInterviewQuestion {
  /** 'stopped' (Stop, or the world closed) and 'error' carry no question. */
  status: 'complete' | 'stopped' | 'error'
  /** What the question is about, in a few words ("Setting", "Mara's goal"): the label his answer goes under. */
  topic: string
  /** One short question, in plain words. */
  question: string
  /** Plain words with a next step, when status is 'error'. */
  error: string | null
  /** Its record, for "What the AI saw". */
  generationId: ID
}
