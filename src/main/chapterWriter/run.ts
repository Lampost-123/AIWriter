// One run of Write the whole chapter (contracts/chapterWriter.ts): study, draft, then rounds of checking and fixing
// until the chapter is clean, then a proofread, checked again. The agent decides what to do inside each session; this
// file decides when the chapter is done:
//   1. Study: one agent session reads the cards against the memory and writes the brief.
//   2. Draft: each scene in order through the app's writer (the memory catches up first, so each scene is written
//      knowing what the scene before it now says), with its notes from the brief.
//   3. Check: the consistency checks read every scene changed since the last round (a sentence printed twice in a row
//      taken out first); the critic reads every scene and the chapter in the first round only, and its notes not yet
//      dealt with carry to the next (re-read, it found something new to say every time: live test, 2026-10-16).
//   4. Fix: an agent session for each scene with findings, then one for the chapter as a whole.
//   5. When a round finds nothing: proofread each scene, and check again if anything changed.
//   6. At the end, the critic reads once more what changed since it read it, for the Critique tab (not acted on).
// It stops when clean, on Stop, at the spending limit, when a round makes no progress, or at CHAPTER_WRITER_LIMITS; a
// finding that keeps coming back is left for Adam (progress.ts Tries). The words before the run are kept (store.ts) so
// Undo can put the chapter back.
// No Electron imports: everything outside the world's database comes through RunDeps.

import type Database from 'better-sqlite3'
import type {
  ChapterWriterProgress,
  ChapterWriterReport,
  ChapterWriterSceneReport,
  ChapterWriterStage,
  ChapterWriterStatus
} from '@shared/contracts/chapterWriter'
import type { CritiqueNote, CritiqueOutcome, CritiqueTarget } from '@shared/contracts/critique'
import type { ChatMessage, ID, SceneCard, WritingPrefs } from '@shared/types'
import { CHAPTER_WRITER_LIMITS } from '@shared/contracts/chapterWriter'
import { CARRY_LABELS } from '@shared/chapterCard'
import { effectiveStyle } from '@shared/style'
import { findSlop } from '@shared/slop'
import * as repo from '../db/repo'
import * as cdb from '../db/checks'
import { isLiveKind, type IssuePayload } from '../db/checks'
import { runTask, stopTask, type Emit } from '../ai/tasks'
import type { JobModel } from '../ai/jobModel'
import type { SnapshotSource } from '../ask/extraTools'
import { cardLines } from '../outline/context'
import { newId, now, UserError } from '../util'
import { sceneWords } from '../ask/agent'
import { cleanProse, dropRepeats, pageFrom, type Page } from './page'
import { findingKey, foldWords, ProgressGuard, Tries, wordsHash, wordsOverlap } from './progress'
import {
  AGENT_REPLY,
  AGENT_TEMPERATURE,
  LAST_WORDS,
  STEPS,
  nudgeFor,
  proofreadSystem,
  reviewSystem,
  studySystem,
  type ChapterJob
} from './prompts'
import { loadReport, saveBefore, saveReport, scenesNow } from './store'
import { ChapterSession, findingLine, numberedScene, type Brief, type Finding, type SceneRef } from './tools'

type DB = Database.Database

