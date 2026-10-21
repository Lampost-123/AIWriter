// What the Story builder holds while the app is open, one for each story (contracts/storyBuilder.ts): the brief as
// Adam types it (saved silently a moment after each change, and before the window closes), the questions, the codex
// list and its build, and the recipe. The outline is the outline helper's own session (features/outline/helperStore),
// asked for with the Story builder's request. AI calls keep going when he leaves the page.

import { create } from 'zustand'
import type { BriefAnswer, CodexItem, StoryBrief } from '@shared/contracts/storyBuilder'
import { emptyBrief } from '@shared/contracts/storyBuilder'
import type { OutlineSize } from '@shared/contracts/outline'
import type { Recipe, RecipeParts } from '@shared/contracts/recipes'
import type { WorldBuildDone, WorldBuildProgress } from '@shared/contracts/worldBuilder'
import type { EntryKind, ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api, ApiError, onEvent } from '@/lib/api'
import { registerFlusher } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { say, settlePreview, talkOf } from '@/features/planning/talkStore'
import { setKeepBuild } from '@/features/outline/helperStore'
import { defaultSize } from '@/features/outline/size'
import { madeWords } from '@/features/worldBuilder/storyBuild'

export type Step = 'idea' | 'codex' | 'outline' | 'done'

export interface Question {
  taskId: ID | null
  topic: string
  question: string
  error: string | null
}

export interface ItemRedo {
  note: string
  taskId: ID | null
  item: CodexItem | null
  error: string | null
}

export interface CodexBuild {
  buildId: ID
  status: 'running' | 'complete' | 'cancelled' | 'error'
  step: string
  made: number
  words: string
  runId: ID | null
  error: string | null
}

export interface Builder {
  brief: StoryBrief | null
  /** The recipe the brief names, as the library has it (null while loading, or when gone). */
  recipe: Recipe | null
  question: Question | null
  codexTask: ID | null
  codexError: string | null
  redos: Record<string, ItemRedo>
  build: CodexBuild | null
  /** Something was typed in an idea box while the app runs: an emptied box no longer shows the premise. */
  ideaTyped: boolean
  /** The brief couldn't be read: nothing is saved over it until a real one loads (Try again calls loadBrief). */
  briefFailed: boolean
}

const fresh = (): Builder => ({ brief: null, recipe: null, question: null, codexTask: null, codexError: null, redos: {}, build: null, ideaTyped: false, briefFailed: false })

export const useBuilders = create<{ builders: Record<string, Builder> }>(() => ({ builders: {} }))

export const builderKey = (storyId: ID): string => `${useApp.getState().world?.id ?? ''}:${storyId}`
const get = (storyId: ID): Builder => useBuilders.getState().builders[builderKey(storyId)] ?? fresh()
const put = (storyId: ID, patch: Partial<Builder>): void => {
  const k = builderKey(storyId)
  useBuilders.setState((s) => ({ builders: { ...s.builders, [k]: { ...(s.builders[k] ?? fresh()), ...patch } } }))
}

// ---------- The brief ----------

const timers = new Map<ID, ReturnType<typeof setTimeout>>()
const pending = new Map<ID, { worldId: ID | undefined; brief: StoryBrief }>()

async function saveNow(storyId: ID): Promise<void> {
  const t = timers.get(storyId)
  if (t) clearTimeout(t)
  timers.delete(storyId)
  const p = pending.get(storyId)
  pending.delete(storyId)
  if (!p || p.worldId !== useApp.getState().world?.id) return
  try {
    await api.saveStoryBrief(storyId, p.brief)
  } catch (e) {
    if (!(e instanceof ApiError && e.code === 'no-story')) console.warn('Could not keep the story’s idea', e)
  }
}

registerFlusher(async () => {
  await Promise.all([...pending.keys()].map((id) => saveNow(id)))
})

export async function loadBrief(storyId: ID): Promise<void> {
  if (get(storyId).brief) return
  try {
    const brief = await api.getStoryBrief(storyId)
    if (get(storyId).brief) return
    put(storyId, { brief, briefFailed: false })
    if (brief.built) setKeepBuild(storyId, 'new-pages')
    if (brief.recipe) void loadRecipe(storyId, brief.recipe.id)
  } catch (e) {
    // An empty brief put in here would be saved over the real one at the next change.
    console.warn('Could not read the story’s idea', e)
    if (!get(storyId).brief) put(storyId, { briefFailed: true })
  }
}

