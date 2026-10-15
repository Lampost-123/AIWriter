// The promises ledger (long story memory fix 10, 2026-10-15). Setups (a planted clue, a promise, a threat, a mystery)
// get quietly dropped in long books: "abandoned plot elements" in ConStory-Bench. The memory already keeps plot threads
// (the memory keeper opens them, adds clues, notes when one moves on and resolves one when its payoff is on the page:
// keeper/threads.ts), and B4 already knew where each was last touched (memory/threadQuiet.ts). This adds, with no new
// store for the threads themselves and no new AI call:
// - where each stands: open (set up, nothing since), advanced (touched again in a later scene after it was set up: a
//   clue, a step on, its words there), paid off (resolved), or dropped (Adam decided it won't be paid off: his plan);
// - the scene it was set up in, and the last scene after that which moved it on;
// - when it is due: by the end of a chapter Adam chose ("Pay off by", kept in the world's meta: db/threadPlans.ts), or
//   else the chapter of the first scene whose card plans its pay-off ("Pays off"; scenes read in the walk's order, a side
//   story where it is added), told as of a point: overdue (that chapter is over and it is still open), due now (the
//   chapter being written), or later. What the story says is as of the point; Adam's plans and the cards' plans are
//   read as they stand now (they are his current plan, not facts of the story);
// - what is worth a look (Worth a look, keeper/checkQueue.ts; the board): a thread still open past its due chapter, or
//   one with no due date at all untouched for a long stretch (longQuiet), unless Adam said Keep to it.
// Pure: memory/scene.ts (the writer's scene memory, overdueThreads), worldViews/threads.ts (the board) and
// keeper/checkQueue.ts read the world and pass it in. Tested in promises.test.ts.

import type { ID, ThreadDue, ThreadPlan, ThreadStanding, ThreadState } from '@shared/types'
import { QUIET_SCENES } from '@shared/contracts/worldViews'
import type { Line, WorldShape } from './types'
import type { ThreadTouch } from './threadQuiet'

/**
 * Untouched for this many scenes with words, at least, is a long stretch: twice the QUIET_SCENES after which the writer
 * is gently reminded of a thread, so Adam is asked only once the reminders haven't brought it back.
 */
export const LONG_QUIET_MIN = QUIET_SCENES * 2
/** ...and at least this share of the story written so far: a quarter of a long book is a long time to forget a thread. */
export const LONG_QUIET_SHARE = 0.25

/**
 * How many scenes with words a thread may go untouched before it is worth a look, for a story with `written` scenes
 * with words: a quarter of them, never fewer than LONG_QUIET_MIN. 12 for anything up to 48 scenes, 25 at 100, 50 at 200.
 */
export const longQuiet = (written: number): number => Math.max(LONG_QUIET_MIN, Math.ceil(Math.max(0, written) * LONG_QUIET_SHARE))

/** A chapter as "Pay off by" offers it: "Ch 6 · The Ferry", or "Ch 6" when its title is only "Chapter 6" (or none). */
export function chapterChoice(n: number, title: string): string {
  const t = title.replace(/\s+/g, ' ').trim()
  return !t || /^(chapter|ch\.?)\s*\d+$/i.test(t) ? `Ch ${n}` : `Ch ${n} · ${t}`
}

/**
 * The point due dates are told against: the scene being written (not on its own line, so everything on the line has
 * happened by it), or the latest scene with words in the story (`written`: the scenes with words; the line runs on to
 * the story's end).
 */
export type DueNow = { sceneId: ID } | { written: Set<ID> }

export interface PromiseInput {
  /** The story being written or looked at: a due chapter in it is told "Ch 5", one in another story "Book 2, Ch 5". */
  storyId: ID
  shape: WorldShape
  line: Line
  threads: ThreadState[]
  /** Where each thread was last touched, and first opened, on the line (threadTouches). */
  touches: Map<ID, ThreadTouch>
  plans: Map<ID, ThreadPlan>
  /** The plot threads each scene's card plans to pay off (its "Pays off"), by scene. */
  paysOff: Map<ID, ID[]>
  now: DueNow
}

export interface PromiseRow {
  standing: ThreadStanding
  /** The scene a thread change first opened it in (none: opened at a story's start, or never on the line). */
  setUpSceneId?: ID
  /** The last scene after its opening that touched it, while it isn't paid off. */
  advanced?: { sceneId: ID; storyId: ID }
  /** When it is due: Adam's chapter, else a scene card's plan. */
  due?: ThreadDue
  /** A scene card's plan for its pay-off, whether or not Adam chose a chapter (what "As the cards plan" means). */
  cardDue?: ThreadDue
}

