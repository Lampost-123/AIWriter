// What the recipe screens hold while the app is open: the recipe library's list, the recipe being made (as the
// main process reports it), and the "make a recipe" page between visits (the story read from a file or pasted,
// its split into chapters and Adam's changes to it, the name). Followed from the start, whichever page shows, so
// a recipe that finishes says so in a toast wherever Adam is. Owned by the Story recipes part.

import { create } from 'zustand'
import type { Manuscript } from '@shared/contracts/importing'
import type { RecipeMakerState, RecipeSummary } from '@shared/contracts/recipes'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { buildOutline, noEdits, proposeRoles, toPlan, type Role, type SplitEdits } from '@/features/importing/split'
import { recipeName } from './recipeLogic'

export interface RecipesSession {
  /** Null until first read. */
  list: RecipeSummary[] | null
  maker: RecipeMakerState
  // ----- Making one -----
  /** 'file' or 'paste': how the story comes in. */
  from: 'file' | 'paste'
  pasted: string
  reading: boolean
  manuscript: Manuscript | null
  proposed: Record<number, Role>
  edits: SplitEdits
  /** Adam's own name for it ('' lets the AI suggest one). */
  name: string
  starting: boolean
  problem: { message: string; code?: string } | null
  /** The recipe the New story dialog opens with ("Start a story from it"); null for none. */
  forStory: ID | null
}

const NO_MAKER: RecipeMakerState = { running: null, finished: null }

export const useRecipes = create<RecipesSession>(() => ({
  list: null,
  maker: NO_MAKER,
  from: 'file',
  pasted: '',
  reading: false,
  manuscript: null,
  proposed: {},
  edits: noEdits(),
  name: '',
  starting: false,
  problem: null,
  forStory: null
}))

const get = useRecipes.getState
const set = useRecipes.setState
const app = useApp.getState

// ---------- Following the library ----------

let seenFinish: string | null = null

function sayFinished(s: RecipeMakerState): void {
  const f = s.finished
  if (!f || f.at === seenFinish) return
  const first = seenFinish === null
  seenFinish = f.at
  if (first && Date.now() - Date.parse(f.at) > 10_000) return
  const view = app().view
  // The recipe's own page shows it arrive; anywhere else, a toast says so.
  if (view.kind === 'recipes' && view.page === 'recipe' && view.recipeId === f.recipeId) return
  toast(`The recipe “${f.name}” is ready.`, {
    tone: 'success',
    secondary: { label: 'Open', run: () => openRecipe(f.recipeId) }
  })
}

export async function refreshRecipes(): Promise<void> {
  try {
    const [list, maker] = await Promise.all([api.listRecipes(), api.getRecipeMaker()])
    set({ list, maker })
    sayFinished(maker)
  } catch {
    // What shows stays as it was (the library folder may be out of reach for a moment).
    if (get().list === null) set({ list: [] })
  }
}

let listening = false
let refreshTimer: ReturnType<typeof setTimeout> | null = null

/** Follows the recipe library for as long as the window is open. */
export function listenForRecipes(): void {
  if (listening) return
  listening = true
  onEvent('recipes:maker', (s) => {
    sayFinished(s)
    set({ maker: s })
  })
  onEvent('recipes:changed', () => {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void refreshRecipes(), 60)
  })
  void refreshRecipes()
}

// ---------- Ways in ----------

export function openRecipes(): void {
  listenForRecipes()
  app().navigate({ kind: 'recipes', page: 'list' })
}

export function openRecipe(id: ID): void {
  listenForRecipes()
  app().navigate({ kind: 'recipes', page: 'recipe', recipeId: id })
}

/** "Make a recipe": the page to bring in a story (as it was left, unless a recipe was started from it since). */
export function startMaking(): void {
  listenForRecipes()
  set({ problem: null })
  app().navigate({ kind: 'recipes', page: 'make' })
}

// ---------- Making one ----------

export const setFrom = (from: 'file' | 'paste'): void => set({ from, problem: null })
export const setPasted = (pasted: string): void => set({ pasted })
export const setRecipeName = (name: string): void => set({ name })
export const setRecipeEdits = (edits: SplitEdits): void => set({ edits })
export const resetRecipeSplit = (): void => set({ edits: noEdits() })

function took(m: Manuscript): void {
  set({ reading: false, manuscript: m, proposed: proposeRoles(m.blocks), edits: noEdits(), problem: null })
}

/** Asks for a Word, Markdown or text file and reads it (the manuscript import's readers). */
export async function chooseStoryFile(): Promise<void> {
  if (get().reading) return
  set({ reading: true, problem: null })
  try {
    const m = await api.chooseManuscript()
    if (!m) set({ reading: false })
    else took(m)
  } catch (e) {
    set({ reading: false, problem: { message: plainReason(e) } })
  }
}

/** Reads the pasted text as a plain text file is read: chapters by their headings. */
export async function readPasted(): Promise<void> {
  if (get().reading) return
  set({ reading: true, problem: null })
  try {
    took(await api.readPastedStory(get().pasted))
  } catch (e) {
    set({ reading: false, problem: { message: plainReason(e) } })
  }
}

