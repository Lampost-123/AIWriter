// "Interview me" on a scene card or a chapter, while the app is open: one interview for each scene and
// each chapter in each world, so moving to another scene and back finds it as it was. The AI asks one
// short question at a time about what the card or chapter doesn't already say (one request per question);
// Adam answers in his own words (typed or dictated), skips, or says he's done, and the AI may say it has
// enough. His answers are never stored: they are sent with each request and used once at the end.
//
// At the end, a scene's card gets the AI's answer in its empty parts only (planInterviewLogic.fillOnCard),
// with Undo in a toast; a chapter is planned on the outline helper's page (helperStore.suggestChapter): its
// goal, if it has none, and scene cards to keep, edit or discard. PlanInterview.tsx draws it.

import { create } from 'zustand'
import type { PlanAnswer, PlanTarget } from '@shared/contracts/outline'
import { emptySceneCard } from '@shared/defaults'
import type { ID, SceneCard } from '@shared/types'
import { toast } from '@/components/ui'
import { api, ApiError, onEvent } from '@/lib/api'
import { registerDiscarder } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { fillOnCard, filledMessage, unfill } from './planInterviewLogic'
import { chapterHelperKey, suggestChapter, treeOf, useOutlineHelper } from './helperStore'
import { cardNames } from './tree'
import type { ChapterCardNames } from '@shared/contracts/chapterCards'
import { notifyChapterCard, scenesWord } from '@/features/chapterCard/chapterCardEvents'

export interface PlanProblem {
  message: string
  code?: string
}

export interface PlanSession {
  target: PlanTarget
  /**
   * 'asking' while the next question is on its way; 'question' while it waits for an answer; 'filling'
   * while a scene's card is being filled; 'problem' when asking or filling failed.
   */
  phase: 'asking' | 'question' | 'filling' | 'problem'
  /** The request on its way (Stop stops it). */
  taskId: ID | null
  topic: string
  question: string
  /** The answer box. */
  answer: string
  /** Questions asked so far, oldest first, with Adam's answers. */
  asked: PlanAnswer[]
  problem: PlanProblem | null
  /** What failed: asking for a question, or filling the card (Try again does that again). */
  failed: 'ask' | 'fill' | null
}

export const usePlanInterview = create<{ sessions: Record<string, PlanSession> }>(() => ({ sessions: {} }))

const targetId = (t: PlanTarget): ID => (t.kind === 'scene' ? t.sceneId : t.chapterId)
/** The session's key: the scene or chapter, in the world that is open. */
export const planKey = (worldId: ID | null | undefined, t: PlanTarget): string => `${worldId ?? ''}:${t.kind}:${targetId(t)}`
const keyOf = (t: PlanTarget): string => planKey(useApp.getState().world?.id, t)

const get = (key: string): PlanSession | undefined => usePlanInterview.getState().sessions[key]
const put = (key: string, s: PlanSession | null): void =>
  usePlanInterview.setState((st) => {
    const sessions = { ...st.sessions }
    if (s) sessions[key] = s
    else delete sessions[key]
    return { sessions }
  })
const patch = (key: string, p: Partial<PlanSession>): void => {
  const s = get(key)
  if (s) put(key, { ...s, ...p })
}

/** Answers Adam gave (not skipped). */
export const answeredOf = (s: Pick<PlanSession, 'asked'>): number => s.asked.filter((a) => !a.skipped && a.answer.trim()).length

// ---------- The scene card on screen ----------

interface LiveCard {
  current: () => SceneCard | null
  patch: (p: Partial<SceneCard>) => void
}

/** The scene card forms on screen, so what the interview puts in (and its Undo) shows at once and saves as typing does. */
const liveCards = new Map<ID, LiveCard>()

export function registerInterviewCard(sceneId: ID, card: LiveCard): () => void {
  liveCards.set(sceneId, card)
  return () => {
    if (liveCards.get(sceneId) === card) liveCards.delete(sceneId)
  }
}

async function cardNow(sceneId: ID): Promise<SceneCard> {
  const live = liveCards.get(sceneId)?.current()
  if (live) return live
  const scene = await api.getScene(sceneId)
  return { ...emptySceneCard(), ...scene.card }
}

async function patchCard(sceneId: ID, p: Partial<SceneCard>): Promise<void> {
  const live = liveCards.get(sceneId)
  if (live) return live.patch(p)
  const now = await cardNow(sceneId)
  await api.updateSceneCard(sceneId, { ...now, ...p })
  useApp.getState().bumpBriefing()
}

// ---------- Asking ----------

/** Starts an interview about the scene or chapter as it stands, or carries on with the one open. */
export function startPlanInterview(target: PlanTarget): void {
  const key = keyOf(target)
  if (get(key)) return
  put(key, { target, phase: 'asking', taskId: null, topic: '', question: '', answer: '', asked: [], problem: null, failed: null })
  void askNext(key)
}