interface ScenePlace {
  storyId: ID
  chapterId: ID
  chapterNo: number
  sceneNo: number
  /** Reading order: the walk's order on the line (a side story where it sits in its host), then the story's own after it. */
  order: number
}

/** Where each thread stands as of the point, with its set-up, last step on and due date. */
export function promiseLedger(input: PromiseInput): Map<ID, PromiseRow> {
  const { shape, line, plans, touches } = input
  const titles = new Map(shape.stories.map((s) => [s.id, s.title]))
  const chapters = new Map<ID, { storyId: ID; n: number }>()
  for (const s of shape.stories) s.chapters.forEach((c, i) => chapters.set(c.id, { storyId: s.id, n: i + 1 }))
  // Every scene in reading order: those on the line in the order the walk reaches them (a side story's where it is added
  // in its host, never after the host's whole story), then this story's own scenes past the point, in story order (for a
  // scene card's plan still to come). Scenes of other stories past where the line leaves them aren't on this line.
  const where = new Map<ID, Omit<ScenePlace, 'order'>>()
  for (const s of shape.stories)
    s.chapters.forEach((c, ci) => c.scenes.forEach((sc, si) => where.set(sc.id, { storyId: s.id, chapterId: c.id, chapterNo: ci + 1, sceneNo: si + 1 })))
  const scenes = new Map<ID, ScenePlace>()
  const put = (id: ID): void => {
    const at = where.get(id)
    if (at && !scenes.has(id)) scenes.set(id, { ...at, order: scenes.size })
  }
  for (const step of line.steps) if (step.type === 'scene') put(step.sceneId)
  for (const c of shape.stories.find((s) => s.id === input.storyId)?.chapters ?? []) for (const sc of c.scenes) put(sc.id)

  // How far the story has got: the steps that have happened, and the chapter being written.
  let passedUpTo = -1
  let nowChapter: ID | null = null
  let nowScene: ID | null = null
  if ('sceneId' in input.now) {
    passedUpTo = line.steps.length - 1
    nowScene = input.now.sceneId
    nowChapter = scenes.get(nowScene)?.chapterId ?? null
  } else {
    const written = input.now.written
    line.steps.forEach((step, i) => {
      if (step.type === 'scene' && step.storyId === input.storyId && written.has(step.sceneId)) {
        passedUpTo = i
        nowScene = step.sceneId
        nowChapter = step.chapterId
      }
    })
  }
  const passedScene = new Set<ID>()
  const passedChapter = new Set<ID>()
  line.steps.forEach((step, i) => {
    if (i > passedUpTo) return
    if (step.type === 'scene') passedScene.add(step.sceneId)
    else if (step.type === 'chapter-end') passedChapter.add(step.chapterId)
  })

  const chapterLabel = (id: ID): string => {
    const c = chapters.get(id)!
    return c.storyId === input.storyId ? `Ch ${c.n}` : `${titles.get(c.storyId) ?? 'Another story'}, Ch ${c.n}`
  }
  const sceneLabel = (p: ScenePlace): string =>
    p.storyId === input.storyId ? `Ch ${p.chapterNo}, Sc ${p.sceneNo}` : `${titles.get(p.storyId) ?? 'Another story'}, Ch ${p.chapterNo}, Sc ${p.sceneNo}`
  const stateOf = (chapterId: ID, scene?: ID): ThreadDue['state'] => {
    if (chapterId === nowChapter) {
      // A scene card's plan later in this chapter is still to come: that scene's card says "this scene pays it off".
      if (scene && scene !== nowScene && !passedScene.has(scene)) return 'later'
      return 'now'
    }
    return passedChapter.has(chapterId) ? 'overdue' : 'later'
  }

  // The first scene whose card plans each thread's pay-off: at or after where it was set up, else the first anywhere.
  const planned = (threadId: ID, setUpOrder: number): { sceneId: ID; at: ScenePlace } | null => {
    let first: { sceneId: ID; at: ScenePlace } | null = null
    let after: { sceneId: ID; at: ScenePlace } | null = null
    for (const [sceneId, ids] of input.paysOff) {
      if (!ids.includes(threadId)) continue
      const at = scenes.get(sceneId)
      if (!at) continue
      if (!first || at.order < first.at.order) first = { sceneId, at }
      if (at.order >= setUpOrder && (!after || at.order < after.at.order)) after = { sceneId, at }
    }
    return after ?? first
  }

  const out = new Map<ID, PromiseRow>()
  for (const t of input.threads) {
    const plan = plans.get(t.entryId)
    const touch = touches.get(t.entryId)
    const opened = touch?.opened
    // Moved on: a later touch in a scene (a story's start-of-story change has no scene to show as where).
    const moved = !!touch?.sceneId && !!opened && touch.step > opened.step
    const standing: ThreadStanding = t.status === 'resolved' ? 'paid' : plan?.dropped ? 'dropped' : moved ? 'advanced' : 'open'
    const row: PromiseRow = { standing }
    if (opened?.sceneId) row.setUpSceneId = opened.sceneId
    if (t.status !== 'resolved' && moved && touch?.sceneId) row.advanced = { sceneId: touch.sceneId, storyId: touch.storyId }
    if (t.status !== 'resolved') {
      const setUpOrder = opened?.sceneId ? (scenes.get(opened.sceneId)?.order ?? -1) : -1
      const p = planned(t.entryId, setUpOrder)
      if (p)
        row.cardDue = {
          chapterId: p.at.chapterId,
          label: chapterLabel(p.at.chapterId),
          from: 'card',
          sceneId: p.sceneId,
          sceneLabel: sceneLabel(p.at),
          state: stateOf(p.at.chapterId, p.sceneId)
        }
      // Adam's chapter while it is in the story; one only in Recently deleted is read as none of his, so the cards' plan
      // holds (one gone for good is cleared from the plan: db/threadPlans.ts clearGoneChapters).
      if (plan?.payBy && chapters.has(plan.payBy)) row.due = { chapterId: plan.payBy, label: chapterLabel(plan.payBy), from: 'adam', state: stateOf(plan.payBy) }
      else if (row.cardDue) row.due = row.cardDue
    }
    out.set(t.entryId, row)
  }
  return out
}

