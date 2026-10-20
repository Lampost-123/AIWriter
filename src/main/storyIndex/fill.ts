// Filling in the story index's physical details (Adam, 2026-10-19): what people wear, carry and suffer, and where they
// end up, come from where things stand (continuity/tracker.ts), which the memory model works out scene by scene. The
// free part of the index is built for every story; the AI part only where it is wanted:
// - the last two chapters with words of each story being written, when a world opens (recentScenesToFill), worked out
//   in the background at low priority: never in front of the memory reading or a draft's own needs (StageFiller);
// - an older scene the first time a look-up needs it (fillSceneForLookup);
// - new scenes as part of the memory's usual work (keeper/index.ts standLater; the index follows: upkeep.ts);
// - every scene of a story when Adam asks ("Fill in the whole story"), after he is told roughly what it costs
//   (estimateFill), with progress and Stop (StageFiller.fillStory).
// A scene counts as filled once where things stand was read from its words as they are now (the index's `fresh`); a
// scene the model turned down counts too (asking again would only be turned down again). No Electron imports.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import type { StoryFillDone, StoryFillEstimate, StoryFillProgress } from '@shared/contracts/storyIndex'
import * as fdb from '../db/indexFill'
import * as kdb from '../db/keeper'
import { keptStates, stateAfter, stateBefore, stateMessages, storedState } from '../continuity/tracker'
import type { MemoryModel } from '../keeper/model'
import { isLocalUrl } from '@shared/urls'
import { estimateTokens } from '../keeper/text'
import { buildStorySafely, refreshSceneSafely } from './upkeep'

type DB = Database.Database

/** How many of a story's last chapters with words get their physical details when a world opens. */
export const RECENT_CHAPTERS = 2
/** A story whose words changed within this many days is one being written (the latest story with words always is). */
export const WRITING_WITHIN_DAYS = 60

/** True when where things stand was read from the scene's words as they are now (its physical details can be indexed). */
export function stageFilled(db: DB, sceneId: ID): boolean {
  return keptStates(db, [sceneId]).get(sceneId)?.fresh ?? false
}

/** A story's scenes with words whose physical details aren't worked out yet, in reading order. */
export function scenesToFill(db: DB, storyId: ID): fdb.FillScene[] {
  const scenes = fdb.storyFillScenes(db, storyId).filter((s) => s.words > 0)
  const kept = keptStates(
    db,
    scenes.map((s) => s.id)
  )
  return scenes.filter((s) => !kept.get(s.id)?.fresh)
}

/**
 * The scenes whose physical details a world opening works out: of each story being written (its words changed within
 * WRITING_WITHIN_DAYS, and always the story changed last), the scenes with words of its last `chapters` chapters with
 * words, not yet read for their words as they are now; story by story, each in reading order.
 */
export function recentScenesToFill(db: DB, o: { chapters?: number; withinDays?: number; now?: Date } = {}): ID[] {
  const chapters = o.chapters ?? RECENT_CHAPTERS
  const since = (o.now ?? new Date()).getTime() - (o.withinDays ?? WRITING_WITHIN_DAYS) * 86_400_000
  const stories = fdb.storiesWithWords(db).sort((a, b) => b.lastChanged.localeCompare(a.lastChanged))
  const out: ID[] = []
  stories.forEach((s, i) => {
    const at = Date.parse(s.lastChanged)
    if (i > 0 && !(at >= since)) return
    const worded = fdb.storyFillScenes(db, s.storyId).filter((x) => x.words > 0)
    const order: ID[] = []
    for (const x of worded) if (!order.includes(x.chapterId)) order.push(x.chapterId)
    const last = new Set(order.slice(-chapters))
    const ids = worded.filter((x) => last.has(x.chapterId)).map((x) => x.id)
    const kept = keptStates(db, ids)
    out.push(...ids.filter((id) => !kept.get(id)?.fresh))
  })
  return out
}