/** Asks for the next question. A reply to a request that was stopped or replaced is dropped. */
async function askNext(key: string): Promise<void> {
  const s = get(key)
  if (!s) return
  const taskId = crypto.randomUUID()
  put(key, { ...s, phase: 'asking', taskId, topic: '', question: '', problem: null, failed: null })
  const still = (): boolean => get(key)?.taskId === taskId
  try {
    const card = s.target.kind === 'scene' ? await cardNow(s.target.sceneId) : null
    if (!still()) return
    const q = await api.askPlanQuestion({ taskId, target: s.target, card, asked: s.asked })
    if (!still()) return
    if (q.status === 'complete' && q.done) void finish(key, true)
    else if (q.status === 'complete') patch(key, { phase: 'question', taskId: null, topic: q.topic, question: q.question })
    else if (q.status === 'error')
      patch(key, { phase: 'problem', taskId: null, failed: 'ask', problem: { message: q.error ?? 'Something went wrong. Try again.' } })
    // Stopped without Stop (the world closed): the interview ends.
    else put(key, null)
  } catch (e) {
    if (!still()) return
    patch(key, {
      phase: 'problem',
      taskId: null,
      failed: 'ask',
      problem: { message: (e as Error).message, code: e instanceof ApiError ? e.code : undefined }
    })
  }
}

export function setPlanAnswer(target: PlanTarget, answer: string): void {
  patch(keyOf(target), { answer })
}

/** The typed answer joins the interview (true), when there is one and a question waiting for it. */
function takeAnswer(key: string): boolean {
  const s = get(key)
  if (!s || s.phase !== 'question' || !s.answer.trim()) return false
  put(key, { ...s, answer: '', asked: [...s.asked, { topic: s.topic, question: s.question, answer: s.answer.trim(), skipped: false }] })
  return true
}

/** Adds the answer and asks the next question. */
export function answerPlanQuestion(target: PlanTarget): void {
  const key = keyOf(target)
  if (takeAnswer(key)) void askNext(key)
}

/** Leaves this question unanswered (its topic isn't asked about again) and asks the next one. */
export function skipPlanQuestion(target: PlanTarget): void {
  const key = keyOf(target)
  const s = get(key)
  if (!s || s.phase !== 'question') return
  put(key, { ...s, answer: '', asked: [...s.asked, { topic: s.topic, question: s.question, answer: '', skipped: true }] })
  void askNext(key)
}

/** Tries again what failed: the question, or filling the card. */
export function retryPlan(target: PlanTarget): void {
  const key = keyOf(target)
  const s = get(key)
  if (s?.phase !== 'problem') return
  if (s.failed === 'fill') void finish(key)
  else void askNext(key)
}

/**
 * Done, or Stop: an answer typed but not yet sent joins the others, then a scene's card is filled from them
 * and a chapter is planned from them. With no answers at all, the interview just closes.
 */
export function finishPlanInterview(target: PlanTarget): void {
  const key = keyOf(target)
  const s = get(key)
  if (!s || s.phase === 'filling') return
  takeAnswer(key)
  if (s.taskId) void api.stopTask(s.taskId).catch(() => undefined)
  void finish(key)
}

/** Closes the interview without using the answers (Stop while the card is being filled). */
export function closePlanInterview(target: PlanTarget): void {
  const key = keyOf(target)
  const s = get(key)
  put(key, null)
  if (s?.taskId) void api.stopTask(s.taskId).catch(() => undefined)
}

/** `byAI`: the AI said it had enough (rather than Adam pressing Done or Stop). */
async function finish(key: string, byAI = false): Promise<void> {
  const s = get(key)
  if (!s) return
  if (!answeredOf(s)) {
    put(key, null)
    if (byAI) {
      toast(
        s.target.kind === 'scene'
          ? 'The AI had nothing to ask: the scene card and the outline already cover it.'
          : 'The AI had nothing to ask about this chapter. You can suggest scenes from what it already has.'
      )
    }
    return
  }
  if (s.target.kind === 'chapter') {
    put(key, null)
    chapterAnswers.set(key, s.asked)
    void planChapter(s.target.chapterId, s.asked)
    return
  }
  const sceneId = s.target.sceneId
  const taskId = crypto.randomUUID()
  put(key, { ...s, phase: 'filling', taskId, topic: '', question: '', problem: null, failed: null })
  const still = (): boolean => get(key)?.taskId === taskId
  try {
    const card = await cardNow(sceneId)
    if (!still()) return
    const out = await api.fillSceneCard({ taskId, sceneId, card, answers: s.asked })
    if (!still()) return
    if (out.status === 'error') {
      patch(key, { phase: 'problem', taskId: null, failed: 'fill', problem: { message: out.error ?? 'Something went wrong. Try again.' } })
      return
    }
    put(key, null)
    if (out.status !== 'complete') return
    // As the card is now: anything Adam typed while it was being filled stays.
    const { patch: fill, names } = fillOnCard(await cardNow(sceneId), out.fill)
    if (names.length) await patchCard(sceneId, fill)
    toast(filledMessage(names), names.length ? { action: { label: 'Undo', run: () => void undoFill(sceneId, fill) } } : undefined)
  } catch (e) {
    if (!still()) return
    patch(key, {
      phase: 'problem',
      taskId: null,
      failed: 'fill',
      problem: { message: (e as Error).message, code: e instanceof ApiError ? e.code : undefined }
    })
  }
}