/** A plot thread worth a look: still open past its due chapter, or untouched for a long stretch. */
export interface ThreadWarning {
  threadId: ID
  why: 'overdue' | 'quiet'
  /** For 'overdue': the chapter it was due by. */
  due?: ThreadDue
  /** For 'quiet': how many scenes with words since it was last touched, and that touch. */
  quiet?: number
  touch?: ThreadTouch
}

/**
 * The threads worth a look in a story, as of the point the ledger was told against: open or advanced (never paid off,
 * dropped, or only planned), and either overdue (unless Adam said Keep for that due chapter) or untouched for a long
 * stretch. A thread with any due date (Adam's Pay off by, or a scene card's plan, even one still to come) is never asked
 * about as untouched: it is planned, and once its chapter is over it is overdue instead. One with none is asked about
 * when untouched for longQuiet(written) scenes with words since it was last touched in this story, or before any story
 * began (a thread last touched in an earlier book isn't asked about until this story touches it, as the writer's
 * reminder does). Keep on a quiet one holds while nothing touches it, until another long stretch has gone by. Overdue
 * first, then the quietest.
 */
export function threadWarnings(input: {
  storyId: ID
  threads: ThreadState[]
  rows: Map<ID, PromiseRow>
  touches: Map<ID, ThreadTouch>
  plans: Map<ID, ThreadPlan>
  /** The scenes with words in this story, up to the point (writtenUpTo). */
  written: number
}): ThreadWarning[] {
  const stretch = longQuiet(input.written)
  const out: ThreadWarning[] = []
  for (const t of input.threads) {
    const row = input.rows.get(t.entryId)
    if (t.status !== 'open' || t.planned || !row || row.standing === 'dropped' || row.standing === 'paid') continue
    const kept = input.plans.get(t.entryId)?.kept
    // Any due date, even one still to come: planned, so never "untouched"; overdue once its chapter is over.
    if (row.due) {
      if (row.due.state === 'overdue' && kept?.due !== row.due.chapterId) out.push({ threadId: t.entryId, why: 'overdue', due: row.due })
      continue
    }
    const touch = input.touches.get(t.entryId)
    // A touch before any story began (a baseline change, storyId '') counts as this story's.
    if (!touch || (touch.storyId !== input.storyId && touch.storyId !== '') || touch.quiet < stretch) continue
    const keptHere = kept && kept.touch !== undefined && (kept.touch ?? null) === (touch.sceneId ?? null) && touch.quiet < (kept.quiet ?? 0) + stretch
    if (!keptHere) out.push({ threadId: t.entryId, why: 'quiet', quiet: touch.quiet, touch })
  }
  return out.sort((a, b) => (a.why === b.why ? (b.quiet ?? 0) - (a.quiet ?? 0) : a.why === 'overdue' ? -1 : 1))
}

/** How many scenes with words in this story the line reaches (as of its point: none after it count). */
export function writtenUpTo(line: Line, storyId: ID, written: Set<ID>): number {
  let n = 0
  for (const step of line.steps) if (step.type === 'scene' && step.storyId === storyId && written.has(step.sceneId)) n++
  return n
}
