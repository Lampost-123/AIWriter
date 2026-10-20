// What the Plan hub holds while the app is open, one for each story in each world (2026-10-20): what Adam wrote for what
// happens next and the threads he ticked (so leaving the page loses neither), the part he chose to plan, which rows of
// the story line are open, the facts from the main process (where the story has got to, its threads, where the plan has
// drifted), and "Update the plan" while it arrives and waits for Keep or Discard. The suggestions themselves, and a
// request still arriving, are the outline helper's session (features/outline/helperStore), so they survive leaving the
// page as they always have; "Plan it" asks through it with where they belong (RunPlace) and Adam's words as direction.

import { create } from 'zustand'
import type { HubDrift, HubThread, PlanHubFacts, PlanUpdateScene } from '@shared/contracts/planHub'
import type { BoardThread, ThreadsBoard } from '@shared/contracts/worldViews'
import type { OutlineSize } from '@shared/contracts/outline'
import type { Entry, ID, Outline, SceneCard } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { followTask } from '@/features/planning/talkStore'
import {
  checkBlank,
  helperKey,
  keepSuggestions,
  markKept,
  openHelper,
  suggestOutline,
  suggestOutlineWith,
  treeOf,
  unmarkKept,
  useOutlineHelper,
  type HelperRun
} from '@/features/outline/helperStore'
import { codexOf, pageFor } from '@/features/outline/codexNames'
import { planOnCard } from '@/features/outline/scenePlanLogic'
import { unfill } from '@/features/outline/planInterviewLogic'
import { emptySuggestedCard, outlineScenes, parseOutline, type SuggestedScene } from '@/features/outline/parse'
import { outlineTree, wordsOf, type RunPlace } from '@/features/outline/tree'
import { cardNow, patchCard } from '@/features/outline/planInterviewStore'
import { renameScene } from '@/features/binder/actions'
import type { PlanMode } from '@/features/outline/stages'
import { flushBrief } from '@/features/storyBuilder/store'
import { askFor, chapterLead, directionText, type HubScopeId, type LineChapter } from './hubLogic'
import { payoffWords, type ChapterPanel, type SceneTool } from './buildLogic'

/** "Update the plan": the drifting scene cards written again, arriving, then waiting for Keep or Discard. */
export interface PlanUpdate {
  taskId: ID
  generationId: ID | null
  sceneIds: ID[]
  /** The cards as they were when it was asked for (what Keep changes, and Undo puts back). */
  before: PlanUpdateScene[]
  text: string
  status: 'running' | 'complete' | 'stopped' | 'error'
  error: string | null
}

export interface HubState {
  /** What happens next, in Adam's own words. */
  words: string
  /** The plot threads he ticked to bring back (by id). */
  threads: ID[]
  /** The part he chose to plan; null until he picks (the hub then offers the first that makes sense). */
  scope: HubScopeId | null
  /** Rows of the story line he opened (by key), and chapters opened inside the planned stretch. */
  open: string[]
  openChapters: ID[]
  /** The scenes the drift card's Show me lit up, and when (they glow for a few seconds). */
  lit: { ids: ID[]; at: number } | null
  /** From the main process; null until first read. `rev` says which change of the story it was read after. */
  facts: PlanHubFacts | null
  factsRev: string | null
  update: PlanUpdate | null
  /** Threads "Plan its payoff" put among the threads waiting, when the facts didn't list them (open, but not the quietest). */
  seeded: HubThread[]
  /** The chapter of the story line with Plan this chapter or Write this chapter open in its row (Build with AI). */
  panel: { chapterId: ID; kind: ChapterPanel } | null
  /** The planned scene with its ideas or its interview open in its row. */
  tool: { sceneId: ID; kind: SceneTool } | null
  /** Cast and world shows "From a summary" (the World builder's build) in place of the plan from the idea. */
  summary: boolean
  /** The plot threads as the board has them, for the Threads section; null until read. */
  board: ThreadsBoard | null
  boardRev: string | null
}

const fresh = (): HubState => ({
  words: '',
  threads: [],
  scope: null,
  open: [],
  openChapters: [],
  lit: null,
  facts: null,
  factsRev: null,
  update: null,
  seeded: [],
  panel: null,
  tool: null,
  summary: false,
  board: null,
  boardRev: null
})

