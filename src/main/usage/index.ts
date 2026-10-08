// Usage and cost (milestone 6): the spending across the library and the monthly limit, connected to the open
// world, the settings and the window.
//   aggregate.ts  one world's spending from its generation records, read a little at a time
//   library.ts    every world's, kept in usage-cache.json, other worlds read read-only and briefly
//   report.ts     the usage page's numbers
//   limit.ts      the limit's rules (80% once a month, held at the limit, Carry on this month)
//   gate.ts       where every AI call meets the limit (db/generations.ts)
// The limit holds AI calls in two places: the window's own calls ask first (`askFirst`, called for the
// methods in ASKS_FIRST by ipc/index.ts before the handler runs, so nothing has started when Adam is asked),
// and every AI call is refused as it is recorded (gate.ts), so no job slips past. Automatic work waits: the
// memory keeper as it does with no model (keeper/index.ts), the checks after Mark done here (`runOrWait`).
// All of it goes ahead again when Adam carries on, raises the limit, or the month turns.

import type Database from 'better-sqlite3'
import { join } from 'node:path'
import type { ApiMethod } from '@shared/api'
import type { SpendState, UsageQuery, UsageReport } from '@shared/contracts/usage'
import { SPEND_LIMIT, reachedWords } from '@shared/contracts/usage'
import { emit } from '../events'
import { memorySettingsChanged } from '../keeper'
import { userDataDir } from '../paths'
import { getSettings, updateSettings } from '../settings'
import * as world from '../world'
import * as repo from '../db/repo'
import { UserError } from '../util'
import { setSpendHooks } from './gate'
import { UsageLibrary, type OpenWorldRef } from './library'
import { carriedOn, cleanLimit, msToNextMonth, spendStateOf, toastShown } from './limit'
import { buildReport, monthOf } from './report'
import { monthCost, type WorldTally } from './aggregate'
import { recipeTally } from '../recipes/ledger'

type DB = Database.Database

/**
 * The window's calls that start AI work Adam asked for himself: while the limit holds AI calls, they are
 * refused before the handler runs (code SPEND_LIMIT), the window asks, and on "Carry on this month" makes the
 * same call again. Reading aloud isn't here: it reads without the AI's speaker marks rather than ask.
 * A new AI action goes here; one left out is still refused when its call is recorded (gate.ts).
 */
export const ASKS_FIRST: ReadonlySet<ApiMethod> = new Set<ApiMethod>([
  'startDraft',
  'startVariants',
  'startBeat',
  'startEdit',
  'askWorld',
  'startOutline',
  'startSceneIdeas',
  'askPlanQuestion',
  'fillSceneCard',
  'startChapterPlan',
  'startQuickStart',
  'startFleshOut',
  'startOptions',
  'startInterview',
  'startWorldBuild',
  'askWorldQuestion',
  'startCheck',
  'suggestCharacterVoice',
  'fillTimeGap',
  'draftStartingCast',
  'sortStartChanges',
  'updateMemoryNow',
  'checkMemoryAgain',
  'startCatchUp',
  // Story recipes
  'startRecipe',
  'carryOnRecipe',
  'readRecipeAgain',
  'startRecipeStory',
  'writeStyleSample',
  'startPolish'
])

let library: UsageLibrary | null = null

/** The library's tallies, kept in the app's data folder between runs. */
function lib(): UsageLibrary {
  if (!library) {
    let cacheFile: string | null = null
    try {
      cacheFile = join(userDataDir(), 'usage-cache.json')
    } catch {
      /* no data folder: nothing is kept between runs */
    }
    library = new UsageLibrary({ cacheFile })
  }
  return library
}

function openRef(): OpenWorldRef | null {
  const w = world.maybeCurrentWorld()
  if (!w || !w.db.open) return null
  return { folder: w.folder, db: w.db, name: repo.getMeta(w.db, 'name') ?? 'Untitled world' }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function saveSoon(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    lib().save()
  }, 5000)
}