export interface RunDeps {
  db: DB
  /** The agent's model (the chapter writer model): it must be able to use tools. */
  agentModel: JobModel
  prefs: WritingPrefs
  history?: SnapshotSource | null
  /** The task runner's events for the agent's calls (the run says how it goes itself). */
  taskEmit: Emit
  /** How the run goes, for the window. */
  progress: (p: ChapterWriterProgress) => void
  /** A scene's words changed. */
  sceneChanged: (sceneId: ID, page: Page) => void
  /**
   * Drafts a scene from its card with the app's writer (the memory caught up first), with the notes from the brief
   * and, for a scene written again, a direction. Resolves with its words; `cutOff`: the writer ran into its reply limit;
   * `refused`: it sent back a refusal as words; `note`: something Adam should know about how it was written (where
   * things stand wasn't ready, say), in plain words.
   */
  draft: (
    sceneId: ID,
    o: { notes: string; direction: string; signal: AbortSignal }
  ) => Promise<{ status: 'complete' | 'stopped' | 'error'; text: string; error: string | null; cutOff?: boolean; refused?: boolean; note?: string | null }>
  /**
   * Waits for the memory to finish reading the scenes before this one and writing their summaries (Adam, 2026-10-17:
   * "always wait"), so the run can say so while it waits. Left out: the draft's own catch-up does it, unsaid.
   */
  catchUp?: (sceneId: ID, signal: AbortSignal) => Promise<unknown>
  /** Saves a scene's new page the way the editor's saves go, after keeping the page before in History. */
  save: (sceneId: ID, page: Page, label: string) => void
  /** Runs every consistency check on a scene (the memory caught up first); what they find is saved as issues. */
  check: (sceneId: ID, signal: AbortSignal) => Promise<{ status: 'done' | 'empty' | 'stopped' | 'error'; error?: string }>
  /** The craft critic on a scene or the chapter; `again`: a re-read after revisions. */
  critique: (target: CritiqueTarget, again: boolean, signal: AbortSignal) => Promise<CritiqueOutcome>
  /**
   * Whether the critic reads at all (Settings › Models, 2026-10-17, to save on costs): false, the run is checked and
   * fixed by the consistency checks alone, and the critic never reads. Left out: it reads.
   */
  critic?: () => boolean
  /** The monthly spending limit is holding AI calls: what to say, or null. */
  limitNote: () => string | null
  /** True once the world has closed. */
  closed: () => boolean
  fetchImpl?: typeof fetch
  retryDelays?: number[]
  /** The clock, in milliseconds (tests). */
  clock?: () => number
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

/** Said under a later scene's notes from the study: its start comes from the scene before as written, not from them. */
export const LATER_START =
  'Where everyone is as this scene starts, what they wear and hold, and how they are placed, is where the scene before it ends, as written: keep to that, whatever these notes say of it.'

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
  const title = /^\s*scene\s+[\w-]+\s*$/i.test(scene?.title ?? '') ? '' : (scene?.title.trim() ?? '')
  return `Ch ${ch + 1}, Sc ${sc + 1}${title ? ` “${title}”` : ''}`
}

/** A chapter's own title: '' for none, or one that only says "Chapter 3" (so it isn't said twice). */
export const ownTitle = (title: string): string => (/^\s*chapter\s+[\w-]+\s*$/i.test(title) ? '' : title.trim())

export class ChapterRun {
  private readonly controller = new AbortController()
  private currentTask: ID | null = null
  private stage: ChapterWriterStage = 'study'
  private note = ''
  private sceneNow: ID | null = null
  private round = 0
  private readonly startedAt = now()
  private readonly startedClock: number
  private refs: SceneRef[] = []
  private storyId: ID = ''
  private label = ''
  private brief: Brief | null = null
  private readonly findings: Finding[] = []
  private findingCount = 0
  /** What has been given to the agent to fix, and set aside (progress.ts). */
  private readonly tries = new Tries()
  /** Findings that kept coming back, left for Adam: the latest round's. */
  private leftOver: Finding[] = []
  /** The new words the agent put in each scene this run. */
  private readonly written = new Map<ID, string[]>()
  /** Rounds of fixing so far (CHAPTER_WRITER_LIMITS.fixRounds). */
  private fixRounds = 0
  /** The critic's notes from its first read of each scene, and of the chapter. */
  private readonly sceneNotes = new Map<ID, CritiqueNote[]>()
  private chapterNotes: CritiqueNote[] = []
  /** Scenes changed since the critic read them (and the chapter), for its last read. */
  private readonly unread = new Set<ID>()
  private chapterUnread = false
  /** What the critic's last read found, for Adam. */
  private lastReadNote = ''
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

