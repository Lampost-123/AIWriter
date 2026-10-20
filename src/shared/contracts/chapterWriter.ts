// Write the whole chapter (Adam, 2026-10-10; reworked 2026-10-19, spec "Write the chapter, reworked"): the AI plans the
// whole chapter first (an agent reads the chapter card and the scene cards and looks up what it needs: what each scene
// must do, which threads move on, what changes for each person), shows Adam the plan, which he may change, then writes
// every scene in order against its part of the plan. A state check compares each scene with the plan and the story so
// far (free checks first, then one short AI call), the critic reads the chapter once for craft, and only what they flag
// is fixed: one passage at a time, in the writer's voice, a whole scene written again only when it misses its plan. It
// stops when clean, on Stop, at the monthly spending limit, when a round makes no progress, or at CHAPTER_WRITER_LIMITS
// (what is left then is listed for Adam).
//
// Every scene's words before the run are kept (with the report, and in History), so one Undo puts the chapter back.
// The scenes being worked on can't be typed in meanwhile: the page holds them and follows each change.
import type { ID } from '../types'

/**
 * How far one run goes (live test, 2026-10-16: with no cap it took 14 rounds and 2 hours on one chapter, and most of the
 * test's cost). At most `fixRounds` rounds of fixing what the checks and the critic found (Adam's spec, 2026-10-19: 2),
 * each problem tried at most twice; no new round of fixing starts after `minutes` of work (the time Adam takes over the
 * plan isn't counted). Whatever is still open then is listed in the report, and in the Issues and Critique tabs. The
 * start dialog says so.
 */
export const CHAPTER_WRITER_LIMITS = { fixRounds: 2, minutes: 60 } as const

/**
 * Where a run is. Since 2026-10-19: 'planning' (the chapter plan), 'review' (the plan waits for Adam), 'drafting',
 * 'checking' and 'fixing'. 'study', 'reviewing' and 'proofreading' were the earlier flow's.
 */
export type ChapterWriterStage = 'planning' | 'review' | 'drafting' | 'checking' | 'fixing' | 'study' | 'reviewing' | 'proofreading'

/** One scene's part of the chapter plan. */
export interface ChapterWritingPlanScene {
  sceneId: ID
  /** "Sc 2 “The ferry”". */
  label: string
  /** What the scene must do in the chapter, in a sentence or two. */
  does: string
  /** The plot threads it moves on, and how. */
  threads: string[]
  /** What changes for each person: where they end up, what they learn. */
  changes: { who: string; change: string }[]
  /** Facts the scene keeps to that its card doesn't say (from the look-ups). */
  keep: string[]
  /**
   * How the scene ends, in a short line: where it leaves the people in it ("Wren soaked to the knee, boots off by the
   * fire"). Shown as "Ends with: …" in the plan Adam reads (Build with AI, 2026-10-20). Left out of older plans.
   */
  ends?: string
  /** The part as the writer is given it, and as Adam reads and changes it. */
  text: string
  /** Adam changed it before writing: `text` is his. */
  changed?: boolean
}

/** The chapter plan: made before any scene is written, shown to Adam, and each scene written against its part. */
export interface ChapterWritingPlan {
  /** What the chapter does, in a few lines. */
  overview: string
  /**
   * What the chapter does, in three parts (Build with AI's plan review, 2026-10-20): whose chapter it is (a name the
   * codex has, usually the point of view), what they want in it, what is against them, and how it turns. Each '' or
   * left out when the planner didn't say (and in plans made before), and the review shows the overview instead.
   */
  lead?: string
  wants?: string
  against?: string
  turn?: string
  /**
   * Facts the plan holds to, each with where it was set ("Ash: burn on the left forearm (since Ch 1, Sc 2)"): the story
   * index's, as the chapter begins, then the scenes' own Keep to lines; no AI call of their own. Left out of older plans.
   */
  kept?: string[]
  /**
   * A name for the chapter, in the style of the story's other chapters (Adam, 2026-10-20: "picking a name that fits the
   * story's other chapters"). Only for a chapter whose title is just its number ("Chapter 3", or none); Adam may change
   * it or clear it before writing. Left out otherwise, and in older plans.
   */
  title?: string
  scenes: ChapterWritingPlanScene[]
  /** Things in Adam's cards that don't fit the story so far (his cards are never changed). */
  questions: string[]
}

