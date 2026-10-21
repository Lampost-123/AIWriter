// One run of Write the whole chapter (contracts/chapterWriter.ts), as Adam's spec "Write the chapter, reworked"
// (2026-10-19) has it: the whole chapter is planned first, then every scene is written against that plan, and only a
// short list of real problems is fixed, never repeated full read-throughs.
//   1. Plan the chapter (plan.ts): an agent reads the chapter card and the scene cards, looks up what it needs, and writes
//      a part for each scene (what it must do, which threads move on, what changes for each person). Adam reads the plan
//      and may change it (RunDeps.review); left out, the run goes straight on.
//   2. Write each scene in order through the app's writer, with its part of the plan as the scene plan's input
//      (draftBriefing: the scene plan builds on it, with its own round of look-ups); the memory catches up on the scene
//      before first, so each scene is written knowing what the one before now says.
//   3. Check against the plan and the story so far: plain matching first (who the plan has change in the scene and the
//      words never name; stock AI phrases; the free rule checks, with the check), then the state check, one short AI
//      call (checks/: facts, timeline, continuity and who knows what, through the scene's contract made from its plan);
//      the critic reads the chapter once for craft, in the first round.
//   4. Fix only what was flagged (fix.ts): one problem at a time, the flagged passage rewritten in the writer's voice; a
//      scene that misses its part of the plan is written again whole, once. At most CHAPTER_WRITER_LIMITS.fixRounds
//      rounds, each problem tried at most MAX_TRIES times (progress.ts Tries); the changed scenes, and the scene after
//      each, are checked again.
//   5. Hand over: the report lists what was fixed, in plain words, and anything left for Adam.
// A chapter whose title is only its number is given the plan's name (in the style of the story's other chapters, as
// Adam kept it) once he says write, before anything is written; Undo puts its title back while the name is the run's.
// It stops when clean, on Stop, at the spending limit, when a round makes no progress (ProgressGuard), or at
// CHAPTER_WRITER_LIMITS. The words before the run are kept (store.ts) so Undo can put the chapter back.
// No Electron imports: everything outside the world's database comes through RunDeps.

import type Database from 'better-sqlite3'
import type {
  ChapterPlanAnswer,
  ChapterWriterProgress,
  ChapterWriterReport,
  ChapterWriterSceneReport,
  ChapterWriterStage,
  ChapterWriterStatus,
  ChapterWriterEstimate,
  ChapterWriterDoing,
  ChapterWriterSceneProgress,
  ChapterWritingPlan
} from '@shared/contracts/chapterWriter'
import type { CritiqueNote, CritiqueOutcome, CritiqueTarget } from '@shared/contracts/critique'
import type { CheckKind } from '@shared/contracts/checks'
import type { ID, SceneCard, StyleGuide, WritingPrefs } from '@shared/types'
import { countWords } from '@shared/defaults'
import { CHAPTER_WRITER_LIMITS } from '@shared/contracts/chapterWriter'
import { effectiveStyle } from '@shared/style'
import { findSlop } from '@shared/slop'
import { namedInProse } from '@shared/names'
import * as repo from '../db/repo'
import * as cdb from '../db/checks'
import { isLiveKind, type IssuePayload } from '../db/checks'
import { checkedAsIs } from '../checks/report'
import { stopTask, type Emit } from '../ai/tasks'
import type { JobModel } from '../ai/jobModel'
import type { FoundPassage } from '../ai/lookups'
import { settleNote } from '../critique/store'
import { now, UserError } from '../util'
import { sceneWords } from '../ask/agent'
import { cleanProse, dropRepeats, pageFrom, type Page } from './page'
import { findingKey, foldWords, ProgressGuard, Tries, wordsHash, wordsOverlap } from './progress'
import { missedDirection } from './prompts'
import { chapterLine, chapterPlanText, makeChapterPlan, withAnswer } from './plan'
import { fixPassage, type FixDeps } from './fix'
import { loadReport, saveBefore, saveNamed, saveReport, scenesNow } from './store'
import { findingLine, ownTitle, type Finding, type SceneRef } from './tools'

type DB = Database.Database

export interface RunDeps {
  db: DB
  /** The chapter plan's model (the chapter writer model): it must be able to use tools. */
  agentModel: JobModel
  /**
   * The writer model and its sampling (writerTemperature, the creativity preset's top_p and min_p), for the targeted
   * fixes: the flagged passages are rewritten in the writer's voice, with its style guide and sample.
   */
  writer: { model: JobModel; temperature: number; topP: number; minP?: number | null }
  prefs: WritingPrefs
  /** The task runner's events for the run's own calls (the run says how it goes itself). */
  taskEmit: Emit
  /** How the run goes, for the window. */
  progress: (p: ChapterWriterProgress) => void
  /** A scene's words changed. */
  sceneChanged: (sceneId: ID, page: Page) => void
  /**
   * Shows Adam the chapter plan and waits for his word: the answer to write to (with any part he changed), or null to
   * cancel. Ends with null when `signal` is aborted. Left out: the run goes straight on to writing.
   */
  review?: (plan: ChapterWritingPlan, signal: AbortSignal) => Promise<Pick<ChapterPlanAnswer, 'scenes' | 'overview' | 'wants' | 'against' | 'turn' | 'title'> | null>
  /**
   * Gives the chapter the plan's name, the way the binder's renames go. Left out: written straight to the world's
   * database.
   */
  rename?: (chapterId: ID, title: string) => void
  /**
   * Roughly how long writing these scenes takes and what it costs, shown with the plan (estimate.ts); null when it can't
   * say. Left out: none is shown.
   */
  estimate?: (sceneIds: ID[]) => ChapterWriterEstimate | null
  /**
   * Drafts a scene from its card with the app's writer (the memory caught up first). `notes`: its part of the chapter plan
   * (the scene plan builds on it, and the writer is given it); `direction`, for a scene written again. Resolves with its
   * words; `cutOff`: the writer ran into its reply limit; `refused`: it sent back a refusal as words; `note`: something
   * Adam should know about how it was written (where things stand wasn't ready, say), in plain words.
   */
  draft: (
    sceneId: ID,
    o: {
      notes: string
      direction: string
      signal: AbortSignal
      /** The draft's words so far, as they come (now and then, not every word): for the progress card. */
      onWords?: (words: number) => void
      /** Why its request is being tried again (null once it goes on): for the progress card. */
      onRetry?: (reason: string | null) => void
    }
  ) => Promise<{ status: 'complete' | 'stopped' | 'error'; text: string; error: string | null; cutOff?: boolean; refused?: boolean; note?: string | null }>
  /**
   * Waits for the memory to finish reading the scenes before this one and writing their summaries (Adam, 2026-10-17:
   * "always wait"), so the run can say so while it waits. Left out: the draft's own catch-up does it, unsaid.
   */
  catchUp?: (sceneId: ID, signal: AbortSignal) => Promise<unknown>
  /** Saves a scene's new page the way the editor's saves go, after keeping the page before in History. */
  save: (sceneId: ID, page: Page, label: string) => void
  /**
   * The state check of a scene: these checks (the memory caught up first) in one short request, through the scene's
   * contract (made from its plan) where it has one; what they find is saved as issues, with the free rule checks'.
   */
  check: (sceneId: ID, signal: AbortSignal, checks?: CheckKind[]) => Promise<{ status: 'done' | 'empty' | 'stopped' | 'error'; error?: string }>
  /** The craft critic on a scene or the chapter; `again`: a re-read after revisions. */
  critique: (target: CritiqueTarget, again: boolean, signal: AbortSignal) => Promise<CritiqueOutcome>
  /**
   * Whether the critic reads at all (Settings › Models, 2026-10-17, to save on costs): false, the run is checked and
   * fixed by the state check alone. Left out: it reads.
   */
  critic?: () => boolean
  /** Searches the story so far, for the chapter plan's find_in_story; left out: not available. */
  find?: (sceneId: ID, query: string, most: number) => Promise<FoundPassage[] | null>
  /** The monthly spending limit is holding AI calls: what to say, or null. */
  limitNote: () => string | null
  /** True once the world has closed. */
  closed: () => boolean
  fetchImpl?: typeof fetch
  retryDelays?: number[]
  /** The clock, in milliseconds (tests). */
  clock?: () => number
  /**
   * About how many words a scene's draft aims for (its card's, else its share of the chapter's), for the progress card;
   * null when it can't say. Left out: none is said.
   */
  target?: (sceneId: ID) => number | null
}