export interface FillCallOptions {
  signal?: AbortSignal
  closed?: () => boolean
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

/**
 * Before a look-up that needs a scene's physical details (the planning's look-ups): when where things stand isn't read
 * for the scene's words as they are now, the memory model works it out, with the few scenes before it it builds on
 * (as a draft brings them up to date: stateBefore), and the story's index is brought up to date with it. `filled`: the
 * scene's details are in the index now; `asked`: the model was asked. Never throws.
 */
export async function fillSceneForLookup(
  db: DB,
  sceneId: ID,
  model: MemoryModel,
  o: FillCallOptions = {}
): Promise<{ filled: boolean; asked: boolean }> {
  try {
    const scene = kdb.keeperScene(db, sceneId)
    if (!scene || !scene.text.trim()) return { filled: false, asked: false }
    if (stageFilled(db, sceneId)) {
      refreshSceneSafely(db, sceneId)
      return { filled: true, asked: false }
    }
    const opts = {
      db,
      model,
      signal: o.signal ?? new AbortController().signal,
      closed: o.closed ?? (() => !db.open),
      fetchImpl: o.fetchImpl,
      retryDelays: o.retryDelays
    }
    await stateBefore(opts, sceneId)
    if (!opts.signal.aborted && !opts.closed()) await stateAfter(opts, sceneId)
    if (!db.open) return { filled: false, asked: true }
    // The scenes before it may have been brought up to date too, and the next one is told against it: the whole story.
    buildStorySafely(db, scene.storyId)
    return { filled: stageFilled(db, sceneId), asked: true }
  } catch (e) {
    console.warn('Could not fill in a scene’s details for a look-up', e)
    return { filled: false, asked: false }
  }
}

// ---------- What filling a story costs ----------

/** About how many tokens each word of a scene costs to send (its words, as a token is about three quarters of a word). */
export const WORD_TOKENS = 1.4
/** About how long the model's answer is for one scene (where each person is, what they wear and hold, how they are). */
export const STAGE_REPLY_TOKENS = 450
/** What goes with every scene besides its words: the instructions, the cast and where things stood before it. */
export const STAGE_EXTRA_TOKENS = estimateTokens(stateMessages(null, '', [])[0].content) + 400

export interface FillGuess {
  scenes: number
  words: number
  input: number
  output: number
}

/** About how many tokens filling in these scenes takes: one call each. */
export function guessFill(scenes: readonly { words: number }[]): FillGuess {
  const words = scenes.reduce((n, s) => n + s.words, 0)
  return {
    scenes: scenes.length,
    words,
    input: Math.round(scenes.length * STAGE_EXTRA_TOKENS + words * WORD_TOKENS),
    output: scenes.length * STAGE_REPLY_TOKENS
  }
}

/** USD at the model's prices: its prompt price for what is sent (and its reply price when known); null when unknown. */
export function fillCost(g: FillGuess, choice: { promptPrice?: number | null; completionPrice?: number | null }): number | null {
  if (choice.promptPrice == null) return null
  return g.input * choice.promptPrice + (choice.completionPrice != null ? g.output * choice.completionPrice : 0)
}

/**
 * Roughly what filling in a story takes (no model is asked): its scenes with words not yet filled in, one call each,
 * their tokens, and the cost at the memory model's prices: free with a model on this computer, null when its price
 * isn't known (the screen then says how many AI calls), or the reason there is no model.
 */
export function estimateFill(db: DB, storyId: ID, m: MemoryModel | { error: string }): StoryFillEstimate {
  const total = fdb.storyFillScenes(db, storyId).filter((s) => s.words > 0).length
  const g = guessFill(scenesToFill(db, storyId))
  const base = { storyId, total, scenes: g.scenes, words: g.words, tokens: g.input + g.output }
  if ('error' in m) return { ...base, cost: null, free: false, model: null, problem: m.error }
  const model = m.choice.label || m.choice.modelId
  if (m.target.kind === 'custom' && isLocalUrl(m.target.baseUrl)) return { ...base, cost: 0, free: true, model, problem: null }
  return { ...base, cost: fillCost(g, m.choice), free: false, model, problem: null }
}

// ---------- Filling in the background ----------

export interface FillerDeps {
  db: DB
  /** The memory model now, or why there is none (no model, or this month's spending limit holds AI calls). */
  model: () => MemoryModel | { error: string }
  /** True while something comes first: the memory reading, a draft waiting for it, where things stand for a read. */
  busy?: () => boolean
  /** True once the world has closed. */
  closed: () => boolean
  /** How long to wait before looking again while something comes first (ms). */
  waitMs?: number
  /** Told whenever Adam's fill moves on (null once it is over). */
  onProgress?: (p: StoryFillProgress | null) => void
  /** Told when Adam's fill is over: done, stopped, or given up. */
  onDone?: (d: StoryFillDone) => void
  /** Told after a scene's details were worked out (the index takes them in; by default at once). */
  onSceneFilled?: (sceneId: ID) => void
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

/** How often the model may fail in a row before Adam's fill gives up (the provider isn't answering). */
const MOST_FAILURES = 3
export const FILL_WAIT_MS = 2_000

interface StoryRun {
  storyId: ID
  title: string
  ids: ID[]
  total: number
  done: number
  filled: number
  failed: number
  inARow: number
}

/**
 * Works out where things stand for scenes one at a time, in the background: Adam's whole-story fill first, then the
 * recent chapters' (low priority). Before each scene it gives way while something comes first (`busy`), so it is never
 * in front of the memory or a draft; Stop ends the scene being worked out at once.
 */
export class StageFiller {
  private story: StoryRun | null = null
  private recent: ID[] = []
  private recentFails = 0
  private controller: AbortController | null = null
  /** The scene being worked out now belongs to Adam's fill. */
  private forStory = false
  private running: Promise<void> | null = null
  private stopped = false