export const usePlanHubs = create<{ hubs: Record<string, HubState> }>(() => ({ hubs: {} }))

export const hubKey = (worldId: ID | null | undefined, storyId: ID): string => `${worldId ?? ''}:${storyId}`
const keyOf = (storyId: ID): string => hubKey(useApp.getState().world?.id, storyId)
export const hubOf = (storyId: ID): HubState => usePlanHubs.getState().hubs[keyOf(storyId)] ?? fresh()
const put = (storyId: ID, patch: Partial<HubState> | ((h: HubState) => Partial<HubState>)): void => {
  const k = keyOf(storyId)
  usePlanHubs.setState((s) => {
    const was = s.hubs[k] ?? fresh()
    return { hubs: { ...s.hubs, [k]: { ...was, ...(typeof patch === 'function' ? patch(was) : patch) } } }
  })
}

// ---------- What Adam says ----------

export const setWords = (storyId: ID, words: string): void => put(storyId, { words })
export const setScope = (storyId: ID, scope: HubScopeId): void => put(storyId, { scope })

/** Ticks a thread chip (it goes with the request), or unticks it. */
export function toggleThread(storyId: ID, threadId: ID): void {
  put(storyId, (h) => ({ threads: h.threads.includes(threadId) ? h.threads.filter((t) => t !== threadId) : [...h.threads, threadId] }))
}

/** Opens or folds a row of the story line. */
export function toggleRow(storyId: ID, rowKey: string, on?: boolean): void {
  put(storyId, (h) => {
    const has = h.open.includes(rowKey)
    const want = on ?? !has
    return { open: want ? (has ? h.open : [...h.open, rowKey]) : h.open.filter((k) => k !== rowKey) }
  })
}

/** Opens or folds one chapter inside the planned stretch. */
export function toggleChapter(storyId: ID, chapterId: ID, on?: boolean): void {
  put(storyId, (h) => {
    const has = h.openChapters.includes(chapterId)
    const want = on ?? !has
    return { openChapters: want ? (has ? h.openChapters : [...h.openChapters, chapterId]) : h.openChapters.filter((k) => k !== chapterId) }
  })
}

/** The drift card's Show me: the rows and chapters holding those scenes open, and the scenes lit for a moment. */
export function showScenes(storyId: ID, rowKeys: readonly string[], chapterIds: readonly ID[], sceneIds: readonly ID[]): void {
  put(storyId, (h) => ({
    open: [...new Set([...h.open, ...rowKeys])],
    openChapters: [...new Set([...h.openChapters, ...chapterIds])],
    lit: { ids: [...sceneIds], at: Date.now() }
  }))
}

// ---------- The facts ----------

const asking = new Map<string, number>()

/** Reads the hub's facts again (after the story changed: `rev` names the change). The page keeps what it had meanwhile. */
export async function loadFacts(storyId: ID, rev: string): Promise<void> {
  const k = keyOf(storyId)
  if (hubOf(storyId).factsRev === rev) return
  const turn = (asking.get(k) ?? 0) + 1
  asking.set(k, turn)
  try {
    const facts = await api.planHubFacts(storyId)
    if (asking.get(k) !== turn) return
    put(storyId, (h) => ({
      facts,
      factsRev: rev,
      threads: h.threads.filter((id) => facts.threads.some((t) => t.id === id) || h.seeded.some((t) => t.id === id)),
      seeded: h.seeded.filter((t) => !facts.threads.some((x) => x.id === t.id))
    }))
  } catch {
    // The story may have gone (the page says so); the hub works on without the facts.
    if (asking.get(k) === turn) put(storyId, { factsRev: rev })
  }
}

/** The threads waiting: the facts' (the quietest open ones), then any "Plan its payoff" put there. */
export const waitingThreads = (h: Pick<HubState, 'facts' | 'seeded'>): HubThread[] => [...(h.facts?.threads ?? []), ...h.seeded]

// ---------- Build with AI: what is open in the area ----------

/** Opens Plan this chapter or Write this chapter in a chapter's row (null closes it); one chapter at a time. */
export function openPanel(storyId: ID, chapterId: ID, kind: ChapterPanel | null): void {
  put(storyId, { panel: kind ? { chapterId, kind } : null })
}