/** The progress card's live words are passed on at most this often while a scene is drafted. */
const WORDS_EVERY_MS = 700

/** What a run is doing at each stage, unless it says more. */
const DOING_OF: Record<ChapterWriterStage, ChapterWriterDoing> = {
  planning: 'plan',
  review: 'review',
  drafting: 'draft',
  checking: 'check',
  fixing: 'fix',
  study: 'plan',
  reviewing: 'fix',
  proofreading: 'fix'
}

class Stopped extends Error {}
class Failed extends Error {
  constructor(
    message: string,
    readonly status: ChapterWriterStatus = 'error'
  ) {
    super(message)
  }
}

/** Said under a later scene's part of the plan: its start comes from the scene before as written, not from the plan. */
export const LATER_START =
  'Where everyone is as this scene starts, what they wear and hold, and how they are placed, is where the scene before it ends, as written: keep to that, whatever these notes say of it.'

/**
 * The state check (spec, step 3): what is so (facts, the timeline, where everyone is and what they wear and hold) and
 * who knows what, in one request. How it reads is the critic's.
 */
export const STATE_CHECKS: CheckKind[] = ['facts', 'timeline', 'continuity', 'knowledge']

/**
 * What a scene is checked for when the scene before it changed but it didn't (token audit, 2026-10-19): what is so, which
 * a changed ending can break; who knows what is its own words', checked when they change.
 */
export const FOLLOW_ON_CHECKS: CheckKind[] = ['facts', 'timeline', 'continuity']

/** The most stock AI phrases a freshly written scene has said another way (the plain check that took the proofread's place). */
export const PHRASES_MOST = 2

/** A scene that misses its part of the plan is written again whole at most this many times in a run. */
export const REWRITES_MOST = 1

/** A card says enough to write a scene from it. */
export const cardReady = (c: SceneCard | null | undefined): boolean =>
  !!c && [c.goal, c.conflict, c.outcome, c.notes, ...(c.beats ?? [])].some((v) => typeof v === 'string' && v.trim() !== '')

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s)
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** The chapter's scenes, each with its label and whether its card is ready. */
export function chapterScenes(db: DB, chapterId: ID): { ref: SceneRef; ready: boolean; words: number }[] {
  const chapter = repo.getChapter(db, chapterId)
  const outline = repo.getOutline(db, chapter.storyId)
  const scenes = outline.scenes.filter((s) => s.chapterId === chapterId)
  const cards = repo.sceneCards(
    db,
    scenes.map((s) => s.id)
  )
  return scenes.map((s, i) => {
    const title = s.title.trim()
    return {
      ref: { id: s.id, n: i + 1, title, label: `Sc ${i + 1}${title ? ` “${title}”` : ''}` },
      ready: cardReady(cards.get(s.id)),
      words: s.wordCount
    }
  })
}

/** The chapter's place and title: "Ch 3 “The crossing”". */
export function chapterLabel(db: DB, chapterId: ID): string {
  const chapter = repo.getChapter(db, chapterId)
  const n = repo.getOutline(db, chapter.storyId).chapters.findIndex((c) => c.id === chapterId) + 1
  const title = ownTitle(chapter.title)
  return `Ch ${n}${title ? ` “${title}”` : ''}`
}

/**
 * The scene after this one in its story that has words: the one whose opening follows on from this one's end. An empty
 * scene between is passed over, as the scene after it looks back past it (memory/line.ts previousSceneStep). Null at
 * the story's end.
 */
export function sceneAfter(db: DB, sceneId: ID): ID | null {
  const { story } = repo.sceneLocation(db, sceneId)
  const scenes = repo.getOutline(db, story.id).scenes
  const at = scenes.findIndex((s) => s.id === sceneId)
  if (at < 0) return null
  return scenes.slice(at + 1).find((s) => s.wordCount > 0)?.id ?? null
}

/** Where a scene is in its story, for the report: "Ch 4, Sc 1 “The road”". */
export function placeLabel(db: DB, sceneId: ID): string {
  const { story } = repo.sceneLocation(db, sceneId)
  const outline = repo.getOutline(db, story.id)
  const scene = outline.scenes.find((s) => s.id === sceneId)
  const ch = outline.chapters.findIndex((c) => c.id === scene?.chapterId)
  const sc = outline.scenes.filter((s) => s.chapterId === scene?.chapterId).findIndex((s) => s.id === sceneId)
  // A title that only says "Scene 2" isn't said twice.
  const title = /^\s*(scene\s+[\w-]+|untitled scene)\s*$/i.test(scene?.title ?? '') ? '' : (scene?.title.trim() ?? '')
  return `Ch ${ch + 1}, Sc ${sc + 1}${title ? ` “${title}”` : ''}`
}

export { ownTitle }