  constructor(private readonly d: FillerDeps) {}

  private get closed(): boolean {
    return this.stopped || this.d.closed() || !this.d.db.open
  }

  /** Adam's fill: these scenes of the story, in reading order. Replaces a fill of another story still going. */
  fillStory(storyId: ID, title: string, ids: ID[]): void {
    if (this.closed) return
    if (this.story) this.stopStory()
    this.story = { storyId, title, ids: [...ids], total: ids.length, done: 0, filled: 0, failed: 0, inARow: 0 }
    this.progress()
    this.kick()
  }

  /** The recent chapters' scenes, worked out after anything Adam asked for (scenes already waiting stay once). */
  queueRecent(ids: ID[]): void {
    if (this.closed) return
    for (const id of ids) if (!this.recent.includes(id)) this.recent.push(id)
    this.kick()
  }

  /** How far Adam's fill has got; null when there is none. */
  current(): StoryFillProgress | null {
    const s = this.story
    return s ? { storyId: s.storyId, title: s.title, done: s.done, total: s.total } : null
  }

  /** The recent chapters' scenes still waiting (for tests). */
  waiting(): ID[] {
    return [...this.recent]
  }

  /** Stop (Adam): his fill ends now, the scene being worked out for it too; what was filled stays. */
  stopStory(): void {
    const s = this.story
    if (!s) return
    if (this.forStory) this.controller?.abort()
    this.finish(s, { stopped: true })
  }

  /** The world is closing: everything stops, nothing more is written. */
  stop(): void {
    this.stopped = true
    this.controller?.abort()
    this.recent = []
    this.story = null
  }

  /** Resolves once nothing is waiting (for tests). */
  async whenIdle(): Promise<void> {
    while (this.running) await this.running
  }

  private progress(): void {
    try {
      this.d.onProgress?.(this.current())
    } catch (e) {
      console.warn('Could not tell how far filling in the story has got', e)
    }
  }