/** The idea as typed in either of its boxes (Your idea, Plan your story): the brief's plot. */
export function writeIdea(storyId: ID, plot: string): void {
  put(storyId, { ideaTyped: true })
  patchBrief(storyId, { plot })
}

export function patchBrief(storyId: ID, patch: Partial<StoryBrief> | ((b: StoryBrief) => Partial<StoryBrief>)): void {
  // Not loaded (or the load failed): a change made now would save a whole empty brief over the real one.
  const b = get(storyId).brief
  if (!b) return
  const next = { ...b, ...(typeof patch === 'function' ? patch(b) : patch) }
  put(storyId, { brief: next })
  pending.set(storyId, { worldId: useApp.getState().world?.id, brief: next })
  const t = timers.get(storyId)
  if (t) clearTimeout(t)
  timers.set(storyId, setTimeout(() => void saveNow(storyId), 400))
}

export const briefOf = (storyId: ID): StoryBrief => get(storyId).brief ?? emptyBrief()

/** Saves the brief now, if a change is waiting (before an AI call reads it). */
export const flushBrief = (storyId: ID): Promise<void> => saveNow(storyId)

// ---------- Questions ----------

export async function askQuestion(storyId: ID): Promise<void> {
  if (get(storyId).question?.taskId) return
  await saveNow(storyId)
  const taskId = crypto.randomUUID()
  put(storyId, { question: { taskId, topic: '', question: '', error: null } })
  try {
    const q = await api.askStoryQuestion({ taskId, storyId, asked: briefOf(storyId).answers })
    if (get(storyId).question?.taskId !== taskId) return
    if (q.status === 'stopped') return put(storyId, { question: null })
    if (q.status === 'error' || !q.question) return put(storyId, { question: { taskId: null, topic: '', question: '', error: q.error ?? 'No question came back. Please try again.' } })
    put(storyId, { question: { taskId: null, topic: q.topic, question: q.question, error: null } })
  } catch (e) {
    if (get(storyId).question?.taskId === taskId) put(storyId, { question: { taskId: null, topic: '', question: '', error: (e as Error).message } })
  }
}

export function stopQuestion(storyId: ID): void {
  const q = get(storyId).question
  if (q?.taskId) void api.stopTask(q.taskId).catch(() => undefined)
  put(storyId, { question: null })
}

export function answerQuestion(storyId: ID, answer: string): void {
  const q = get(storyId).question
  if (!q || !q.question) return
  const a: BriefAnswer = { topic: q.topic, question: q.question, answer: answer.trim() }
  if (a.answer) patchBrief(storyId, (b) => ({ answers: [...b.answers, a] }))
  put(storyId, { question: null })
  if (a.answer) void askQuestion(storyId)
}

export function removeAnswer(storyId: ID, index: number): void {
  patchBrief(storyId, (b) => ({ answers: b.answers.filter((_, i) => i !== index) }))
}

// ---------- The recipe ----------

async function loadRecipe(storyId: ID, recipeId: ID): Promise<void> {
  try {
    const recipe = await api.getRecipe(recipeId)
    if (briefOf(storyId).recipe?.id === recipeId) put(storyId, { recipe })
  } catch {
    put(storyId, { recipe: null })
  }
}

/** Follows a recipe whose style is in the story already (no toast). */
export function followRecipe(storyId: ID, recipeId: ID): void {
  patchBrief(storyId, { recipe: { id: recipeId, tweaks: {} } })
  void loadRecipe(storyId, recipeId)
}

/** Follows a recipe: its style, genres, themes and tone go into the story (Undo in a toast). */
export async function pickRecipe(storyId: ID, recipeId: ID): Promise<void> {
  patchBrief(storyId, { recipe: { id: recipeId, tweaks: {} } })
  void loadRecipe(storyId, recipeId)
  const worldId = useApp.getState().world?.id
  if (worldId) void api.saveRecipePlan(recipeId, storyId, { worldId, storyId, guidance: '', premise: { status: 'open', text: null, before: null } }).catch(() => undefined)
  try {
    const before = await api.applyRecipeToStory(storyId, recipeId)
    await useApp.getState().refreshStories?.()
    toast('The recipe’s style, themes and tone are now the story’s.', {
      action: {
        label: 'Undo',
        run: () => {
          void api.unapplyRecipe(before).then(() => useApp.getState().refreshStories?.())
          patchBrief(storyId, { recipe: null })
          put(storyId, { recipe: null })
        }
      }
    })
  } catch (e) {
    toast((e as Error).message, { tone: 'danger' })
  }
}