export class ChapterRun {
  private readonly controller = new AbortController()
  private currentTask: ID | null = null
  private stage: ChapterWriterStage = 'planning'
  private note = ''
  private sceneNow: ID | null = null
  private doing: ChapterWriterDoing = 'plan'
  /** The progress card: each scene's words once written by this run, the words so far of the one being drafted. */
  private readonly wordsOf = new Map<ID, number>()
  private liveWords = 0
  private lastWordsAt = 0
  private readonly targets = new Map<ID, number | null>()
  private retrying: string | null = null
  private fixAt: { at: number; of: number } | null = null
  /** When writing began (after the plan), Date.now(). */
  private writingMs: number | null = null
  private readonly startedMs = Date.now()
  private round = 0
  private readonly startedAt = now()
  private readonly startedClock: number
  /** Time spent waiting for Adam over the plan: not counted against CHAPTER_WRITER_LIMITS.minutes. */
  private waited = 0
  private refs: SceneRef[] = []
  private storyId: ID = ''
  private label = ''
  private plan: ChapterWritingPlan | null = null
  /** How long writing takes and what it costs, worked out as the plan is shown. */
  private estimate: ChapterWriterEstimate | null = null
  /** The run has begun writing (before that, Stop or Cancel at the plan changed nothing). */
  private writing = false
  private readonly findings: Finding[] = []
  private findingCount = 0
  /** What has been given to the AI to fix (progress.ts). */
  private readonly tries = new Tries()
  /** Findings left for Adam: the latest round's. */
  private leftOver: Finding[] = []
  /** Of those, the ones left because they came back after their tries (the rest couldn't be placed, or a scene was written again). */
  private readonly cameBack = new Set<string>()
  /** The new words the run's fixes and rewrites put in each scene. */
  private readonly written = new Map<ID, string[]>()
  /** How many times each scene was written again for missing its plan. */
  private readonly rewrites = new Map<ID, number>()
  /** Rounds of fixing so far (CHAPTER_WRITER_LIMITS.fixRounds). */
  private fixRounds = 0
  /** The critic's notes from its one read of the chapter, and that critique's time. */
  private chapterNotes: CritiqueNote[] = []
  private critiqueAt = ''
  /** What the critic said that the run doesn't act on (small notes, notes on the chapter as a whole), for Adam. */
  private criticNote = ''
  /** What Adam should know about how each scene was drafted (draft's `note`), by scene. */
  private readonly draftNotes = new Map<ID, string>()
  /**
   * Scenes after the chapter's (or of it, without a card) that the run checks but never changes: the issues open there
   * before the run first looked (the author's already), and what its checks found since, as lines for the report.
   */
  private readonly outsideBefore = new Map<ID, Set<ID>>()
  private readonly outsideNotes = new Map<ID, string[]>()
  readonly report: ChapterWriterReport

  constructor(
    private readonly d: RunDeps,
    readonly runId: ID,
    readonly chapterId: ID
  ) {
    this.startedClock = this.clock()
    this.report = {
      runId,
      chapterId,
      status: 'running',
      message: '',
      startedAt: this.startedAt,
      endedAt: null,
      rounds: 0,
      cost: 0,
      brief: '',
      questions: [],
      scenes: [],
      left: [],
      notes: [],
      summary: '',
      undone: false
    }
  }

  private clock(): number {
    return this.d.clock?.() ?? Date.now()
  }

  /** The scenes being worked on (the page holds these). */
  get sceneIds(): ID[] {
    return this.refs.map((r) => r.id)
  }

  /** True when the run works on this database (the world it was started in). */
  dbIs(db: DB): boolean {
    return this.d.db === db
  }

  get stopped(): boolean {
    return this.controller.signal.aborted
  }

  /** Stops the run: the call under way stops; what was saved stays. While the plan waits for Adam, this is Cancel. */
  async stop(): Promise<void> {
    this.controller.abort()
    const t = this.currentTask
    if (t) await stopTask(t).catch(() => undefined)
  }

  /**
   * Checks the chapter can be written and keeps its words as they are (for Undo). Throws (plain words) when it can't
   * start. Call before `run`.
   */
  prepare(): void {
    const { db } = this.d
    const chapter = repo.getChapter(db, this.chapterId)
    this.storyId = chapter.storyId
    this.label = chapterLabel(db, this.chapterId)
    const scenes = chapterScenes(db, this.chapterId)
    if (!scenes.length) throw new UserError('This chapter has no scenes yet. Add scenes with scene cards first.')
    this.refs = scenes.filter((s) => s.ready).map((s) => s.ref)
    if (!this.refs.length) {
      throw new UserError("None of this chapter's scenes has a scene card to write from yet. Give each scene a goal, beats or an outcome first.")
    }
    this.report.scenes = this.refs.map((r) => ({ sceneId: r.id, label: r.label, fixed: [], setAside: [], rewritten: [] }))
    for (const r of this.refs) {
      try {
        this.targets.set(r.id, this.d.target?.(r.id) ?? null)
      } catch {
        this.targets.set(r.id, null)
      }
    }
    saveBefore(db, this.chapterId, scenesNow(db, this.sceneIds))
    // An earlier run's name for the chapter is that run's: this run's Undo puts back only what this run did.
    saveNamed(db, this.chapterId, null)
    saveReport(db, this.report)
  }

  /** Runs to the end. Never throws: how it ended is in the report. */
  async run(): Promise<ChapterWriterReport> {
    try {
      await this.planChapter()
      await this.reviewPlan()
      this.nameChapter()
      await this.draftAll()
      await this.rounds()
    } catch (e) {
      const limit = e instanceof Failed ? null : this.d.limitNote()
      if ((e instanceof Stopped || this.stopped) && !this.writing) {
        // Stopped while planning, or Cancel at the plan: nothing in the chapter changed.
        this.report.status = 'cancelled'
        this.report.message = 'Cancelled before writing: nothing in the chapter changed.'
      } else if (e instanceof Stopped || this.stopped) {
        this.report.status = 'stopped'
        this.report.message = 'Stopped. The words written so far are kept; Undo puts the chapter back as it was.'
      } else if (limit) {
        // A call refused as it was recorded (usage/gate.ts): the monthly limit, said in its own words.
        this.report.status = 'limit'
        this.report.message = `Stopped: ${limit}`
      } else if (e instanceof Failed) {
        this.report.status = e.status
        this.report.message = e.message
      } else if (e instanceof UserError) {
        this.report.status = 'error'
        this.report.message = e.message
      } else {
        console.error('The chapter writer failed', e)
        this.report.status = 'error'
        this.report.message = `Something went wrong: ${(e as Error)?.message ?? e}. The words written so far are kept; Undo puts the chapter back as it was.`
      }
      const open = [...this.findings.filter((f) => f.status === 'open'), ...this.leftOver]
      if (open.length && this.report.status !== 'done') this.report.left = open.map((f) => findingLine(f, this.refs))
    }
    this.report.endedAt = now()
    this.report.cost = this.cost()
    if (this.d.db.open && !this.d.closed()) {
      try {
        saveReport(this.d.db, this.report)
      } catch (e) {
        console.warn('Could not keep the chapter writer’s report', e)
      }
    }
    return this.report
  }