/** Back to choosing a story. */
export const clearStory = (): void => set({ manuscript: null, proposed: {}, edits: noEdits(), problem: null })

/** The split as the main process is given it. */
export function currentPlan(): ReturnType<typeof toPlan> | null {
  const s = get()
  if (!s.manuscript) return null
  return toPlan(s.manuscript, buildOutline(s.manuscript, s.proposed, s.edits), s.manuscript.title)
}

/** Starts making the recipe in the background, and shows it in the library. */
export async function makeRecipe(): Promise<void> {
  const plan = currentPlan()
  if (!plan || get().starting) return
  set({ starting: true, problem: null })
  try {
    const made = await api.startRecipe({ name: get().name, plan })
    // The story's text is now kept with the recipe: the page lets go of its copy.
    set({ starting: false, manuscript: null, proposed: {}, edits: noEdits(), pasted: '', name: '' })
    await refreshRecipes()
    openRecipe(made.id)
  } catch (e) {
    set({ starting: false, problem: { message: plainReason(e), code: (e as { code?: string }).code } })
  }
}

// ---------- The library ----------

export async function carryOn(id: ID): Promise<void> {
  try {
    await api.carryOnRecipe(id)
  } catch (e) {
    toast(plainReason(e), { tone: 'danger' })
  }
  await refreshRecipes()
}

/** Cancel: stops making it and takes it out of the library, with Undo. */
export async function cancelMaking(id: ID, name: string): Promise<void> {
  let removed: boolean
  try {
    removed = (await api.cancelRecipe(id)).removed
  } catch (e) {
    toast(plainReason(e), { tone: 'danger' })
    return
  }
  await refreshRecipes()
  // A finished recipe being read again is simply as it was before.
  if (!removed) {
    toast(`Stopped reading the story again. “${name}” is as it was.`)
    return
  }
  leaveIfShowing(id)
  toast(`Stopped making “${name}”.`, { action: { label: 'Undo', run: () => void restore(id) } })
}

/** Delete, with Undo in the toast. */
export async function deleteRecipe(r: Pick<RecipeSummary, 'id' | 'name' | 'status'>): Promise<void> {
  try {
    await api.deleteRecipe(r.id)
  } catch (e) {
    toast(plainReason(e), { tone: 'danger' })
    return
  }
  await refreshRecipes()
  leaveIfShowing(r.id)
  toast(`“${recipeName(r)}” deleted.`, { action: { label: 'Undo', run: () => void restore(r.id) } })
}

async function restore(id: ID): Promise<void> {
  try {
    await api.restoreRecipe(id)
  } catch (e) {
    toast(plainReason(e), { tone: 'danger' })
  }
  await refreshRecipes()
}

function leaveIfShowing(id: ID): void {
  const v = app().view
  if (v.kind === 'recipes' && v.page === 'recipe' && v.recipeId === id) app().navigate({ kind: 'recipes', page: 'list' })
}

export async function duplicate(id: ID): Promise<void> {
  try {
    const copy = await api.duplicateRecipe(id)
    await refreshRecipes()
    toast(`Made a copy: “${recipeName(copy)}”.`, { secondary: { label: 'Open', run: () => openRecipe(copy.id) } })
  } catch (e) {
    toast(plainReason(e), { tone: 'danger' })
  }
}

export async function writeOne(): Promise<void> {
  try {
    const r = await api.newRecipe()
    await refreshRecipes()
    openRecipe(r.id)
  } catch (e) {
    toast(plainReason(e), { tone: 'danger' })
  }
}

// ---------- A new story from a recipe ----------

/** "Start a new story from it": the New story dialog, with this recipe picked. */
export function startStoryFrom(id: ID): void {
  set({ forStory: id })
  app().setNewStoryOpen(true)
}

/** The recipe the dialog opens with, once (then it is forgotten). */
export function takeForStory(): ID | null {
  const id = get().forStory
  if (id) set({ forStory: null })
  return id
}

/** Forget the story's text kept with a recipe, with Undo. */
export async function forgetSource(id: ID): Promise<void> {
  try {
    await api.forgetRecipeSource(id)
  } catch (e) {
    toast(plainReason(e), { tone: 'danger' })
    return
  }
  await refreshRecipes()
  toast('The story’s text was removed from this recipe.', {
    action: {
      label: 'Undo',
      run: () =>
        void api
          .restoreRecipeSource(id)
          .then(refreshRecipes)
          .catch((e) => toast(plainReason(e), { tone: 'danger' }))
    }
  })
}

/** Reads the story kept with the recipe again; parts Adam changed stay as they are. */
export async function readAgain(id: ID): Promise<void> {
  try {
    await api.readRecipeAgain(id)
  } catch (e) {
    toast(plainReason(e), { tone: 'danger' })
    return
  }
  await refreshRecipes()
  toast('Reading the story again. The parts you changed stay as they are.')
}