/** Every world looked at (the first time this session), and the open world brought up to date. */
function upToDate(): void {
  const l = lib()
  const open = openRef()
  if (!l.looked) l.refreshAll(getSettings().libraryPath, open)
  else if (open) l.refreshOpen(open)
  saveSoon()
}

// ---------- Story recipes ----------

/** What making recipes has cost in this library (its own spending file, outside every world), kept up to date. */
let recipes: { library: string; tally: WorldTally | null } | null = null
function recipesTally(): WorldTally | null {
  const library = getSettings().libraryPath
  const before = recipes?.library === library ? recipes.tally : null
  const tally = recipeTally(library, before)
  recipes = { library, tally }
  return tally
}

/** A Recipe maker call finished: the spending is added up again, as after any AI call. */
export function recipeCallFinished(): void {
  try {
    if (getSettings().usage?.monthlyLimit == null) emit('usage:spend', spendState())
    else changed()
  } catch (e) {
    console.warn('Could not add up the spending after a recipe call', e)
  }
}

// ---------- The limit ----------

/**
 * Where this month's spending stands. With no limit nothing is added up (`spent` is 0), so AI calls never
 * wait on reading the library.
 */
export function spendState(now = new Date()): SpendState {
  const month = monthOf(now)
  const { monthlyLimit, notice } = getSettings().usage ?? { monthlyLimit: null }
  if (monthlyLimit == null) return spendStateOf(0, null, null, month)
  upToDate()
  const r = recipesTally()
  return spendStateOf(lib().monthSpend(month) + (r ? monthCost(r, month) : 0), monthlyLimit, notice, month)
}

let last = ''
let wasHeld = false

/**
 * Tells the window when the spending or the limit changed, and lets waiting work go when the limit no longer
 * holds it (`resume`: Adam carried on or changed the limit, so the memory looks again either way).
 */
function changed(o: { resume?: boolean } = {}): SpendState {
  const state = spendState()
  const key = JSON.stringify(state)
  if (key !== last) {
    last = key
    emit('usage:spend', state)
  }
  if (!state.paused && (wasHeld || o.resume || waiting.size)) resume()
  wasHeld = state.paused
  armMonthTimer(state)
  return state
}

let monthTimer: ReturnType<typeof setTimeout> | null = null
/** While a limit is set, the month turning starts afresh (a held limit lets go). */
function armMonthTimer(state: SpendState): void {
  if (monthTimer) clearTimeout(monthTimer)
  monthTimer = null
  if (state.limit == null) return
  // setTimeout can't wait longer than about 24 days; it simply looks again then.
  monthTimer = setTimeout(
    () => {
      monthTimer = null
      try {
        changed()
      } catch (e) {
        console.warn('Could not look at the monthly spending', e)
      }
    },
    Math.min(msToNextMonth(new Date()) + 1000, 2 ** 31 - 1)
  )
}

/** Automatic work held while the limit was reached, by key, with the world it belongs to. */
const waiting = new Map<string, { db: DB; run: () => void }>()

/**
 * Runs automatic work now, or, while the limit holds AI calls, keeps it to run when Adam carries on, raises the
 * limit or the month turns (only if its world is still open then). A newer one with the same key replaces it.
 */
export function runOrWait(key: string, db: DB, run: () => void): void {
  if (spendState().paused) {
    waiting.set(key, { db, run })
    return
  }
  run()
}

function resume(): void {
  // The memory catches up with every scene left waiting.
  memorySettingsChanged()
  const now = [...waiting.values()]
  waiting.clear()
  for (const w of now) {
    if (!w.db.open || world.maybeCurrentWorld()?.db !== w.db) continue
    try {
      w.run()
    } catch (e) {
      console.warn('Could not start work that waited for the spending limit', e)
    }
  }
}

/** Refuses one of ASKS_FIRST while the limit holds AI calls; the window asks Adam and tries again. */
export function askFirst(method: string): void {
  if (!ASKS_FIRST.has(method as ApiMethod)) return
  const state = spendState()
  if (state.paused && state.limit != null) throw new UserError(reachedWords(state.limit), SPEND_LIMIT)
}