  // ---------- Progress ----------

  private tell(stage: ChapterWriterStage, note: string, sceneId: ID | null = null, doing?: ChapterWriterDoing): void {
    this.stage = stage
    this.note = note
    this.sceneNow = sceneId
    this.doing = doing ?? DOING_OF[stage]
    this.retrying = null
    if (this.doing !== 'fix') this.fixAt = null
    this.d.progress(this.progressNow())
  }

  /** The scene being drafted has more words: passed on now and then. */
  private onWords = (words: number): void => {
    this.liveWords = words
    const t = Date.now()
    if (t - this.lastWordsAt < WORDS_EVERY_MS) return
    this.lastWordsAt = t
    if (!this.stopped) this.d.progress(this.progressNow())
  }

  /** The run's own calls' events go where the deps say; a call being tried again, or going on, is said on the card. */
  private taskEmit: Emit = ((event: string, payload: { reason?: string }) => {
    if (event === 'task:retrying') this.onRetry(payload.reason || 'The AI didn’t answer')
    else if (event === 'task:progress' || event === 'task:done') this.onRetry(null)
    ;(this.d.taskEmit as (e: string, p: unknown) => void)(event, payload)
  }) as Emit

  /** A call is being tried again (or has gone on): passed on at once. */
  private onRetry = (reason: string | null): void => {
    if ((reason ?? null) === this.retrying) return
    this.retrying = reason ?? null
    if (!this.stopped) this.d.progress(this.progressNow())
  }

  /** Each scene of the run as the progress card lists it. */
  private sceneProgress(): ChapterWriterSceneProgress[] {
    const drafting = this.doing === 'draft' || this.doing === 'rewrite'
    return this.refs.map((r) => {
      const done = this.wordsOf.get(r.id)
      const now = drafting && this.sceneNow === r.id
      return {
        sceneId: r.id,
        label: r.label,
        state: now ? 'writing' : done !== undefined ? 'written' : 'waiting',
        words: now ? this.liveWords : (done ?? 0),
        target: this.targets.get(r.id) ?? null
      }
    })
  }

  progressNow(): ChapterWriterProgress {
    return {
      runId: this.runId,
      chapterId: this.chapterId,
      stage: this.stage,
      sceneId: this.sceneNow,
      note: this.note,
      round: this.round,
      cost: this.cost(),
      sceneIds: this.sceneIds,
      plan: this.stage === 'review' ? this.plan : null,
      ...(this.stage !== 'planning' ? { estimate: this.estimate } : {}),
      doing: this.doing,
      scenes: this.sceneProgress(),
      startedMs: this.startedMs,
      writingMs: this.writingMs,
      waitedMs: this.waited,
      retrying: this.retrying,
      fixAt: this.fixAt
    }
  }

  /** What the run has cost so far: every AI call recorded since it started (the memory's reads included). */
  private cost(): number {
    try {
      if (!this.d.db.open) return this.report.cost
      const r = this.d.db.prepare('SELECT COALESCE(SUM(cost), 0) AS c FROM generations WHERE created_at >= ?').get(this.startedAt) as { c: number }
      return Number(r.c) || 0
    } catch {
      return this.report.cost
    }
  }

  private check(): void {
    if (this.stopped || this.d.closed()) throw new Stopped()
  }

  /** A call that failed: the spending limit says so in its own words; anything else stops the run with its error. */
  private failed(error: string | null | undefined): never {
    const limit = this.d.limitNote()
    if (limit) throw new Failed(`Stopped: ${limit}`, 'limit')
    throw new Failed(`${error || 'Something went wrong talking to the AI.'} The words written so far are kept; Undo puts the chapter back as it was.`)
  }

  private onTask = (taskId: ID | null): void => {
    this.currentTask = taskId
  }

  // ---------- 1. The chapter plan ----------

  private async planChapter(): Promise<void> {
    this.check()
    this.tell('planning', `Planning ${this.label}`)
    const r = await makeChapterPlan({
      db: this.d.db,
      storyId: this.storyId,
      chapterId: this.chapterId,
      label: this.label,
      scenes: this.refs,
      prefs: this.d.prefs,
      model: this.d.agentModel,
      signal: this.controller.signal,
      onTask: this.onTask,
      taskEmit: this.taskEmit,
      ...(this.d.find ? { find: this.d.find } : {}),
      fetchImpl: this.d.fetchImpl,
      retryDelays: this.d.retryDelays
    })
    if (r.status === 'stopped' || this.stopped) throw new Stopped()
    if (r.status === 'error') this.failed(r.error)
    this.keepPlan(r.plan)
  }

  private keepPlan(plan: ChapterWritingPlan): void {
    this.plan = plan
    this.report.plan = plan
    this.report.brief = chapterPlanText(plan)
    this.report.questions = plan.questions
    this.save()
  }

  /** Adam reads the plan and may change it; the time he takes isn't counted against the hour. */
  private async reviewPlan(): Promise<void> {
    if (!this.d.review || !this.plan) return
    this.check()
    const at = this.clock()
    try {
      this.estimate = this.d.estimate?.(this.sceneIds) ?? null
    } catch (e) {
      console.warn('Could not work out what writing the chapter costs', e)
      this.estimate = null
    }
    this.tell('review', 'The chapter plan is ready for you to read')
    const answer = await this.d.review(this.plan, this.controller.signal)
    this.waited += this.clock() - at
    if (!answer || this.stopped) throw new Stopped()
    this.keepPlan(withAnswer(this.plan, answer))
  }

  /**
   * The plan's name for a chapter that had only its number (as Adam kept it), saved before anything is written, so the
   * binder, Build with AI and the page head show it; kept with its title before, for Undo (store.ts) and the report. Never
   * over a name the chapter has of its own by now (Adam may have given it one while the plan waited). A rename that
   * fails leaves the title as it was and the run goes on.
   */
  private nameChapter(): void {
    const to = this.plan?.title?.trim() ?? ''
    if (!to) return
    this.check()
    const { db } = this.d
    try {
      const from = repo.getChapter(db, this.chapterId).title
      if (ownTitle(from) || from.trim() === to) return
      if (this.d.rename) this.d.rename(this.chapterId, to)
      else repo.updateChapter(db, this.chapterId, { title: to })
      saveNamed(db, this.chapterId, { from, to })
      this.report.named = { from, to }
      this.label = chapterLabel(db, this.chapterId)
    } catch (e) {
      console.warn('Could not give the chapter its name', e)
      return
    }
    this.save()
  }