/** Opens a planned scene's ideas or interview in its row (null closes it); one scene at a time. */
export function openTool(storyId: ID, sceneId: ID, kind: SceneTool | null): void {
  put(storyId, { tool: kind ? { sceneId, kind } : null })
}

/** Cast and world: "From a summary" (true) or the plan from the idea. */
export const showSummary = (storyId: ID, on: boolean): void => put(storyId, { summary: on })

const reading = new Map<string, number>()

/** Reads the plot threads board again (after the story or its memory changed: `rev` names the change). */
export async function loadBoard(storyId: ID, rev: string): Promise<void> {
  const k = keyOf(storyId)
  if (hubOf(storyId).boardRev === rev) return
  const turn = (reading.get(k) ?? 0) + 1
  reading.set(k, turn)
  try {
    const board = await api.getThreadsBoard(storyId)
    if (reading.get(k) === turn) put(storyId, { board, boardRev: rev })
  } catch {
    if (reading.get(k) === turn) put(storyId, { boardRev: rev })
  }
}

/**
 * "Plan its payoff" on a thread (the Threads section): the story line's box says to move toward paying it off, and the
 * thread is ticked among the threads waiting (put there when it wasn't), so the next request plans its payoff.
 */
export function seedPayoff(storyId: ID, t: Pick<BoardThread, 'id' | 'name' | 'promise' | 'quietScenes'>): void {
  put(storyId, (h) => {
    const listed = waitingThreads(h).some((x) => x.id === t.id)
    return {
      words: payoffWords(t),
      threads: h.threads.includes(t.id) ? h.threads : [...h.threads, t.id],
      seeded: listed ? h.seeded : [...h.seeded, { id: t.id, name: t.name, since: '', quiet: t.quietScenes ?? 0 }]
    }
  })
}

// ---------- Plan it ----------

/** What "Plan it" needs from the page: the story as the binder has it, the premise and the size chosen for a new story. */
export interface PlanItInput {
  outline: Outline
  scope: HubScopeId
  premise: string
  /** The Story builder's plot is there, so the AI may write the premise. */
  fromPlot: boolean
  size: OutlineSize
  mode: PlanMode
}

/**
 * Plan it: asks for the part chosen, with Adam's words and the threads he ticked as his direction, and where the
 * suggestions belong (they show there in the story line, and Keep puts them there). Suggestions he hadn't decided on
 * move under "Earlier suggestions", as they always have.
 */
export async function planIt(storyId: ID, input: PlanItInput): Promise<void> {
  openHelper(storyId)
  const h = hubOf(storyId)
  const ticked = waitingThreads(h).filter((t) => h.threads.includes(t.id))
  const ask = askFor(input.outline, input.scope, input.size)
  if (!ask) {
    toast('The story has changed since that was chosen. Pick what to plan again.')
    return
  }
  await flushBrief(storyId)
  const direction = directionText(h.words, ticked, ask.kind === 'outline' ? ask.part : '')
  if (ask.kind === 'whole') {
    await suggestOutline(storyId, input.premise, input.size, { premiseOptional: input.fromPlot, mode: input.mode, ...(direction ? { direction } : {}) })
    return
  }
  if (ask.kind === 'outline') {
    await suggestOutlineWith(storyId, ask.size, (taskId) => api.startOutline({ taskId, storyId, premise: input.premise, size: ask.size, direction }), {
      place: ask.place
    })
    return
  }
  if (ask.kind === 'chapters') {
    await suggestOutlineWith(
      storyId,
      { acts: 0, chapters: ask.chapters, scenes: 0 },
      (taskId) =>
        api.startOutlineStage({ taskId, storyId, level: 'chapters', actId: ask.actId, afterChapterId: ask.afterChapterId, chapters: ask.chapters, direction }),
      { place: ask.place }
    )
    return
  }
  await planScenesIn(storyId, { id: ask.chapterId, title: ask.chapterTitle }, { afterSceneId: ask.afterSceneId, count: ask.count, direction, place: ask.place })
}