  private finish(s: StoryRun, o: { stopped?: boolean; problem?: string | null } = {}): void {
    if (this.story !== s) return
    this.story = null
    try {
      this.d.onDone?.({
        storyId: s.storyId,
        title: s.title,
        total: s.total,
        filled: s.filled,
        failed: s.failed,
        stopped: !!o.stopped,
        problem: o.problem ?? null
      })
    } catch (e) {
      console.warn('Could not tell that filling in the story is over', e)
    }
    this.progress()
  }

  private kick(): void {
    if (this.running || this.closed) return
    this.running = this.loop()
      .catch((e) => console.warn('Filling in the story’s details stopped unexpectedly', e))
      .finally(() => {
        this.running = null
        if (!this.closed && (this.story?.ids.length || this.recent.length)) this.kick()
      })
  }

  private async loop(): Promise<void> {
    while (!this.closed) {
      const s = this.story
      if (s && !s.ids.length) {
        this.finish(s)
        continue
      }
      const id = s ? s.ids[0] : this.recent[0]
      if (!id) return
      if (this.d.busy?.()) {
        await new Promise((resolve) => setTimeout(resolve, this.d.waitMs ?? FILL_WAIT_MS))
        continue
      }
      const m = this.d.model()
      if ('error' in m) {
        // Nothing to work with (no model, or the spending limit): Adam's fill says why; the quiet one waits for the next opening.
        if (s) this.finish(s, { problem: m.error })
        this.recent = []
        continue
      }
      if (s) s.ids.shift()
      else this.recent.shift()
      const ok = await this.one(id, m, !!s)
      if (this.closed) return
      if (!s) {
        // The provider isn't answering: the quiet fill waits for the next opening rather than trying every scene.
        this.recentFails = ok === 'failed' ? this.recentFails + 1 : 0
        if (this.recentFails >= MOST_FAILURES) {
          this.recent = []
          this.recentFails = 0
        }
        continue
      }
      // Stopped (or replaced) while the scene was being worked out.
      if (this.story !== s) continue
      s.done++
      if (ok === 'filled') {
        s.filled++
        s.inARow = 0
      } else if (ok === 'failed') {
        s.failed++
        s.inARow++
      }
      // A scene already in (filled since it was counted) is neither.
      if (s.inARow >= MOST_FAILURES) {
        this.finish(s, {
          problem: 'The memory model didn’t answer, so filling in the story stopped. What was filled in stays; try again later.'
        })
        continue
      }
      this.progress()
    }
  }

  /** Works out where things stand for one scene; 'skipped' when it needed nothing (no words, or already filled). */
  private async one(id: ID, model: MemoryModel, mine: boolean): Promise<'filled' | 'failed' | 'skipped'> {
    const db = this.d.db
    try {
      const scene = kdb.keeperScene(db, id)
      if (!scene || !scene.text.trim() || stageFilled(db, id)) return 'skipped'
      this.controller = new AbortController()
      this.forStory = mine
      const got = await stateAfter(
        {
          db,
          model,
          signal: this.controller.signal,
          closed: () => this.closed,
          fetchImpl: this.d.fetchImpl,
          retryDelays: this.d.retryDelays
        },
        id
      )
      if (this.closed) return 'skipped'
      const kept = storedState(db, id)
      const filled = !!got && stageFilled(db, id) && !kept?.refused
      if (stageFilled(db, id)) this.told(id)
      return filled ? 'filled' : 'failed'
    } catch (e) {
      console.warn('Could not work out where things stand for a scene', e)
      return 'failed'
    } finally {
      this.controller = null
      this.forStory = false
    }
  }

  private told(sceneId: ID): void {
    try {
      if (this.d.onSceneFilled) this.d.onSceneFilled(sceneId)
      else refreshSceneSafely(this.d.db, sceneId)
    } catch (e) {
      console.warn('Could not take a scene’s details into the story index', e)
    }
  }
}