  /** A scene's part of the plan, as its draft is given it. */
  private notesFor(sceneId: ID): string {
    const p = this.plan
    if (!p) return ''
    const mine = p.scenes.find((s) => s.sceneId === sceneId)?.text.trim() ?? ''
    // The plan is made before any scene is written, so where everyone is at a later scene's start is only its guess
    // (review, 2026-10-16): the end of the scene before, as now written, says it (the briefing's "Where things stand").
    const later = this.refs.findIndex((r) => r.id === sceneId) > 0 && !!mine
    const chapter = chapterLine(p)
    return [chapter && `The chapter: ${chapter}`, mine, later ? LATER_START : ''].filter(Boolean).join('\n\n')
  }

  private partOf(sceneId: ID): string {
    return this.plan?.scenes.find((s) => s.sceneId === sceneId)?.text.trim() ?? ''
  }

  // ---------- 2. Write each scene ----------

  private async draftAll(): Promise<void> {
    this.check()
    this.writing = true
    this.writingMs = Date.now()
    for (const [i, r] of this.refs.entries()) {
      this.check()
      if (i > 0 && this.d.catchUp) {
        this.tell('drafting', `Updating memory with ${this.refs[i - 1].label} before writing ${r.label}`, r.id, 'memory')
        await this.d.catchUp(r.id, this.controller.signal)
        this.check()
      }
      this.tell('drafting', `Writing ${r.label} (${i + 1} of ${this.refs.length})`, r.id)
      await this.write(r.id, '')
    }
  }

  /** Drafts a scene (again) and saves it. Resolves with its words. */
  private async write(sceneId: ID, direction: string): Promise<string> {
    this.liveWords = 0
    const r = await this.d.draft(sceneId, {
      notes: this.notesFor(sceneId),
      direction,
      signal: this.controller.signal,
      onWords: this.onWords,
      onRetry: this.onRetry
    })
    this.retrying = null
    if (r.status === 'stopped' || this.stopped) throw new Stopped()
    if (r.status === 'error') this.failed(r.error)
    // A draft cut off at the writer's reply limit, or a refusal sent back as words, is never kept as the scene (review,
    // 2026-10-16: both were saved, and the checks then worked on half a scene or on the refusal).
    const label = this.refs.find((x) => x.id === sceneId)?.label ?? 'the scene'
    if (r.cutOff) {
      this.failed(
        `The writer stopped partway through ${label}: it ran out of room to write. Set a shorter length on its scene card, or choose a writer model that can write more in one go in Settings › Models.`
      )
    }
    if (r.refused) {
      this.failed(`The writer model wouldn't write ${label} and sent back a refusal instead. Change its scene card, or choose a different writer model in Settings › Models.`)
    }
    if (r.note?.trim()) this.draftNotes.set(sceneId, `${label}: ${r.note.trim()}`)
    else this.draftNotes.delete(sceneId)
    this.notesNow()
    const prose = cleanProse(r.text)
    if (!prose) this.failed('The writer sent back no words for this scene.')
    const old = repo.getScene(this.d.db, sceneId).doc
    const page = pageFrom(prose, old, 'paragraphs')
    this.saveScene(sceneId, page, direction ? 'Before the chapter writer wrote this scene again' : 'Before the AI wrote this chapter')
    return page.text
  }

  private saveScene(sceneId: ID, page: Page, label: string): void {
    this.check()
    this.d.save(sceneId, page, label)
    this.wordsOf.set(sceneId, countWords(page.text))
    this.liveWords = 0
    this.d.sceneChanged(sceneId, page)
  }

  // ---------- 3–4. Check, then fix what was flagged ----------

  private async rounds(): Promise<void> {
    const guard = new ProgressGuard()
    let changed = new Set(this.sceneIds)
    for (;;) {
      this.check()
      this.round++
      this.report.rounds = this.round
      const { give, leave } = await this.gather(changed)
      this.leftOver = leave
      this.save()
      if (!give.length) return this.finish(leave)
      // How far one run goes (CHAPTER_WRITER_LIMITS): what is open then is listed for Adam.
      const late = this.clock() - this.startedClock - this.waited >= CHAPTER_WRITER_LIMITS.minutes * 60_000
      if (late || this.fixRounds >= CHAPTER_WRITER_LIMITS.fixRounds) return this.capped([...give, ...leave], late)
      // Only after words changed: a round whose fixes changed nothing (the writer's reply couldn't be used) is tried again
      // as it was, within each problem's tries.
      const verdict =
        this.round === 1 || changed.size
          ? guard.round(
              give.map((f) => findingKey(f.sceneId ?? '', f.what, f.quote)),
              wordsHash(this.sceneIds.map((id) => repo.getScene(this.d.db, id).text ?? ''))
            )
          : null
      if (verdict) {
        this.report.left = [...give, ...leave].map((f) => findingLine(f, this.refs))
        throw new Failed(
          `The AI couldn't settle ${things(give.length + leave.length)}: they are listed below, and in the Issues and Critique tabs.`,
          'stuck'
        )
      }
      this.fixRounds++
      changed = await this.fixAll(give)
    }
  }

  /** Clean, or clean but for what was left for Adam. */
  private finish(leave: Finding[]): void {
    this.notesNow()
    this.report.left = leave.map((f) => findingLine(f, this.refs))
    if (!leave.length) {
      this.report.status = 'done'
      this.report.message = ''
      return
    }
    this.report.status = 'stuck'
    const tried = leave.every((f) => this.cameBack.has(f.id))
    this.report.message = tried
      ? `The AI fixed what it could, but ${things(leave.length)} came back after it had tried, so it left ${leave.length === 1 ? 'it' : 'them'} for you: listed below, and in the Issues and Critique tabs.`
      : `The AI fixed what it could and left ${things(leave.length)} for you: listed below, and in the Issues and Critique tabs.`
  }

  /** At the limit of rounds or time, with findings still open: they are listed for Adam. */
  private capped(open: Finding[], late: boolean): void {
    this.notesNow()
    this.report.status = 'stuck'
    this.report.left = open.map((f) => findingLine(f, this.refs))
    const after = late ? `about ${CHAPTER_WRITER_LIMITS.minutes === 60 ? 'an hour' : `${CHAPTER_WRITER_LIMITS.minutes} minutes`} of work` : `${CHAPTER_WRITER_LIMITS.fixRounds} rounds of fixes`
    this.report.message = `The AI stopped after ${after}, as it always does, so it never runs on for hours. ${things(open.length, true)} still open: listed below, and in the Issues and Critique tabs.`
  }