export function dropRecipe(storyId: ID): void {
  const was = briefOf(storyId).recipe
  patchBrief(storyId, { recipe: null })
  const recipe = get(storyId).recipe
  put(storyId, { recipe: null })
  if (was)
    toast('The story no longer follows the recipe. Its style stays as it is.', {
      action: {
        label: 'Undo',
        run: () => {
          patchBrief(storyId, { recipe: was })
          put(storyId, { recipe })
        }
      }
    })
}

/** The recipe as this story uses it: the library's parts with Adam's changes for this story on top. */
export function partsInUse(storyId: ID): RecipeParts | null {
  const b = get(storyId)
  if (!b.recipe || !b.brief?.recipe) return null
  return { ...b.recipe.parts, ...b.brief.recipe.tweaks }
}

export const recipeScope = (storyId: ID): string => `recipe:${builderKey(storyId)}`

/** Apply: the changed parts go into this story's version of the recipe. */
export function applyRecipeTalk(storyId: ID): void {
  const scope = recipeScope(storyId)
  const parts = talkOf(scope).preview as Partial<RecipeParts> | null
  const r = briefOf(storyId).recipe
  if (!parts || !r) return
  const before = r.tweaks
  patchBrief(storyId, { recipe: { ...r, tweaks: { ...r.tweaks, ...parts } } })
  settlePreview(scope, 'applied')
  toast('Changed the recipe for this story.', {
    action: { label: 'Undo', run: () => patchBrief(storyId, (b) => ({ recipe: b.recipe ? { ...b.recipe, tweaks: before } : null })) }
  })
}

export function setRecipePart(storyId: ID, part: keyof RecipeParts, text: string): void {
  patchBrief(storyId, (b) => (b.recipe ? { recipe: { ...b.recipe, tweaks: { ...b.recipe.tweaks, [part]: text } } } : {}))
}

/** Save back: this story's changes go into the recipe in the library too. */
export async function saveRecipeBack(storyId: ID): Promise<void> {
  const r = briefOf(storyId).recipe
  if (!r || !Object.keys(r.tweaks).length) return
  try {
    const recipe = await api.updateRecipe(r.id, { parts: r.tweaks })
    put(storyId, { recipe })
    patchBrief(storyId, { recipe: { ...r, tweaks: {} } })
    toast('Saved your changes to the recipe in your library.', { tone: 'success' })
  } catch (e) {
    toast((e as Error).message, { tone: 'danger' })
  }
}

// ---------- The codex list ----------

export async function planCodex(storyId: ID): Promise<void> {
  if (get(storyId).codexTask) return
  await saveNow(storyId)
  const taskId = crypto.randomUUID()
  const before = briefOf(storyId).codex
  put(storyId, { codexTask: taskId, codexError: null })
  try {
    const r = await api.planStoryCodex({ taskId, storyId })
    if (get(storyId).codexTask !== taskId) return
    put(storyId, { codexTask: null })
    if (r.status === 'stopped') return
    if (r.status === 'error') return put(storyId, { codexError: r.error })
    patchBrief(storyId, { codex: r.items })
    if (before?.length)
      toast('Replaced the list with a new one.', { action: { label: 'Undo', run: () => patchBrief(storyId, { codex: before }) } })
  } catch (e) {
    if (get(storyId).codexTask === taskId) put(storyId, { codexTask: null, codexError: (e as Error).message })
  }
}

export function stopCodex(storyId: ID): void {
  const t = get(storyId).codexTask
  if (t) void api.stopTask(t).catch(() => undefined)
}

export function dismissCodexError(storyId: ID): void {
  put(storyId, { codexError: null })
}

export function patchItem(storyId: ID, key: string, patch: Partial<CodexItem>): void {
  patchBrief(storyId, (b) => ({ codex: (b.codex ?? []).map((it) => (it.key === key ? { ...it, ...patch } : it)) }))
}