async function undoFill(sceneId: ID, fill: Partial<SceneCard>): Promise<void> {
  try {
    const back = unfill(await cardNow(sceneId), fill)
    if (Object.keys(back).length) await patchCard(sceneId, back)
  } catch (e) {
    toast((e as Error).message || 'That didn’t work. Please try again.', { tone: 'danger' })
  }
}

// ---------- A chapter ----------

/** The answers of each chapter's last interview, so suggesting again uses them too. */
const chapterAnswers = new Map<string, PlanAnswer[]>()

/** The answers the chapter's last interview ended with (none if it had none). */
export const lastChapterAnswers = (chapterId: ID): PlanAnswer[] => chapterAnswers.get(keyOf({ kind: 'chapter', chapterId })) ?? []

/** The story each chapter planned here is in, so it is found even after Adam opens another story. */
const chapterStories = new Map<ID, ID>()
export const noteChapterStory = (chapterId: ID, storyId: ID): void => void chapterStories.set(chapterId, storyId)

/** The chapter's story, title and goal: from the binder's outline when it shows the chapter's story, else asked for. */
async function chapterInfo(chapterId: ID): Promise<{ storyId: ID; title: string; goal: string } | null> {
  const o = useOutlineStore.getState().outline
  const c = o?.chapters.find((x) => x.id === chapterId)
  if (o && c) return { storyId: o.story.id, title: c.title, goal: c.goal }
  const storyId = chapterStories.get(chapterId)
  if (!storyId) return null
  try {
    const found = (await api.getOutline(storyId)).chapters.find((x) => x.id === chapterId)
    return found ? { storyId, title: found.title, goal: found.goal } : null
  } catch {
    return null
  }
}

/** Plans the chapter on the outline helper's page: its goal (if it has none) and scene cards to keep. */
export async function planChapter(chapterId: ID, answers: PlanAnswer[]): Promise<void> {
  const info = await chapterInfo(chapterId)
  if (!info) {
    toast('Couldn’t find that chapter to plan. It may have been deleted.')
    return
  }
  const running = useOutlineHelper.getState().sessions[chapterHelperKey(useApp.getState().world?.id, info.storyId, chapterId)]?.run
  if (running?.status === 'running') {
    toast('Scene cards for this chapter are still being suggested. Your answers are used when you suggest again.')
    return
  }
  listen()
  await suggestChapter(info.storyId, chapterId, info.title, answers)
}

let listening = false
/** A chapter's plan that ends with a goal gives it to the chapter, if the chapter still has none. */
function listen(): void {
  if (listening) return
  listening = true
  onEvent('task:done', (d) => {
    // Only a whole reply: one stopped part way may have only half the goal.
    if (d.job !== 'outline' || d.status !== 'complete') return
    const found = Object.entries(useOutlineHelper.getState().sessions).find(([, s]) => s.run?.taskId === d.taskId)
    const run = found?.[1].run
    if (!found || !run?.lead) return
    const chapterId = found[0].slice(found[0].lastIndexOf('#') + 1)
    const chapter = treeOf({ ...run, text: d.text, status: 'complete' })[0]
    const goal = chapter?.text.replace(/\s+/g, ' ').trim()
    if (goal) void giveGoal(chapterId, goal)
    // Chapter cards: the point of view, characters, location, When and mood it gave the chapter fill its card's empty parts.
    const names = cardNames(chapter?.card, true)
    if (names) void giveCard(chapterId, names)
  })
}

async function giveCard(chapterId: ID, names: ChapterCardNames): Promise<void> {
  let out: Awaited<ReturnType<typeof api.fillChapterCard>>
  try {
    out = await api.fillChapterCard(chapterId, names)
  } catch {
    return
  }
  if (!out.filled.length) return
  notifyChapterCard()
  const scenes = out.updated.length ? ` and ${scenesWord(out.updated.length)} in it` : ''
  toast(`Filled in the chapter card${scenes} from the plan.`, {
    action: {
      label: 'Undo',
      run: async () => {
        await api.restoreChapterCard(chapterId, out.before, out.updated).catch(() => undefined)
        notifyChapterCard()
      }
    }
  })
}

async function giveGoal(chapterId: ID, goal: string): Promise<void> {
  const info = await chapterInfo(chapterId)
  if (!info || info.goal.trim()) return
  try {
    await api.updateChapter(chapterId, { goal })
  } catch {
    return
  }
  useApp.getState().bumpOutline()
  toast('Gave the chapter a goal from your answers.', {
    action: {
      label: 'Undo',
      run: async () => {
        const now = await chapterInfo(chapterId)
        if (!now || now.goal.trim() !== goal) return
        await api.updateChapter(chapterId, { goal: '' }).catch(() => undefined)
        useApp.getState().bumpOutline()
      }
    }
  })
}

// After a backup is restored, the interviews were about cards and chapters that may no longer be there.
registerDiscarder(() => {
  for (const s of Object.values(usePlanInterview.getState().sessions)) if (s.taskId) void api.stopTask(s.taskId).catch(() => undefined)
  usePlanInterview.setState({ sessions: {} })
})
