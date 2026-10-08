// The character builder and the lighter builders for places, groups and items (milestone 3).
// Owned by the Builder part. See docs/ARCHITECTURE.md, "Milestone 3".
//
// Every AI action here streams and can be stopped: a start call begins the work and returns at once,
// 'builder:progress' events carry what has arrived so far (about every 40 ms), and 'builder:done'
// says how it ended. The interface makes each job's id, so no event can arrive before it knows it.
// Nothing the AI suggests is saved until Adam keeps it, except Quick start, which builds and saves
// the whole profile in one click: Adam's own words as his (origin 'adam'), the rest as 'ai'.
import type { Entry, ID, Origin } from '../types'

/** Entry kinds that have a builder. */
export type BuilderKind = 'character' | 'place' | 'group' | 'item'

/** Where the builder was opened from, so it can start with Adam's words already in place. */
export interface BuilderStart {
  /** Notes to start Quick start with (a passage Adam selected in a scene, say). */
  notes?: string
  /** The scene the notes came from. */
  sceneId?: ID | null
  /** 'quick' opens Quick start; 'guided' the first step. */
  mode?: 'quick' | 'guided'
  /** The step to open at (an entry's dossier opens its builder at the part Adam asked the AI about). */
  step?: string
}

/**
 * A profile as the builder shows it, by key: the entry's own 'name', 'aliases' (separated by
 * commas), 'summary' and 'description', and its kind's field keys (src/shared/fields.ts).
 */
export type BuilderValues = Record<string, string>

export type BuilderJob = 'quick-start' | 'flesh-out' | 'options' | 'interview'

export interface QuickStartInput {
  /** Made by the interface (any unique id), so every event for the job can be matched to it. */
  jobId: ID
  kind: BuilderKind
  /** Whatever Adam knows, from one line to rough notes, or a passage from a scene. */
  notes: string
  /** The story Adam is working in (decides where the new entry first exists). */
  storyId?: ID | null
  /** The scene a passage came from: the notes are then that passage. */
  sceneId?: ID | null
  /**
   * Finish the rest: the entry an earlier Quick start saved before it stopped part way (the connection
   * dropped, say). Only its empty fields are filled; what it holds stays as it is.
   */
  entryId?: ID | null
}

export interface FleshOutInput {
  jobId: ID
  kind: BuilderKind
  /** The entry, once it exists (null while it has no name yet). */
  entryId: ID | null
  /** The profile as it is on screen, Adam's unsaved typing included. */
  values: BuilderValues
  /** The step's keys: suggestions come only for the ones that are empty. */
  keys: string[]
  /** The story Adam is working in (its style guide applies). */
  storyId?: ID | null
}

export interface OptionsInput {
  jobId: ID
  kind: BuilderKind
  entryId: ID | null
  values: BuilderValues
  /** The one field to offer three alternatives for. */
  key: string
  storyId?: ID | null
}

export interface InterviewTurn {
  from: 'adam' | 'character'
  text: string
}

export interface InterviewInput {
  jobId: ID
  entryId: ID | null
  /** The character's profile as it is on screen. */
  values: BuilderValues
  /** The conversation so far (it isn't stored in the world). */
  turns: InterviewTurn[]
  /** What Adam asks now. */
  question: string
  storyId?: ID | null
}

/** What a job has produced so far. */
export interface BuilderProgress {
  jobId: ID
  job: BuilderJob
  /**
   * Quick start: every field that has fully arrived (Adam's words win over the AI's for the same
   * field). Flesh out: the suggestions that have fully arrived, only for the step's empty fields.
   */
  values: BuilderValues
  /** The field being written right now and its text so far (not saved, not kept on Stop). */
  writing: { key: string; text: string } | null
  /** Quick start: the keys that hold Adam's own words, copied as he wrote them. */
  fromNotes: string[]
  /** Quick start: the entry, once it has a name and has been saved. */
  entryId: ID | null
  /** Give me options: the alternatives so far (the last may still be arriving). */
  options: string[]
  /** Interview: the character's reply so far. */
  text: string
}

export interface BuilderDone extends BuilderProgress {
  /** 'stopped' keeps what had fully arrived, and so does 'error' once Quick start has saved the entry (`entryId`). */
  status: 'complete' | 'stopped' | 'error'
  /** Plain words with a next step, when status is 'error'. */
  error: string | null
}

export interface BuilderApi {
  /**
   * Quick start: builds the whole profile from Adam's notes and saves it, made by Adam (so it is never
   * moved to the Trash automatically) as soon as it has a name. Fields that copy his words are his;
   * the rest are marked "drafted by AI" and update themselves if the story later says otherwise.
   * With `entryId`, finishes one that stopped part way, filling only its empty fields.
   * Uses the writer model; refuses in plain words when there is none (code 'no-writer-model' or 'no-key').
   */
  startQuickStart(input: QuickStartInput): Promise<void>
  /** Flesh out: suggestions for one step's empty fields. Nothing is saved until Adam keeps one. */
  startFleshOut(input: FleshOutInput): Promise<void>
  /** Give me options: exactly three alternatives for one field. Nothing is saved until Adam picks one. */
  startOptions(input: OptionsInput): Promise<void>
  /** Interview: the character answers Adam's question in character. */
  startInterview(input: InterviewInput): Promise<void>
  /** Stops a job; what has fully arrived is kept. Resolves once it has finished. Does nothing for a job that has ended. */
  stopBuilder(jobId: ID): Promise<void>
  /**
   * Makes the entry a guided build has been filling in, once it has a name (made by Adam). `aiKeys`
   * are the fields he kept from the AI's suggestions: they are marked "drafted by AI".
   */
  createBuilderEntry(input: { kind: BuilderKind; values: BuilderValues; aiKeys: string[]; storyId?: ID | null }): Promise<Entry>
  /**
   * Saves AI suggestions Adam kept, marked "drafted by AI". Never writes over a field holding Adam's
   * own words, unless `replace` (he picked one of the options for that field himself).
   */
  keepSuggestions(entryId: ID, values: BuilderValues, opts?: { replace?: boolean }): Promise<Entry>
  /**
   * Puts one field back as it was, with who made it (Undo after Adam picked an option for it): words
   * read from the story or drafted by AI are theirs again, so the memory keeper goes on keeping them
   * up to date as before. Saved exactly as given.
   */
  restoreBuilderField(entryId: ID, key: string, value: string, origin: Origin): Promise<Entry>
}

export interface BuilderEvents {
  'builder:progress': BuilderProgress
  'builder:done': BuilderDone
  /** Shown while a request is being retried after a rate limit or a server error. */
  'builder:retrying': { jobId: ID; attempt: number; waitMs: number; reason: string }
}