export function tickAll(storyId: ID, kind: EntryKind, on: boolean): void {
  patchBrief(storyId, (b) => ({ codex: (b.codex ?? []).map((it) => (it.kind === kind ? { ...it, on } : it)) }))
}

export function addItem(storyId: ID, kind: EntryKind): string {
  const key = `n${Date.now().toString(36)}`
  const item: CodexItem = { key, kind, name: '', aliases: [], about: '', in: '', rule: false, when: '', role: '', mine: true, on: true, existing: null }
  patchBrief(storyId, (b) => ({ codex: [...(b.codex ?? []), item] }))
  return key
}

export function removeItem(storyId: ID, key: string): void {
  const list = briefOf(storyId).codex ?? []
  const at = list.findIndex((it) => it.key === key)
  if (at < 0) return
  const item = list[at]
  patchBrief(storyId, { codex: list.filter((it) => it.key !== key) })
  toast(`Took “${item.name || 'it'}” off the list.`, {
    action: {
      label: 'Undo',
      run: () => patchBrief(storyId, (b) => {
        const now = [...(b.codex ?? [])]
        now.splice(Math.min(at, now.length), 0, item)
        return { codex: now }
      })
    }
  })
}

export const codexScope = (storyId: ID): string => `codex:${builderKey(storyId)}`

export function talkCodex(storyId: ID, message: string): Promise<void> {
  return say(codexScope(storyId), message, async (taskId, history) => {
    await saveNow(storyId)
    const items = briefOf(storyId).codex ?? []
    const r = await api.storyCodexChat({ taskId, storyId, items, history, message })
    if (r.status === 'stopped') return null
    if (r.status === 'error') throw new Error(r.error ?? 'That didn’t work. Please try again.')
    return { answer: r.answer, revision: r.items, reason: r.reason ?? null }
  })
}

export function applyCodexTalk(storyId: ID): void {
  const scope = codexScope(storyId)
  const items = talkOf(scope).preview as CodexItem[] | null
  if (!items) return
  const before = briefOf(storyId).codex
  patchBrief(storyId, { codex: items })
  settlePreview(scope, 'applied')
  toast('Changed the list.', { action: { label: 'Undo', run: () => patchBrief(storyId, { codex: before }) } })
}

export function openItemRedo(storyId: ID, key: string): void {
  const redos = get(storyId).redos
  if (redos[key]) return
  put(storyId, { redos: { ...redos, [key]: { note: '', taskId: null, item: null, error: null } } })
}

export function patchItemRedo(storyId: ID, key: string, patch: Partial<ItemRedo>): void {
  const redos = get(storyId).redos
  if (redos[key]) put(storyId, { redos: { ...redos, [key]: { ...redos[key], ...patch } } })
}

export function closeItemRedo(storyId: ID, key: string): void {
  const redos = { ...get(storyId).redos }
  const r = redos[key]
  if (r?.taskId) void api.stopTask(r.taskId).catch(() => undefined)
  delete redos[key]
  put(storyId, { redos })
}

export async function redoItem(storyId: ID, key: string): Promise<void> {
  const r = get(storyId).redos[key]
  if (!r || r.taskId) return
  await saveNow(storyId)
  const taskId = crypto.randomUUID()
  patchItemRedo(storyId, key, { taskId, item: null, error: null })
  try {
    const out = await api.redoCodexItem({ taskId, storyId, items: briefOf(storyId).codex ?? [], key, note: r.note })
    if (get(storyId).redos[key]?.taskId !== taskId) return
    if (out.status === 'stopped') return patchItemRedo(storyId, key, { taskId: null })
    if (out.status === 'error' || !out.item) return patchItemRedo(storyId, key, { taskId: null, error: out.error ?? 'That didn’t work. Please try again.' })
    patchItemRedo(storyId, key, { taskId: null, item: out.item })
  } catch (e) {
    if (get(storyId).redos[key]?.taskId === taskId) patchItemRedo(storyId, key, { taskId: null, error: (e as Error).message })
  }
}

/** Use this: the new version of the item takes its place (Undo in a toast). */
export function takeItemRedo(storyId: ID, key: string): void {
  const r = get(storyId).redos[key]
  const was = (briefOf(storyId).codex ?? []).find((it) => it.key === key)
  if (!r?.item || !was) return
  patchItem(storyId, key, { ...r.item, key })
  closeItemRedo(storyId, key)
  toast(`Swapped in the new “${r.item.name}”.`, { action: { label: 'Undo', run: () => patchItem(storyId, key, was) } })
}