/**
 * Scenes for a chapter the story has (the hub's "the next scene", "the rest of Ch 4", or "Plan its scenes" on a planned
 * chapter): read under the chapter's own heading, the chapter kept already, so each scene kept goes into it.
 */
export async function planScenesIn(
  storyId: ID,
  chapter: Pick<LineChapter, 'id' | 'title'>,
  o: { afterSceneId?: ID | null; count?: number; direction?: string; place?: RunPlace } = {}
): Promise<void> {
  openHelper(storyId)
  const lead = chapterLead(chapter.title)
  const chapterKey = outlineTree(parseOutline(lead, false))[0]?.key
  await suggestOutlineWith(
    storyId,
    { acts: 0, chapters: 1, scenes: 0 },
    (taskId) =>
      api.startOutlineStage({
        taskId,
        storyId,
        level: 'scenes',
        chapterId: chapter.id,
        ...(o.afterSceneId ? { afterSceneId: o.afterSceneId } : {}),
        ...(o.count ? { count: o.count } : {}),
        ...(o.direction ? { direction: o.direction } : {})
      }),
    { lead, decisions: chapterKey ? { [chapterKey]: { status: 'kept', id: chapter.id } } : {}, place: o.place ?? { at: 'chapter', chapterId: chapter.id } }
  )
}

/** "Plan its chapters" on an act the story has with none yet: its chapters, kept into it. */
export async function planChaptersIn(storyId: ID, actId: ID, chapters = 3): Promise<void> {
  openHelper(storyId)
  const direction = hubDirection(storyId)
  await suggestOutlineWith(
    storyId,
    { acts: 0, chapters, scenes: 0 },
    (taskId) => api.startOutlineStage({ taskId, storyId, level: 'chapters', actId, chapters, ...(direction ? { direction } : {}) }),
    { place: { at: 'act', actId } }
  )
}

// ---------- From the story line (Adam, 2026-10-20: carry on the outline of a story that already has chapters) ----------

/** What goes with a request made from the story line: Adam's words in the box and the threads he ticked. */
export function hubDirection(storyId: ID): string {
  const h = hubOf(storyId)
  const ticked = waitingThreads(h).filter((t) => h.threads.includes(t.id))
  return directionText(h.words, ticked)
}

/**
 * "Plan its scenes" on a chapter with none, or "Add scenes to Ch N" on one that has some (written or only planned): the
 * new scenes come after its last scene, told how it goes, and Keep puts them at the chapter's end.
 */
export async function addScenesTo(storyId: ID, chapter: Pick<LineChapter, 'id' | 'title' | 'scenes'>, o: { count?: number | null } = {}): Promise<void> {
  const last = chapter.scenes[chapter.scenes.length - 1]?.id ?? null
  const direction = hubDirection(storyId)
  await planScenesIn(storyId, chapter, {
    afterSceneId: last,
    // How many, when the chapter's page says (its How many scenes); else as many as it needs.
    ...(o.count ? { count: o.count } : {}),
    ...(direction ? { direction } : {}),
    place: { at: 'chapter', chapterId: chapter.id }
  })
}

/**
 * "Fill in the empty cards" of a chapter: the scenes there whose cards say nothing yet (a title, at most a When or who is
 * in it), planned from the story so far, shown as suggestions under the chapter. Keep (keepInLine) puts each only in its
 * card's empty parts.
 */
export async function fillCardsIn(storyId: ID, chapter: Pick<LineChapter, 'id' | 'title'>, sceneIds: ID[]): Promise<void> {
  if (!sceneIds.length) return
  openHelper(storyId)
  const lead = chapterLead(chapter.title)
  const chapterKey = outlineTree(parseOutline(lead, false))[0]?.key
  const direction = hubDirection(storyId)
  await suggestOutlineWith(
    storyId,
    { acts: 0, chapters: 1, scenes: sceneIds.length },
    (taskId) => api.startPlanUpdate({ taskId, storyId, sceneIds, mode: 'fill', ...(direction ? { direction } : {}) }),
    {
      lead,
      decisions: chapterKey ? { [chapterKey]: { status: 'kept', id: chapter.id } } : {},
      place: { at: 'chapter', chapterId: chapter.id },
      fill: [...sceneIds]
    }
  )
}