  /**
   * The state check of every scene changed, and the scene after each (a scene's checks look back at the stage before it,
   * never forward: its opening is read against the new end before it, for what is so, FOLLOW_ON_CHECKS); the critic's one
   * read of the chapter in the first round. Returns what to fix this round (numbered) and what is left for Adam. A scene
   * of this chapter after one changed is checked like the rest; one the run doesn't write (the next chapter's first
   * scene, a scene with no card) is checked and what it finds noted for Adam, never changed. A scene already checked as
   * it now is isn't checked again.
   */
  private async gather(changed: Set<ID>): Promise<{ give: Finding[]; leave: Finding[] }> {
    const { db } = this.d
    const first = this.round === 1
    const after = new Set([...changed].map((id) => sceneAfter(db, id)).filter((id): id is ID => !!id && !changed.has(id)))
    for (const r of this.refs) {
      const mine = changed.has(r.id)
      if (!mine && !after.has(r.id)) continue
      if (mine) this.tidy(r.id)
      const checks = mine ? STATE_CHECKS : FOLLOW_ON_CHECKS
      if (!checkedAsIs(db, r.id, checks)) {
        this.check()
        this.tell('checking', mine ? `Checking ${r.label} against the plan, round ${this.round}` : `Checking that ${r.label} still follows on, round ${this.round}`, r.id, mine ? 'check' : 'follow')
        await this.checkScene(r.id, checks)
      }
    }
    for (const id of after) if (!this.sceneIds.includes(id)) await this.checkOutside(id)
    // The critic reads the chapter once, for craft (spec, step 3); never when Adam has switched it off.
    if (first && this.criticOn()) {
      this.check()
      this.tell('checking', `The critic is reading ${this.label}`, null, 'critic')
      const c = await this.critiqueOf({ scope: 'chapter', id: this.chapterId })
      this.chapterNotes = c.notes
      this.critiqueAt = c.at
      this.criticNote = criticWords(c.notes.filter((n) => !this.actsOn(n)))
      this.notesNow()
    }
    // This round's findings take the place of what was still open: fixed or gone ones drop out.
    for (const f of this.findings) if (f.status === 'open') f.status = 'gone'
    const give: Finding[] = []
    const leave: Finding[] = []
    const add = (f: Omit<Finding, 'id' | 'status'>, placeable: boolean): void => {
      const key = findingKey(f.sceneId ?? '', f.what, f.quote)
      if ([...give, ...leave].some((x) => findingKey(x.sceneId ?? '', x.what, x.quote) === key)) return
      const nf: Finding = { ...f, id: this.nextFinding(), status: 'open' }
      // A scene written again once already for missing its plan is not written again: what it still misses is Adam's.
      const rewritten = f.from === 'plan' && (this.rewrites.get(f.sceneId ?? '') ?? 0) >= REWRITES_MOST
      const verdict = this.tries.verdict(f, this.ownWords(f))
      if (verdict === 'skip') return
      if (verdict === 'leave') this.cameBack.add(nf.id)
      if (verdict === 'leave' || !placeable || rewritten) return void leave.push(nf)
      give.push(nf)
      this.findings.push(nf)
    }
    for (const r of this.refs) {
      cdb.sweepGone(db, { sceneId: r.id })
      const text = repo.getScene(db, r.id).text ?? ''
      const s = sceneWords(db, r.id)
      const found = (quote: string): boolean => !!s && !!quote.trim() && foldWords(s.plain).includes(foldWords(quote))
      for (const f of planMisses(db, r.id, this.plan, text)) add(f, true)
      for (const f of contractMisses(db, r.id)) add(f, true)
      for (const f of issueFindings(db, r.id)) add(f, found(f.quote))
      if (first) for (const f of phraseFindings(r.id, text)) add(f, true)
      for (const n of this.carried(r.id)) add(noteFinding(n, r.id, this.critiqueAt, this.chapterId), true)
    }
    return { give, leave }
  }

  /** A critic note the run acts on: of some weight, on words in a scene of the chapter. */
  private actsOn(n: CritiqueNote): boolean {
    return n.weight !== 'low' && !!n.quote.trim() && !!n.sceneId && this.sceneIds.includes(n.sceneId)
  }

  /**
   * The critic's notes on a scene still to deal with: of some weight, not fixed, and their words still there (a note whose
   * words have changed has been acted on).
   */
  private carried(sceneId: ID): CritiqueNote[] {
    const text = foldWords(repo.getScene(this.d.db, sceneId).text ?? '')
    return this.chapterNotes.filter((n) => {
      if (n.sceneId !== sceneId || !this.actsOn(n)) return false
      const key = findingKey(sceneId, n.title, n.quote)
      const dealt = this.findings.some((f) => f.from === 'critic' && f.status === 'fixed' && findingKey(f.sceneId ?? '', f.what, f.quote) === key)
      return !dealt && text.includes(foldWords(n.quote))
    })
  }

  /** The finding is on words the run itself put in. */
  private ownWords(f: Pick<Finding, 'sceneId' | 'quote'>): boolean {
    return !!f.sceneId && !!f.quote.trim() && (this.written.get(f.sceneId) ?? []).some((w) => wordsOverlap(f.quote, w))
  }