export function setMonthlyLimit(value: unknown): SpendState {
  const clean = cleanLimit(value)
  if (!clean.ok) throw new UserError(clean.error)
  updateSettings({ usage: { monthlyLimit: clean.limit } })
  return changed({ resume: true })
}

export function carryOnThisMonth(): SpendState {
  const limit = getSettings().usage?.monthlyLimit
  if (limit != null) updateSettings({ usage: { notice: carriedOn(getSettings().usage?.notice, monthOf(new Date()), limit) } })
  return changed({ resume: true })
}

export function spendToastShown(which: 'near' | 'reached'): SpendState {
  const limit = getSettings().usage?.monthlyLimit
  if (limit != null && (which === 'near' || which === 'reached')) {
    updateSettings({ usage: { notice: toastShown(getSettings().usage?.notice, monthOf(new Date()), limit, which) } })
  }
  return changed()
}

// ---------- The page ----------

export function usageReport(query: UsageQuery): UsageReport {
  const l = lib()
  const open = openRef()
  l.refreshAll(getSettings().libraryPath, open)
  saveSoon()
  const scope = query?.scope === 'world' && open ? 'world' : 'library'
  const period = (['this-month', 'last-month', 'last-30-days', 'all-time'] as const).includes(query?.period) ? query.period : 'this-month'
  const every = l.tallies()
  const own = open ? l.tallyOf(open.folder) : null
  // Making recipes belongs to no world: it counts across the library, never in one world's figures.
  const r = recipesTally()
  const extra = r ? [r] : []
  return buildReport({
    period,
    scope,
    tallies: scope === 'world' && own ? [own] : [...every.map((w) => w.tally), ...extra],
    everyTally: [...every.map((w) => w.tally), ...extra],
    worlds: scope === 'world' && own ? 1 : every.length,
    today: new Date(),
    worldName: open?.name ?? null,
    unreadable: scope === 'world' ? 0 : l.unreadableCount
  })
}

// ---------- Wiring ----------

/** After AI calls finish, the spending is added up again (at most a few times a second). */
let afterTimer: ReturnType<typeof setTimeout> | null = null
function afterCall(db: DB): void {
  if (world.maybeCurrentWorld()?.db !== db || afterTimer) return
  afterTimer = setTimeout(() => {
    afterTimer = null
    try {
      if (getSettings().usage?.monthlyLimit == null) {
        // No limit to watch: the open world is only added up when the library already has been, and the
        // window is told anyway, so the usage page, if it is showing, reads the new figures.
        const open = openRef()
        if (open && lib().looked) lib().refreshOpen(open)
        saveSoon()
        emit('usage:spend', spendState())
        return
      }
      changed()
    } catch (e) {
      console.warn('Could not add up the spending after an AI call', e)
    }
  }, 250)
}

setSpendHooks({
  held: () => {
    const s = spendState()
    return s.paused ? s.limit : null
  },
  finished: afterCall
})

world.onWorldOpened(() => {
  try {
    if (getSettings().usage?.monthlyLimit != null) changed()
  } catch (e) {
    console.warn('Could not look at the monthly spending', e)
  }
})
world.onWorldClosing((w) => {
  for (const [k, v] of waiting) if (v.db === w.db) waiting.delete(k)
  // Its tally is brought up to date while its connection is still open, and kept. Only one already added up:
  // that reads just what is new, while adding up a world for the first time reads all of its records, which
  // mustn't slow closing (or quitting) for someone who never looks at the page and has no limit.
  try {
    if (!w.db.open || !lib().tallyOf(w.folder)) return
    lib().refreshOpen({ folder: w.folder, db: w.db, name: repo.getMeta(w.db, 'name') ?? 'Untitled world' })
    lib().save()
  } catch (e) {
    console.warn('Could not keep the spending of the world being closed', e)
  }
})

/** Keeps the figures before quitting. */
export function saveUsage(): void {
  lib().save()
}