/** The batch these keys are in: an earlier one by its task id, else the newest. */
function batchOf(storyId: ID, runId?: ID | null): HelperRun | null {
  const s = useOutlineHelper.getState().sessions[helperKey(useApp.getState().world?.id, storyId)]
  if (!s) return null
  return runId ? (s.earlier.find((r) => r.taskId === runId) ?? (s.run?.taskId === runId ? s.run : null)) : s.run
}

/**
 * Keep, in the story line: as the outline helper keeps (new acts, chapters and scenes, where they belong), but for a
 * batch of filled cards (HelperRun.fill) each card goes on its own scene, only where that card is empty, with one Undo.
 */
export async function keepInLine(storyId: ID, keys: string[] | 'all', o: { runId?: ID | null } = {}): Promise<void> {
  const run = batchOf(storyId, o.runId)
  if (!run?.fill) return keepSuggestions(storyId, keys, null, o)
  if (run.status === 'running') return
  const nodes = treeOf(run)[0]?.children ?? []
  const fill = run.fill
  const want = nodes.flatMap((n, i) =>
    fill[i] && run.decisions[n.key]?.status !== 'kept' && run.decisions[n.key]?.status !== 'discarded' && (keys === 'all' || keys.includes(n.key))
      ? [{ n, sceneId: fill[i] }]
      : []
  )
  if (!want.length) return
  let entries: Entry[] = []
  try {
    entries = await api.listEntries()
  } catch {
    // Names then match nothing: the card keeps its own people and places.
  }
  const people = codexOf('character', entries)
  const places = codexOf('place', entries)
  const find = (list: Entry[]) => (name: string): ID | null => pageFor(name, list, entries)?.id ?? null
  const done: { key: string; sceneId: ID; patch: Partial<SceneCard> }[] = []
  try {
    for (const { n, sceneId } of want) {
      const w = wordsOf(n, run.edits[n.key])
      const planned: SuggestedScene = {
        key: n.key,
        title: w.title,
        summary: w.text,
        beats: w.beats,
        when: w.when,
        card: { ...emptySuggestedCard(), ...w.card },
        setsUp: w.setsUp,
        paysOff: w.paysOff,
        complete: true
      }
      const { patch } = planOnCard(await cardNow(sceneId), planned, { character: find(people), place: find(places) })
      if (Object.keys(patch).length) await patchCard(sceneId, patch)
      done.push({ key: n.key, sceneId, patch })
    }
  } catch (e) {
    toast((e as Error).message || 'That didn’t work. Please try again.', { tone: 'danger' })
  }
  if (!done.length) return
  markKept(storyId, run.taskId, done.map((d) => ({ key: d.key, id: d.sceneId })))
  useApp.getState().bumpOutline()
  const title = wordsOf(want[0].n, run.edits[want[0].n.key]).title.trim()
  toast(done.length === 1 ? `Filled in the card of “${title || 'the scene'}”.` : `Filled in ${done.length} scene cards.`, {
    action: {
      label: 'Undo',
      run: () =>
        void (async () => {
          for (const d of done) {
            const back = unfill(await cardNow(d.sceneId), d.patch)
            if (Object.keys(back).length) await patchCard(d.sceneId, back)
          }
          unmarkKept(storyId, run.taskId, done.map((d) => d.key))
          useApp.getState().bumpOutline()
        })().catch((e: Error) => toast(e.message || 'That didn’t work. Please try again.', { tone: 'danger' }))
    }
  })
}

/** Whether the story's suggestions have a request arriving (the hub's buttons wait for it). */
export function hubBusy(storyId: ID): boolean {
  const run = useOutlineHelper.getState().sessions[helperKey(useApp.getState().world?.id, storyId)]?.run
  return !!run && (run.status === 'running' || run.stage?.status === 'running')
}

/** The hub opened for a story: the outline helper's session, and whether the story has anything planned yet. */
export function openHub(storyId: ID): void {
  openHelper(storyId)
  void checkBlank(storyId)
}

// ---------- Update the plan ----------