  /**
   * Fixes what this round gives, one problem at a time: first each scene that misses its part of the plan is written
   * again whole (its other findings wait for its new words), then each flagged passage is rewritten in the writer's
   * voice. Returns the scenes changed.
   */
  private async fixAll(give: Finding[]): Promise<Set<ID>> {
    const changed = new Set<ID>()
    const rewritten = new Set<ID>()
    for (const r of this.refs) {
      const misses = give.filter((f) => f.sceneId === r.id && f.from === 'plan')
      if (!misses.length) continue
      this.check()
      this.tell('fixing', `Writing ${r.label} again: it missed part of the chapter plan`, r.id, 'rewrite')
      for (const m of misses) this.tries.given(m)
      const text = await this.write(r.id, missedDirection(misses.map((m) => m.what)))
      this.rewrites.set(r.id, (this.rewrites.get(r.id) ?? 0) + 1)
      // Every word of it is the run's now.
      this.written.set(r.id, [text])
      for (const m of misses) m.status = 'fixed'
      this.sceneReport(r.id)?.rewritten.push(clip(misses.map((m) => squash(m.what)).join(' '), 600))
      rewritten.add(r.id)
      changed.add(r.id)
    }
    const fixDeps: FixDeps = {
      db: this.d.db,
      model: this.d.writer.model,
      temperature: this.d.writer.temperature,
      topP: this.d.writer.topP,
      minP: this.d.writer.minP ?? null,
      style: this.style(),
      signal: this.controller.signal,
      onTask: this.onTask,
      taskEmit: this.taskEmit,
      fetchImpl: this.d.fetchImpl,
      retryDelays: this.d.retryDelays
    }
    const passages = give.filter((x) => x.from !== 'plan' && !rewritten.has(x.sceneId ?? ''))
    let at = 0
    for (const r of this.refs) {
      // A scene written again: its other findings wait for the check of its new words (they weren't tried).
      if (rewritten.has(r.id)) continue
      for (const f of give.filter((x) => x.sceneId === r.id && x.from !== 'plan')) {
        this.check()
        this.fixAt = { at: ++at, of: passages.length }
        this.tell('fixing', `Fixing ${r.label}: ${clip(squash(f.what), 80)}`, r.id, 'fix')
        this.tries.given(f)
        const out = await fixPassage(fixDeps, r, f, this.partOf(r.id))
        if (out.status === 'stopped' || this.stopped) throw new Stopped()
        if (out.status === 'error') this.failed(out.error)
        if (out.status === 'unplaced') {
          // Its words are gone (an earlier fix this round may have changed them): the next check says if it still holds.
          f.status = 'gone'
          continue
        }
        if (out.status === 'unusable') continue
        this.saveScene(r.id, out.page, `Before the chapter writer’s fix: ${clip(squash(f.what), 80)}`)
        changed.add(r.id)
        f.status = 'fixed'
        this.written.set(r.id, [...(this.written.get(r.id) ?? []), out.words])
        this.sceneReport(r.id)?.fixed.push({ why: fixWhy(f), words: clip(squash(out.words), 240) })
        if (f.issueId) this.issueFixed(f.issueId)
        if (f.note) this.noteDone(f.note, out.words)
      }
    }
    return changed
  }

  private style(): StyleGuide {
    const { db } = this.d
    return effectiveStyle(this.d.prefs, repo.getWorldStyle(db), repo.getStory(db, this.storyId).style)
  }

  private issueFixed(issueId: ID): void {
    try {
      cdb.setIssueStatus(this.d.db, issueId, 'fixed')
    } catch (e) {
      console.warn('Could not mark an issue fixed', e)
    }
  }

  /** A critic note whose words were rewritten is marked done in the Critique tab, with the new words. */
  private noteDone(note: NonNullable<Finding['note']>, words: string): void {
    try {
      settleNote(this.d.db, { target: note.target, noteId: note.id, status: 'done', newWords: words, ...(note.at ? { at: note.at } : {}) })
    } catch (e) {
      console.warn('Could not mark the critic’s note done', e)
    }
  }

  /**
   * Takes out the second copy of a sentence printed twice in a row (page.ts dropRepeats), before the scene is checked.
   * Saved like any change, and in the report.
   */
  private tidy(sceneId: ID): void {
    const { db } = this.d
    const s = sceneWords(db, sceneId)
    if (!s || !s.marked.trim()) return
    const r = dropRepeats(s.marked)
    if (!r.dropped.length) return
    const page = pageFrom(r.text, repo.getScene(db, sceneId).doc)
    if (page.text === s.plain || !page.text.trim()) return
    this.saveScene(sceneId, page, 'Before the chapter writer took out a sentence printed twice')
    for (const words of r.dropped) {
      this.sceneReport(sceneId)?.fixed.push({ why: 'A sentence was printed twice in a row: the second copy is taken out.', words: clip(squash(words), 240) })
    }
  }

  private async checkScene(sceneId: ID, checks: CheckKind[] = STATE_CHECKS): Promise<void> {
    const c = await this.d.check(sceneId, this.controller.signal, checks)
    if (c.status === 'stopped') throw new Stopped()
    if (c.status === 'error') this.failed(c.error)
  }

  /** Checks a scene the run never changes, after one it changed; what the checks find new there is noted (notesNow). */
  private async checkOutside(sceneId: ID): Promise<void> {
    const { db } = this.d
    const where = placeLabel(db, sceneId)
    this.check()
    this.tell('checking', `Checking that ${where} still follows on, round ${this.round}`, null, 'follow')
    // What was open there before the run first looked is Adam's already: only what its checks find since is noted.
    if (!this.outsideBefore.has(sceneId)) this.outsideBefore.set(sceneId, new Set(issueFindings(db, sceneId).map((f) => f.issueId!)))
    if (!checkedAsIs(db, sceneId, FOLLOW_ON_CHECKS)) await this.checkScene(sceneId, FOLLOW_ON_CHECKS)
    cdb.sweepGone(db, { sceneId })
    const before = this.outsideBefore.get(sceneId)!
    const found = issueFindings(db, sceneId).filter((f) => !before.has(f.issueId!))
    this.outsideNotes.set(
      sceneId,
      found.map((f) => `${where} may no longer follow on: ${squash(f.what)}${f.quote ? ` (“${clip(squash(f.quote), 160)}”)` : ''}`)
    )
    this.notesNow()
  }

  /**
   * The report's notes for Adam: how scenes were drafted, what the scenes after the run's may no longer follow, and what
   * the critic said that the run didn't act on.
   */
  private notesNow(): void {
    this.report.notes = [...this.refs.flatMap((r) => this.draftNotes.get(r.id) ?? []), ...[...this.outsideNotes.values()].flat(), ...(this.criticNote ? [this.criticNote] : [])]
  }

  /** Whether the critic reads (Adam's switch; on when the run isn't told). */
  private criticOn(): boolean {
    return this.d.critic?.() ?? true
  }

  private async critiqueOf(target: CritiqueTarget): Promise<{ notes: CritiqueNote[]; at: string }> {
    const c = await this.d.critique(target, false, this.controller.signal)
    if (c.status === 'stopped') throw new Stopped()
    if (c.status === 'error') this.failed(c.error)
    return { notes: c.critique.notes, at: c.critique.at }
  }

  private nextFinding(): string {
    return `F${++this.findingCount}`
  }

  private sceneReport(id: ID): ChapterWriterSceneReport | undefined {
    return this.report.scenes.find((s) => s.sceneId === id)
  }

  private save(): void {
    this.report.cost = this.cost()
    if (this.d.db.open && !this.d.closed()) saveReport(this.d.db, this.report)
  }
}

/** "one thing", "3 things" (`are`: "3 things are", "one thing is"). */
const things = (n: number, are = false): string => {
  const w = n === 1 ? 'One thing' : `${n} things`
  const said = are ? w : w.toLowerCase()
  return are ? `${said} ${n === 1 ? 'is' : 'are'}` : said
}

