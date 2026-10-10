// Write the whole chapter (Adam, 2026-10-10): the AI drafts every scene of a chapter from its scene cards, then works
// on the chapter by itself until it is right. An agent (a model with tools) studies the chapter before writing, looks
// things up in the memory (codex entries, Recall, the canon timeline, the story so far), reads what the consistency
// checks and the craft critic find, fixes the words straight in, rewrites a scene when it is wrong at its core, sets
// aside a finding it can show is wrong, and proofreads. The app, not the agent, decides when it is done: it runs the
// checks and the critic again itself, and the chapter is finished only when they come back clean, or every finding
// left has been answered with a reason the app accepted. No round cap: it stops when clean, on Stop, at the monthly
// spending limit, or when a round makes no progress.
//
// Every scene's words before the run are kept (with the report, and in History), so one Undo puts the chapter back.
// The scenes being worked on can't be typed in meanwhile: the page holds them and follows each change.
import type { ID } from '../types'

/** Where a run is. */
export type ChapterWriterStage = 'study' | 'drafting' | 'reviewing' | 'checking' | 'proofreading'

export interface ChapterWriterProgress {
  runId: ID
  chapterId: ID
  stage: ChapterWriterStage
  /** The scene being worked on, if any. */
  sceneId: ID | null
  /** What it is doing, in a few plain words: "Writing Sc 2 of 4", "Checking the chapter, round 2". */
  note: string
  /** Rounds of checking so far (0 while studying and drafting). */
  round: number
  /** What the run has cost so far, in dollars (what is known). */
  cost: number
  /** The scenes being worked on (the page holds these). */
  sceneIds: ID[]
}

/** One scene of the chapter, as the start dialog lists it. */
export interface ChapterWriterScene {
  sceneId: ID
  /** "Sc 2: The ferry". */
  label: string
  /** It has words now (they will be replaced; History keeps them). */
  hasWords: boolean
  /** Its card says enough to write from (a goal, beats, an outcome or a summary). */
  ready: boolean
}

export interface ChapterWriterPlan {
  chapterId: ID
  /** "Chapter 3: The crossing". */
  title: string
  scenes: ChapterWriterScene[]
  /** Another run is going (this chapter or another), so Start waits. */
  busy: boolean
}

export interface ChapterWriterFix {
  /** What was wrong, in plain words. */
  why: string
  /** The new words, the start of them for a long change. */
  words: string
}

export interface ChapterWriterSetAside {
  /** What a check or the critic said. */
  finding: string
  /** Why the AI judged it not a problem. */
  why: string
  /** The issue it set aside (Ignored in the Issues tab, where it can be reopened). */
  issueId: ID | null
}

export interface ChapterWriterSceneReport {
  sceneId: ID
  label: string
  /** Each change made after the draft. */
  fixed: ChapterWriterFix[]
  /** Findings judged not a problem. */
  setAside: ChapterWriterSetAside[]
  /** Rewritten from the card again, with why. */
  rewritten: string[]
}

export type ChapterWriterStatus = 'running' | 'done' | 'stopped' | 'stuck' | 'limit' | 'error'

export interface ChapterWriterReport {
  runId: ID
  chapterId: ID
  status: ChapterWriterStatus
  /** Said when it ended other than done: what went wrong or why it stopped, in plain words. */
  message: string
  startedAt: string
  endedAt: string | null
  rounds: number
  cost: number
  /** What the study found: the plan the scenes were written to, in the agent's words. */
  brief: string
  /** Things in the scene cards that don't fit the memory, for Adam (his cards are never changed). */
  questions: string[]
  scenes: ChapterWriterSceneReport[]
  /** What was still open when it ended (only when it didn't finish clean). */
  left: string[]
  /** The agent's own last words on the chapter. */
  summary: string
  /** True once Undo has put the chapter back. */
  undone: boolean
}

export interface ChapterWriterStartInput {
  /** Made by the window (any unique id). */
  runId: ID
  chapterId: ID
}

export interface ChapterWriterApi {
  /** The chapter's scenes as the start dialog shows them. */
  chapterWriterPlan(chapterId: ID): Promise<ChapterWriterPlan>
  /**
   * Starts writing the chapter in the background; its events say how it goes. Throws (plain words) only before it
   * starts: no scenes ready, another run going, a draft being written in one of its scenes, no model.
   */
  startChapterWriter(input: ChapterWriterStartInput): Promise<{ runId: ID }>
  /** Stops a run: the call under way stops, the words written so far stay (Undo still puts the chapter back). */
  stopChapterWriter(runId: ID): Promise<void>
  /** The run going now, if any (a window that reloads picks it up). */
  chapterWriterNow(): Promise<ChapterWriterProgress | null>
  /** The latest run's report for a chapter, or null. */
  getChapterWriterReport(chapterId: ID): Promise<ChapterWriterReport | null>
  /** Puts every scene of the chapter back as it was before the latest run. Returns how many scenes changed. */
  undoChapterWriter(chapterId: ID): Promise<{ restored: number }>
}

export interface ChapterWriterEvents {
  'chapterWriter:progress': ChapterWriterProgress
  /** A scene's words changed (drafted, fixed, proofread or put back): an open page shows the new words. */
  'chapterWriter:sceneChanged': { runId: ID; sceneId: ID; doc: unknown; text: string }
  'chapterWriter:done': { runId: ID; chapterId: ID; report: ChapterWriterReport }
}