/** The scene cards "Update the plan" brought, in the order asked for (as many as arrived whole). */
export function updatedCards(u: Pick<PlanUpdate, 'text' | 'status'>): { title: string; summary: string; when: string; beats: string[] }[] {
  return outlineScenes(parseOutline(u.text, u.status !== 'running'))
    .filter((s) => s.complete)
    .map((s) => ({ title: s.title.trim(), summary: s.summary.trim(), when: s.when.trim(), beats: s.beats.map((b) => b.trim()).filter(Boolean) }))
}

/** "Update the plan": the drifting cards written again, shown before anything changes. */
export async function startUpdate(storyId: ID, drift: readonly HubDrift[]): Promise<void> {
  const h = hubOf(storyId)
  if (h.update?.status === 'running' || !drift.length) return
  const sceneIds = drift.map((d) => d.sceneId)
  const taskId = crypto.randomUUID()
  let before: PlanUpdateScene[] = []
  try {
    before = await api.planUpdateScenes(sceneIds)
  } catch {
    before = []
  }
  put(storyId, { update: { taskId, generationId: null, sceneIds, before, text: '', status: 'running', error: null } })
  const still = (): boolean => hubOf(storyId).update?.taskId === taskId
  try {
    const done = await followTask(
      taskId,
      async () => {
        const { generationId } = await api.startPlanUpdate({ taskId, storyId, sceneIds })
        if (still()) put(storyId, (x) => (x.update ? { update: { ...x.update, generationId } } : {}))
      },
      (text) => {
        if (still()) put(storyId, (x) => (x.update ? { update: { ...x.update, text } } : {}))
      }
    )
    if (!still()) return
    put(storyId, (x) =>
      x.update
        ? {
            update: {
              ...x.update,
              text: done.text,
              status: done.status === 'complete' ? 'complete' : done.status === 'stopped' ? 'stopped' : 'error',
              error: done.status === 'error' ? (done.error ?? 'Something went wrong while the plan was updated. Please try again.') : null
            }
          }
        : {}
    )
  } catch (e) {
    if (still()) put(storyId, (x) => (x.update ? { update: { ...x.update, status: 'error', error: (e as Error).message || 'That didn’t work. Please try again.' } } : {}))
  }
}

export function stopUpdate(storyId: ID): void {
  const u = hubOf(storyId).update
  if (u?.status === 'running') void api.stopTask(u.taskId).catch(() => undefined)
}

/** Discard: nothing changes, and the update goes. */
export function discardUpdate(storyId: ID): void {
  stopUpdate(storyId)
  put(storyId, { update: null })
}

/**
 * Keep these changes: each card the update brought goes on its scene (its title, When, what happens and beats), with one
 * Undo that puts every card back as it was.
 */
export async function keepUpdate(storyId: ID): Promise<void> {
  const u = hubOf(storyId).update
  if (!u || u.status === 'running') return
  const cards = updatedCards(u)
  const was: { sceneId: ID; title: string; card: SceneCard }[] = []
  try {
    for (const [i, sceneId] of u.sceneIds.entries()) {
      const next = cards[i]
      if (!next) break
      const card = await cardNow(sceneId)
      const title = u.before.find((b) => b.sceneId === sceneId)?.title ?? ''
      was.push({ sceneId, title, card })
      await patchCard(sceneId, {
        goal: next.summary || card.goal,
        beats: next.beats.length ? next.beats : card.beats,
        ...(next.when ? { when: next.when } : {})
      })
      if (next.title && next.title !== title) await renameScene(sceneId, next.title)
    }
  } catch (e) {
    toast((e as Error).message || 'That didn’t work. Please try again.', { tone: 'danger' })
  }
  put(storyId, { update: null })
  useApp.getState().bumpOutline()
  if (!was.length) return
  toast(`Updated the plan: ${was.length === 1 ? '1 scene card' : `${was.length} scene cards`} now follow what you’ve written.`, {
    action: {
      label: 'Undo',
      run: () =>
        void (async () => {
          for (const w of was) {
            await patchCard(w.sceneId, { goal: w.card.goal, beats: w.card.beats, when: w.card.when })
            if (w.title) await renameScene(w.sceneId, w.title)
          }
          useApp.getState().bumpOutline()
        })().catch((e: Error) => toast(e.message || 'That didn’t work. Please try again.', { tone: 'danger' }))
    }
  })
}