/** Adam's word on the plan: write to it (with his changes to any scene's part), or cancel. */
export interface ChapterPlanAnswer {
  runId: ID
  /** Each scene part Adam changed, as its new text. Left out or empty: the plan as it was. */
  scenes?: { sceneId: ID; text: string }[]
  /** A new overview, when he changed it. */
  overview?: string
  /** What the chapter does, in its three parts, each when he changed it. */
  wants?: string
  against?: string
  turn?: string
  /** The chapter's name as Adam kept it, when the plan named the chapter: '' keeps the title it has. Left out: the plan's. */
  title?: string
}

/**
 * Roughly how long writing the chapter takes and what it costs, from the plan on (Build with AI's plan review,
 * chapterWriter/estimate.ts): the drafts, the memory reading each one, each scene's plan and check, a fix or so, and the
 * critic. `cost` null: a model in use has no price (the review says "cost not known"); `free`: every model is free.
 */
export interface ChapterWriterEstimate {
  minutes: number
  cost: number | null
  free: boolean
}

export interface ChapterWriterProgress {
  runId: ID
  chapterId: ID
  stage: ChapterWriterStage
  /** The scene being worked on, if any. */
  sceneId: ID | null
  /** What it is doing, in a few plain words: "Writing Sc 2 of 4", "Checking the chapter, round 2". */
  note: string
  /** Rounds of checking so far (0 while planning and drafting). */
  round: number
  /** What the run has cost so far, in dollars (what is known). */
  cost: number
  /** The scenes being worked on (the page holds these). */
  sceneIds: ID[]
  /** While `stage` is 'review': the chapter plan waiting for Adam (answerChapterPlan). */
  plan?: ChapterWritingPlan | null
  /** While `stage` is 'review': roughly how long writing it takes and what it costs (null: can't say). */
  estimate?: ChapterWriterEstimate | null
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

/** 'cancelled': Adam cancelled at the plan, before anything was written. */
export type ChapterWriterStatus = 'running' | 'done' | 'stopped' | 'stuck' | 'limit' | 'error' | 'cancelled'

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
  /** The chapter plan the scenes were written to, as text (before 2026-10-19: the study's brief). */
  brief: string
  /** The chapter plan itself (left out of reports kept before it was added). */
  plan?: ChapterWritingPlan
  /** Things in the scene cards that don't fit the memory, for Adam (his cards are never changed). */
  questions: string[]
  scenes: ChapterWriterSceneReport[]
  /** What was still open when it ended (only when it didn't finish clean). */
  left: string[]
  /**
   * Things for Adam to look at that the run couldn't put right itself, in plain words: a scene after the chapter (or one
   * without a card) that may no longer follow on from it, and anything a scene's draft said about how it was written
   * (where things stand wasn't ready, say). Left out of reports kept before it was added.
   */
  notes?: string[]
  /**
   * The name the run gave the chapter (it had only its number), and its title before, so Undo can put that back. Left out
   * when it gave none, and in reports kept before it was added.
   */
  named?: { from: string; to: string }
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
  /**
   * Adam's word on the chapter plan the run is waiting with (progress stage 'review'): write the chapter to it, with any
   * scene's part he changed. Cancel is stopChapterWriter (nothing has been written then).
   */
  answerChapterPlan(answer: ChapterPlanAnswer): Promise<void>
  /** The latest run's report for a chapter, or null. */
  getChapterWriterReport(chapterId: ID): Promise<ChapterWriterReport | null>
  /**
   * Puts every scene of the chapter back as it was before the latest run, and the chapter's title when the run named it
   * and the name is still the run's. Returns how many scenes changed, and whether the title was put back.
   */
  undoChapterWriter(chapterId: ID): Promise<{ restored: number; renamed?: boolean }>
}

export interface ChapterWriterEvents {
  'chapterWriter:progress': ChapterWriterProgress
  /** A scene's words changed (drafted, fixed, proofread or put back): an open page shows the new words. */
  'chapterWriter:sceneChanged': { runId: ID; sceneId: ID; doc: unknown; text: string }
  'chapterWriter:done': { runId: ID; chapterId: ID; report: ChapterWriterReport }
}