  /** Stops the run: the call under way stops; what was saved stays. */
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
    saveBefore(db, this.chapterId, scenesNow(db, this.sceneIds))
    saveReport(db, this.report)
  }

  /** Runs to the end. Never throws: how it ended is in the report. */
  async run(): Promise<ChapterWriterReport> {
    try {
      await this.study()
      await this.draftAll()
      await this.rounds()
    } catch (e) {
      const limit = e instanceof Failed ? null : this.d.limitNote()
      if (e instanceof Stopped || this.stopped) {
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

  private tell(stage: ChapterWriterStage, note: string, sceneId: ID | null = null): void {
    this.stage = stage
    this.note = note
    this.sceneNow = sceneId
    this.d.progress(this.progressNow())
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
      sceneIds: this.sceneIds
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

  // ---------- 1. Study ----------

  private async study(): Promise<void> {
    this.check()
    this.tell('study', `Studying ${this.label}`)
    const s = await this.session('study', null, [])
    this.brief = s.brief ?? { overview: '', scenes: [], questions: [] }
    this.report.brief = this.briefText()
    this.report.questions = this.brief.questions
    this.save()
  }

  private briefText(): string {
    const b = this.brief
    if (!b) return ''
    const parts = [b.overview.trim()]
    for (const r of this.refs) {
      const notes = b.scenes.find((s) => s.sceneId === r.id)?.notes.trim()
      if (notes) parts.push(`${r.label}:\n${notes}`)
    }
    return parts.filter(Boolean).join('\n\n')
  }

  private notesFor(sceneId: ID): string {
    const b = this.brief
    if (!b) return ''
    const mine = b.scenes.find((s) => s.sceneId === sceneId)?.notes.trim() ?? ''
    // The study is made before any scene is written, so where everyone is at a later scene's start is only its guess
    // (review, 2026-10-16): the end of the scene before, as now written, says it (the briefing's "Where things stand").
    const later = this.refs.findIndex((r) => r.id === sceneId) > 0 && !!mine
    return [b.overview.trim() && `The chapter: ${b.overview.trim()}`, mine, later ? LATER_START : ''].filter(Boolean).join('\n\n')
  }

  // ---------- 2. Draft ----------

  private async draftAll(): Promise<void> {
    for (const [i, r] of this.refs.entries()) {
      this.check()
      if (i > 0 && this.d.catchUp) {
        this.tell('drafting', `Updating memory with ${this.refs[i - 1].label} before writing ${r.label}`, r.id)
        await this.d.catchUp(r.id, this.controller.signal)
        this.check()
      }
      this.tell('drafting', `Writing ${r.label} (${i + 1} of ${this.refs.length})`, r.id)
      await this.write(r.id, '')
    }
  }

  /** Drafts a scene (again) and saves it. Resolves with its words. */
  private async write(sceneId: ID, direction: string): Promise<string> {
    const r = await this.d.draft(sceneId, { notes: this.notesFor(sceneId), direction, signal: this.controller.signal })
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
    this.d.sceneChanged(sceneId, page)
  }

  // ---------- 3–5. Rounds ----------

  private async rounds(): Promise<void> {
    const guard = new ProgressGuard()
    let changed = new Set(this.sceneIds)
    let proofread = false
    for (;;) {
      this.check()
      this.round++
      this.report.rounds = this.round
      const { give, leave } = await this.gather(changed)
      this.leftOver = leave
      this.save()
      if (!give.length) {
        if (!proofread) {
          changed = await this.proofreadAll()
          proofread = true
          if (changed.size) continue
        }
        return this.finish(leave)
      }
      // How far one run goes (CHAPTER_WRITER_LIMITS): what is open then is listed for Adam.
      const late = this.clock() - this.startedClock >= CHAPTER_WRITER_LIMITS.minutes * 60_000
      if (late || this.fixRounds >= CHAPTER_WRITER_LIMITS.fixRounds) return this.capped([...give, ...leave], late)
      const verdict = guard.round(
        give.map((f) => findingKey(f.sceneId ?? '', f.what, f.quote)),
        wordsHash(this.sceneIds.map((id) => repo.getScene(this.d.db, id).text ?? ''))
      )
      if (verdict) {
        this.report.left = [...give, ...leave].map((f) => findingLine(f, this.refs))
        throw new Failed(
          `The AI couldn't settle ${things(give.length + leave.length)}: they are listed below, and in the Issues and Critique tabs.`,
          'stuck'
        )
      }
      this.fixRounds++
      for (const f of give) this.tries.given(f)
      changed = new Set()
      for (const r of this.refs) {
        const mine = give.filter((f) => f.sceneId === r.id)
        if (!mine.length) continue
        this.check()
        this.tell('reviewing', `Fixing ${r.label}, round ${this.round}`, r.id)
        const s = await this.session('review', r.id, mine)
        for (const id of s.changed) changed.add(id)
        if (s.summary) this.report.summary = s.summary
      }
      const whole = give.filter((f) => f.sceneId === null && f.status === 'open')
      if (whole.length) {
        this.check()
        this.tell('reviewing', `Fixing ${this.label} as a whole, round ${this.round}`)
        const s = await this.session('chapter', null, whole)
        for (const id of s.changed) changed.add(id)
        if (s.summary) this.report.summary = s.summary
      }
      if (changed.size) proofread = false
    }
  }

  /** Clean, or clean but for what kept coming back (left for Adam). */
  private async finish(leave: Finding[]): Promise<void> {
    await this.lastRead()
    this.report.left = leave.map((f) => findingLine(f, this.refs))
    if (!leave.length) {
      this.report.status = 'done'
      this.report.message = ''
      return
    }
    this.report.status = 'stuck'
    this.report.message = `The AI fixed what it could, but ${things(leave.length)} came back after it had tried, so it left ${leave.length === 1 ? 'it' : 'them'} for you: listed below, and in the Issues and Critique tabs.`
  }

  /** At the limit of rounds or time, with findings still open: they are listed for Adam. */
  private async capped(open: Finding[], late: boolean): Promise<void> {
    await this.lastRead()
    this.report.status = 'stuck'
    this.report.left = open.map((f) => findingLine(f, this.refs))
    const after = late ? `about ${CHAPTER_WRITER_LIMITS.minutes === 60 ? 'an hour' : `${CHAPTER_WRITER_LIMITS.minutes} minutes`} of work` : `${CHAPTER_WRITER_LIMITS.fixRounds} rounds of fixes`
    this.report.message = `The AI stopped after ${after}, as it always does, so it never runs on for hours. ${things(open.length, true)} still open: listed below, and in the Issues and Critique tabs.`
  }

  /**
   * The critic reads once more each scene changed since it read it, and the chapter, so the Critique tab shows the
   * chapter as it now is. Its notes are for Adam: the run doesn't act on them. A read that fails is passed over.
   */
  private async lastRead(): Promise<void> {
    if (!this.criticOn()) return
    const scenes = this.refs.filter((r) => this.unread.has(r.id))
    if (!scenes.length && !this.chapterUnread) return
    const found: string[] = []
    let count = 0
    try {
      for (const r of scenes) {
        this.check()
        this.tell('checking', `The critic is reading ${r.label} once more`, r.id)
        const n = (await this.notes({ scope: 'scene', id: r.id }, true)).length
        if (n) found.push(`${r.label}: ${n}`)
        count += n
      }
      if (this.chapterUnread) {
        this.check()
        this.tell('checking', `The critic is reading ${this.label} once more`)
        const n = (await this.notes({ scope: 'chapter', id: this.chapterId }, true)).length
        if (n) found.push(`the chapter: ${n}`)
        count += n
      }
    } catch (e) {
      if (e instanceof Stopped) throw e
      console.warn('The critic’s last read of the chapter failed', e)
    }
    this.lastReadNote = count
      ? `The critic read the changed scenes once more at the end and has ${count === 1 ? 'one more note' : `${count} more notes`} (${found.join(', ')}). They are in the Critique tab for you to weigh: the AI didn't act on them.`
      : ''
    this.notesNow()
  }

  /**
   * Checks and critiques the scenes changed, and the chapter when any did; returns every open finding, numbered. The
   * scene after each one changed is checked too (review, 2026-10-16): a scene's checks look back at the stage before it,
   * never forward, so an ending changed in a review (her dress back on) was never read against the opening after it (the
   * dress still on the floor). One of this chapter's is checked like the rest (its findings go to its review); one the
   * run doesn't write (the next chapter's first scene, a scene with no card) is checked and what it finds is noted for
   * Adam, never changed.
   */
  private async gather(changed: Set<ID>): Promise<{ give: Finding[]; leave: Finding[] }> {
    const { db } = this.d
    // The critic reads in the first round only (its notes not yet dealt with carry on), then once more at the end; never
    // when Adam has switched it off.
    const critic = this.criticOn()
    const first = this.round === 1
    const after = new Set([...changed].map((id) => sceneAfter(db, id)).filter((id): id is ID => !!id && !changed.has(id)))
    for (const r of this.refs) {
      const mine = changed.has(r.id)
      if (!mine && !after.has(r.id)) continue
      if (mine) this.tidy(r.id)
      this.check()
      this.tell('checking', mine ? `Checking ${r.label}, round ${this.round}` : `Checking that ${r.label} still follows on, round ${this.round}`, r.id)
      await this.checkScene(r.id)
      if (!mine || !critic) continue
      if (!first) {
        this.unread.add(r.id)
        continue
      }
      this.check()
      this.tell('checking', `The critic is reading ${r.label}, round ${this.round}`, r.id)
      this.sceneNotes.set(r.id, await this.notes({ scope: 'scene', id: r.id }, false))
    }
    for (const id of after) if (!this.sceneIds.includes(id)) await this.checkOutside(id)
    if (critic && changed.size && first) {
      this.check()
      this.tell('checking', `The critic is reading ${this.label}, round ${this.round}`)
      this.chapterNotes = await this.notes({ scope: 'chapter', id: this.chapterId }, false)
    } else if (critic && changed.size) this.chapterUnread = true
    // This round's findings take the place of what was still open: fixed or gone ones drop out, set-asides stay out.
    for (const f of this.findings) if (f.status === 'open') f.status = 'gone'
    const give: Finding[] = []
    const leave: Finding[] = []
    const add = (f: Omit<Finding, 'id' | 'status'>): void => {
      const key = findingKey(f.sceneId ?? '', f.what, f.quote)
      if ([...give, ...leave].some((x) => findingKey(x.sceneId ?? '', x.what, x.quote) === key)) return
      const verdict = this.tries.verdict(f, this.ownWords(f))
      if (verdict === 'skip') {
        // Set aside before, found again: set aside again, never given again.
        if (f.issueId) this.setAsideIssue(f.issueId)
        return
      }
      const nf: Finding = { ...f, id: this.nextFinding(), status: 'open' }
      if (verdict === 'leave') return void leave.push(nf)
      give.push(nf)
      this.findings.push(nf)
    }
    for (const r of this.refs) {
      cdb.sweepGone(db, { sceneId: r.id })
      for (const f of issueFindings(db, r.id)) add(f)
      for (const n of this.carried(r.id)) add(noteFinding(n, r.id))
    }
    for (const n of this.carried(null)) add(noteFinding(n, n.sceneId && this.sceneIds.includes(n.sceneId) ? n.sceneId : null))
    return { give, leave }
  }

  /**
   * The critic's notes from its first read still to deal with: not fixed or set aside, and their words still there (a
   * note whose words have changed has been acted on). `sceneId` null: the chapter's.
   */
  private carried(sceneId: ID | null): CritiqueNote[] {
    const notes = sceneId ? (this.sceneNotes.get(sceneId) ?? []) : this.chapterNotes
    const texts = (sceneId ? [sceneId] : this.sceneIds).map((id) => foldWords(repo.getScene(this.d.db, id).text ?? ''))
    return notes.filter((n) => {
      const where = sceneId ?? (n.sceneId && this.sceneIds.includes(n.sceneId) ? n.sceneId : null)
      const key = findingKey(where ?? '', n.title, n.quote)
      const dealt = this.findings.some((f) => f.from === 'critic' && (f.status === 'fixed' || f.status === 'set-aside') && findingKey(f.sceneId ?? '', f.what, f.quote) === key)
      const quote = foldWords(n.quote)
      return !dealt && (!quote || texts.some((t) => t.includes(quote)))
    })
  }

  /** The finding is on words the agent itself put in this run. */
  private ownWords(f: Pick<Finding, 'sceneId' | 'quote'>): boolean {
    return !!f.sceneId && !!f.quote.trim() && (this.written.get(f.sceneId) ?? []).some((w) => wordsOverlap(f.quote, w))
  }

  private setAsideIssue(issueId: ID): void {
    try {
      cdb.setAsideByChapter(this.d.db, issueId)
    } catch (e) {
      console.warn('Could not set an issue aside', e)
    }
  }

  /**
   * Takes out the second copy of a sentence printed twice in a row (page.ts dropRepeats), before the scene is checked:
   * the agent's revise can't name one copy of words that are there twice. Saved like any change, and in the report.
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

  private async checkScene(sceneId: ID): Promise<void> {
    const c = await this.d.check(sceneId, this.controller.signal)
    if (c.status === 'stopped') throw new Stopped()
    if (c.status === 'error') this.failed(c.error)
  }

  /** Checks a scene the run never changes, after one it changed; what the checks find new there is noted (notesNow). */
  private async checkOutside(sceneId: ID): Promise<void> {
    const { db } = this.d
    const where = placeLabel(db, sceneId)
    this.check()
    this.tell('checking', `Checking that ${where} still follows on, round ${this.round}`)
    // What was open there before the run first looked is Adam's already: only what its checks find since is noted.
    if (!this.outsideBefore.has(sceneId)) this.outsideBefore.set(sceneId, new Set(issueFindings(db, sceneId).map((f) => f.issueId!)))
    await this.checkScene(sceneId)
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
   * the critic's last read found.
   */
  private notesNow(): void {
    this.report.notes = [
      ...this.refs.flatMap((r) => this.draftNotes.get(r.id) ?? []),
      ...[...this.outsideNotes.values()].flat(),
      ...(this.lastReadNote ? [this.lastReadNote] : [])
    ]
  }

  /** Whether the critic reads (Adam's switch; on when the run isn't told). */
  private criticOn(): boolean {
    return this.d.critic?.() ?? true
  }

  private async notes(target: CritiqueTarget, again: boolean): Promise<CritiqueNote[]> {
    const c = await this.d.critique(target, again, this.controller.signal)
    if (c.status === 'stopped') throw new Stopped()
    if (c.status === 'error') this.failed(c.error)
    return c.critique.notes
  }

  private nextFinding(): string {
    return `F${++this.findingCount}`
  }

  private async proofreadAll(): Promise<Set<ID>> {
    const changed = new Set<ID>()
    for (const r of this.refs) {
      this.check()
      this.tell('proofreading', `Proofreading ${r.label}`, r.id)
      const s = await this.session('proofread', r.id, [])
      for (const id of s.changed) changed.add(id)
    }
    return changed
  }

  // ---------- A session of the agent ----------

  private async session(job: ChapterJob, sceneId: ID | null, findings: Finding[]): Promise<ChapterSession> {
    this.check()
    const { db } = this.d
    const s = new ChapterSession({
      db,
      job,
      storyId: this.storyId,
      chapterId: this.chapterId,
      sceneId,
      scenes: this.refs,
      prefs: this.d.prefs,
      history: this.d.history ?? null,
      findings: job === 'review' || job === 'chapter' ? findings : [],
      nextFinding: () => this.nextFinding(),
      brief: () => this.briefText(),
      save: (id, page, label) => this.saveScene(id, page, label),
      rewrite: async (id, direction) => {
        try {
          const text = await this.write(id, direction)
          // Every word of it is the agent's now.
          this.written.set(id, [text])
          return { ok: true, text }
        } catch (e) {
          if (e instanceof Stopped) throw e
          return { ok: false, error: (e as Error)?.message ?? String(e) }
        }
      },
      checkAgain: async (id) => {
        this.tidy(id)
        const c = await this.d.check(id, this.controller.signal)
        if (c.status === 'stopped') throw new Stopped()
        cdb.sweepGone(db, { sceneId: id })
        // The checks' findings, and the critic's first notes still to deal with: the critic isn't asked again.
        const now = [...issueFindings(db, id), ...this.carried(id).map((n) => noteFinding(n, id))].filter((f) => this.tries.verdict(f, this.ownWords(f)) === 'give')
        // What was open for the scene and is no longer found is done with.
        for (const f of this.findings) {
          if (f.sceneId !== id || f.status !== 'open') continue
          const still = now.some((n) => (f.issueId && n.issueId === f.issueId) || (n.from === f.from && squash(n.what) === squash(f.what)))
          if (!still) f.status = 'fixed'
        }
        return now.map((f) => ({ ...f, status: 'open' as const }))
      },
      setAside: (f) => this.tries.setAside(f),
      wrote: (id, words) => this.written.set(id, [...(this.written.get(id) ?? []), words]),
      noted: {
        fix: (id, fix) => this.sceneReport(id)?.fixed.push(fix),
        setAside: (id, x) => (id ? this.sceneReport(id) : this.report.scenes[0])?.setAside.push(x),
        rewritten: (id, why) => this.sceneReport(id)?.rewritten.push(why)
      }
    })
    const messages: ChatMessage[] = [
      { role: 'system', content: job === 'study' ? studySystem() : job === 'proofread' ? proofreadSystem() : reviewSystem(job) },
      { role: 'user', content: this.opening(job, sceneId, findings) }
    ]
    const taskId = newId()
    this.currentTask = taskId
    const done = await runTask({
      db,
      taskId,
      job: 'chapter',
      sceneId: sceneId ?? '',
      model: this.d.agentModel,
      messages,
      reply: AGENT_REPLY,
      temperature: AGENT_TEMPERATURE,
      direction: this.note,
      emit: this.d.taskEmit,
      agent: {
        tools: s.tools,
        maxSteps: STEPS[job],
        run: (calls) => s.runAll(calls),
        lastWords: () => LAST_WORDS,
        nudge: () => (s.ended() ? null : nudgeFor(job)),
        maxNudges: 2,
        ended: () => s.ended()
      },
      fetchImpl: this.d.fetchImpl,
      retryDelays: this.d.retryDelays
    }).finally(() => {
      if (this.currentTask === taskId) this.currentTask = null
    })
    if (done.status === 'stopped' || this.stopped) throw new Stopped()
    if (done.status === 'error') this.failed(done.error)
    if (!s.summary && job !== 'study') s.summary = squash(done.text).slice(0, 600)
    this.save()
    return s
  }

  private sceneReport(id: ID): ChapterWriterSceneReport | undefined {
    return this.report.scenes.find((s) => s.sceneId === id)
  }

  private save(): void {
    this.report.cost = this.cost()
    if (this.d.db.open && !this.d.closed()) saveReport(this.d.db, this.report)
  }

  // ---------- What each session is told first ----------

  private opening(job: ChapterJob, sceneId: ID | null, findings: Finding[]): string {
    const { db } = this.d
    const story = repo.getStory(db, this.storyId)
    const style = effectiveStyle(this.d.prefs, repo.getWorldStyle(db), story.style)
    const names = nameOf(db)
    const parts: string[] = []
    const styleLines = [
      `Title: ${story.title.trim() || 'Untitled story'}`,
      style.pov && `Point of view: ${style.pov}`,
      style.tense && `Tense: ${style.tense}`,
      style.spelling && `Spelling: ${style.spelling}`,
      style.proseStyle && `Prose style: ${clip(style.proseStyle, 400)}`
    ].filter(Boolean)
    parts.push(`## The story\n${styleLines.join('\n')}`)
    const scenesLine = this.refs.map((r) => `${r.label} (${repo.getScene(db, r.id).wordCount} words)`).join('; ')
    parts.push(`## The chapter: ${this.label}\n${this.chapterCard(names)}\nIts scenes: ${scenesLine}`)

    if (job === 'study') {
      const cards = repo.sceneCards(db, this.sceneIds)
      for (const r of this.refs) {
        const card = cards.get(r.id)
        parts.push(`### ${r.label}\n${card ? cardLines(card, names) || '(The card is empty.)' : '(The card is empty.)'}`)
      }
      parts.push('## What to do\nStudy the chapter against the memory with the tools, then call write_brief.')
      return parts.join('\n\n')
    }

    const brief = this.briefText()
    if (brief && job !== 'proofread') parts.push(`## The brief the chapter was written to\n${clip(brief, 8000)}`)
    const here = sceneId ? this.refs.find((r) => r.id === sceneId) : null
    if (here) {
      const card = repo.sceneCards(db, [here.id]).get(here.id)
      parts.push(`## The scene you are working on: ${here.label}\nScene card:\n${card ? cardLines(card, names) || '(empty)' : '(empty)'}`)
    }
    if (job === 'proofread' && sceneId) {
      const slop = findSlop(repo.getScene(db, sceneId).text ?? '')
      parts.push(
        slop.length
          ? `## Common AI phrases in this scene (say each another way)\n${[...new Set(slop.map((m) => `“${m.text}”`))].slice(0, 20).join('\n')}`
          : '## Common AI phrases in this scene\nNone found.'
      )
    } else {
      parts.push(`## What the checks and the critic found\n${findings.map((f) => findingLine(f, this.refs)).join('\n')}`)
    }
    if (sceneId) parts.push(`## The scene's words ([n] numbers each paragraph; *asterisks* mark italics)\n${numberedScene(db, sceneId)}`)
    else parts.push('## The scenes\nRead each with read_scene (name it: "Sc 2").')
    parts.push(
      job === 'proofread'
        ? '## What to do\nProofread the scene: fix each slip with revise, then call done.'
        : '## What to do\nDeal with every finding above: fix it with revise (or rewrite_scene), or set it aside with not_a_problem and your reason. Then call done.'
    )
    return parts.join('\n\n')
  }

  private chapterCard(name: (id: ID) => string): string {
    const { db } = this.d
    const chapter = repo.getChapter(db, this.chapterId)
    const card = repo.getChapterCard(db, this.chapterId)
    const lines: string[] = []
    const add = (label: string, v: string): void => {
      if (v.trim()) lines.push(`${label}: ${v.trim()}`)
    }
    add('Goal', chapter.goal)
    add(CARRY_LABELS.pov, card.povId ? name(card.povId) : '')
    add(CARRY_LABELS.present, card.presentIds.map(name).filter(Boolean).join(', '))
    add(CARRY_LABELS.location, card.locationId ? name(card.locationId) : '')
    add(CARRY_LABELS.when, card.when)
    add(CARRY_LABELS.mood, card.mood)
    add(CARRY_LABELS.notes, clip(card.notes, 800))
    return lines.join('\n') || '(No chapter card.)'
  }
}

/** "one thing", "3 things" (`are`: "3 things are", "one thing is"). */
const things = (n: number, are = false): string => {
  const w = n === 1 ? 'One thing' : `${n} things`
  const said = are ? w : w.toLowerCase()
  return are ? `${said} ${n === 1 ? 'is' : 'are'}` : said
}

/** Entry names by id. */
function nameOf(db: DB): (id: ID) => string {
  const byId = new Map(repo.listEntries(db).map((e) => [e.id, e.name]))
  return (id) => byId.get(id) ?? ''
}

const SEVERITY_WORDS: Record<string, string> = { 'must-fix': 'must fix', warning: 'worth a look', minor: 'minor' }

/**
 * A scene's open issues from the checks (and the memory keeper's clashes), as findings. Of what a check through the
 * scene's contract found (long story memory fix 13), only what the words go against that a second opinion agreed with is
 * put right without asking; what isn't shown yet, or wasn't confirmed, stays in the Issues tab for Adam.
 */
export function issueFindings(db: DB, sceneId: ID): Omit<Finding, 'id' | 'status'>[] {
  const payloadOf = (r: Record<string, unknown>): IssuePayload => {
    try {
      return typeof r.payload_json === 'string' && r.payload_json ? (JSON.parse(r.payload_json) as IssuePayload) : {}
    } catch {
      return {}
    }
  }
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
        // Something the scene's contract asked for (fix 13): the review is told so.
        kind: `${SEVERITY_WORDS[r.severity as string] ?? 'worth a look'} · ${p.contract ? 'scene contract' : (p.check ?? (r.kind as string))}`,
        what: (r.message as string) ?? '',
        quote: (r.quote as string) ?? '',
        advice
      }
    })
}

/** A critic note as a finding. */
export function noteFinding(n: CritiqueNote, sceneId: ID | null): Omit<Finding, 'id' | 'status'> {
  return {
    sceneId,
    from: 'critic',
    issueId: null,
    kind: `critic · ${n.category} · ${n.weight}`,
    what: n.title,
    quote: n.quote,
    advice: n.suggestion
  }
}

/** The report kept for a chapter, if any (for the window). */
export const reportFor = (db: DB, chapterId: ID): ChapterWriterReport | null => loadReport(db, chapterId)