// ---------- Building the codex ----------

let listening = false
function listen(): void {
  if (listening) return
  listening = true
  onEvent('worldBuilder:progress', (p: WorldBuildProgress) => {
    const hit = findBuild(p.buildId)
    if (!hit) return
    const live = p.made.filter((m) => m.what === 'entry' && !m.undone).length
    put(hit, { build: { ...get(hit).build!, step: p.retrying ?? p.step, made: live } })
  })
  onEvent('worldBuilder:done', (d: WorldBuildDone) => {
    const hit = findBuild(d.buildId)
    if (!hit) return
    const words = madeWords(d)
    put(hit, {
      build: {
        buildId: d.buildId,
        status: d.status,
        step: '',
        made: d.made.filter((m) => m.what === 'entry' && !m.undone).length,
        words,
        runId: d.runId,
        error: d.error
      }
    })
    if (d.runId || d.status === 'complete') {
      patchBrief(hit, { built: { buildId: d.buildId, runId: d.runId, at: d.finishedAt } })
      setKeepBuild(hit, 'new-pages')
    }
  })
}

function findBuild(buildId: ID): ID | null {
  const prefix = `${useApp.getState().world?.id ?? ''}:`
  for (const [k, b] of Object.entries(useBuilders.getState().builders)) if (k.startsWith(prefix) && b.build?.buildId === buildId) return k.slice(prefix.length)
  return null
}

export async function buildCodex(storyId: ID): Promise<void> {
  listen()
  if (get(storyId).build?.status === 'running') return
  await saveNow(storyId)
  const items = (briefOf(storyId).codex ?? []).filter((it) => it.on && it.name.trim())
  if (!items.length) return void toast('Tick at least one thing to build first.')
  const buildId = crypto.randomUUID()
  put(storyId, { build: { buildId, status: 'running', step: 'Getting ready', made: 0, words: '', runId: null, error: null } })
  try {
    await api.buildStoryCodex({ buildId, storyId, items })
  } catch (e) {
    put(storyId, { build: { buildId, status: 'error', step: '', made: 0, words: '', runId: null, error: (e as Error).message } })
  }
}

export function stopBuild(storyId: ID): void {
  const b = get(storyId).build
  if (b?.status === 'running') void api.cancelWorldBuild(b.buildId).catch(() => undefined)
}

/** Undo build: everything the build made goes (Redo in its toast brings it back). */
export async function undoCodexBuild(storyId: ID): Promise<void> {
  const runId = get(storyId).build?.runId ?? briefOf(storyId).built?.runId
  if (!runId) return
  try {
    const { lineIds } = await api.undoWorldBuild(runId)
    const built = briefOf(storyId).built
    patchBrief(storyId, { built: null })
    put(storyId, { build: null })
    setKeepBuild(storyId, 'always')
    toast('Took back everything the build made.', {
      action: {
        label: 'Redo',
        run: () =>
          void api.redoWorldBuild(runId, lineIds).then(() => {
            patchBrief(storyId, { built })
            setKeepBuild(storyId, 'new-pages')
          })
      }
    })
  } catch (e) {
    toast((e as Error).message, { tone: 'danger' })
  }
}

// ---------- The outline ----------

/**
 * How much a story of this length lays out at first. With no length chosen ("Not sure yet"), the outline helper's own
 * start for a new story (outline/size.ts defaultSize), so the Idea step's hint says what the Outline step does.
 */
export function sizeForLength(length: StoryBrief['length'], recipeChapters: number): OutlineSize {
  if (length === 'short') return { acts: 0, chapters: 5, scenes: 3 }
  if (length === 'novella') return { acts: 3, chapters: 12, scenes: 3 }
  if (length === 'novel') return { acts: 3, chapters: 24, scenes: 4 }
  if (recipeChapters > 0) {
    const c = Math.max(1, Math.min(30, recipeChapters))
    return { acts: Math.min(3, c), chapters: c, scenes: Math.max(1, Math.min(3, Math.floor(100 / c))) }
  }
  return defaultSize(0, 0)
}