/** What the report says was fixed, in plain words. */
function fixWhy(f: Finding): string {
  const what = clip(squash(f.what), 300)
  if (f.from === 'critic') return `The critic: ${what}`
  return what
}

/** The critic's notes the run doesn't act on, in a line for Adam; '' for none. */
function criticWords(notes: CritiqueNote[]): string {
  if (!notes.length) return ''
  return `The critic has ${notes.length === 1 ? 'one more note' : `${notes.length} more notes`} on the chapter that the AI didn't act on (${notes
    .slice(0, 4)
    .map((n) => `“${clip(squash(n.title), 60)}”`)
    .join(', ')}${notes.length > 4 ? '…' : ''}). They are in the Critique tab for you to weigh.`
}

const SEVERITY_WORDS: Record<string, string> = { 'must-fix': 'must fix', warning: 'worth a look', minor: 'minor' }

const payloadOf = (r: Record<string, unknown>): IssuePayload => {
  try {
    return typeof r.payload_json === 'string' && r.payload_json ? (JSON.parse(r.payload_json) as IssuePayload) : {}
  } catch {
    return {}
  }
}

/**
 * A scene's open issues from the checks (and the memory keeper's clashes), as findings to put right. Of what a check
 * through the scene's contract found (long story memory fix 13), only what the words go against that a second opinion
 * agreed with is put right without asking; what isn't shown yet is a plan miss (contractMisses), and what wasn't
 * confirmed stays in the Issues tab for Adam.
 */
export function issueFindings(db: DB, sceneId: ID): Omit<Finding, 'id' | 'status'>[] {
  const forReview = (r: Record<string, unknown>, p: IssuePayload): boolean => !p.contract || (!!p.contract.confirmed && !p.contract.missing && !!String(r.quote ?? '').trim())
  return cdb
    .sceneIssueRows(db, sceneId)
    .filter((r) => r.status === 'open' && !isLiveKind(r.kind) && forReview(r, payloadOf(r)))
    .map((r) => {
      const p = payloadOf(r)
      const fix = typeof p.fix === 'string' && p.fix.trim() ? `rewrite those words as “${p.fix.trim()}”` : ''
      const advice = [fix, typeof p.advice === 'string' ? p.advice.trim() : ''].filter(Boolean).join('; ')
      return {
        sceneId,
        from: 'check' as const,
        issueId: r.id as ID,
        // Something the scene's contract asked for (fix 13): the fix is told so.
        kind: `${SEVERITY_WORDS[r.severity as string] ?? 'worth a look'} · ${p.contract ? 'scene contract' : (p.check ?? (r.kind as string))}`,
        what: (r.message as string) ?? '',
        quote: (r.quote as string) ?? '',
        advice
      }
    })
}

/**
 * What the scene's contract says must change that its words don't show yet (fix 13's "not yet", once a second opinion
 * had its say): the scene misses its plan, so it is written again (once), never patched in.
 */
export function contractMisses(db: DB, sceneId: ID): Omit<Finding, 'id' | 'status'>[] {
  return cdb
    .sceneIssueRows(db, sceneId)
    .filter((r) => r.status === 'open' && !!payloadOf(r).contract?.missing)
    .map((r) => ({
      sceneId,
      from: 'plan' as const,
      issueId: r.id as ID,
      kind: 'plan · not shown',
      what: (r.message as string) || `The scene doesn't show: ${payloadOf(r).contract?.text ?? ''}`,
      quote: '',
      advice: ''
    }))
}

/**
 * Plain matching of a scene against its part of the plan: someone the plan has change in the scene (where they end up,
 * what they learn) whom the words never name, by name, other name or first name, misses it. Never the card's point of
 * view, who may tell the scene without once being named (in the first person, say).
 */
export function planMisses(db: DB, sceneId: ID, plan: ChapterWritingPlan | null, text: string): Omit<Finding, 'id' | 'status'>[] {
  const part = plan?.scenes.find((s) => s.sceneId === sceneId)
  if (!part || !text.trim()) return []
  const people = repo.listEntries(db).filter((e) => e.kind === 'character')
  const pov = repo.sceneCards(db, [sceneId]).get(sceneId)?.povId ?? null
  const out: Omit<Finding, 'id' | 'status'>[] = []
  for (const c of part.changes) {
    const e = people.find((p) => p.name === c.who)
    if (e && e.id === pov) continue
    const names = e ? [e.name, ...(e.aliases ?? []), e.name.split(/\s+/)[0]] : [c.who]
    if (names.some((n) => n.trim().length >= 2 && namedInProse(text, n))) continue
    out.push({
      sceneId,
      from: 'plan',
      issueId: null,
      kind: 'plan · who is there',
      what: `The chapter plan has ${c.who} here (${clip(squash(c.change), 200)}), but the scene never names ${c.who}.`,
      quote: '',
      advice: ''
    })
  }
  return out
}

/** The sentence around a place in plain words. */
function sentenceAt(text: string, from: number, to: number): string {
  const start = Math.max(text.lastIndexOf('\n', from - 1) + 1, ...['. ', '! ', '? ', '… '].map((m) => text.lastIndexOf(m, from - 1) + (text.lastIndexOf(m, from - 1) >= 0 ? m.length : 0)))
  const ends = ['.', '!', '?', '…', '\n'].map((m) => text.indexOf(m, to)).filter((i) => i >= 0)
  const end = ends.length ? Math.min(...ends) + 1 : text.length
  return text.slice(start, end).trim()
}

/** Stock AI phrases in a freshly written scene (shared/slop.ts), at most PHRASES_MOST, each in its sentence. */
export function phraseFindings(sceneId: ID, text: string): Omit<Finding, 'id' | 'status'>[] {
  return findSlop(text)
    .slice(0, PHRASES_MOST)
    .map((m) => ({
      sceneId,
      from: 'phrase' as const,
      issueId: null,
      kind: 'phrase',
      what: `“${m.text}” is a stock phrase: say it another way, in the book's own voice.`,
      quote: sentenceAt(text, m.from, m.to) || m.text,
      advice: ''
    }))
}

/** A critic note on a scene of the chapter, as a finding. */
export function noteFinding(n: CritiqueNote, sceneId: ID, at: string, chapterId: ID): Omit<Finding, 'id' | 'status'> {
  return {
    sceneId,
    from: 'critic',
    issueId: null,
    kind: `critic · ${n.category} · ${n.weight}`,
    what: n.title,
    quote: n.quote,
    advice: n.suggestion,
    note: { id: n.id, at, target: { scope: 'chapter', id: chapterId } }
  }
}

/** The report kept for a chapter, if any (for the window). */
export const reportFor = (db: DB, chapterId: ID): ChapterWriterReport | null => loadReport(db, chapterId)
