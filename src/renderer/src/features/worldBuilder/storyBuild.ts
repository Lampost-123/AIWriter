// A new story's world (Adam, 2026-10-17): once he keeps an outline (the outline helper, a recipe's story, a chapter's
// plan) that names characters, places or plot threads the world didn't have, the World builder lays out what the
// story needs in the background (buildStoryWorld): full character profiles with looks and traits, places, groups,
// items, lore, plot threads and relationships, so nothing starts blind. Keeps made close together wait for each
// other (one build for them all); one made while a build runs is built once that build ends. A toast says how it
// goes, with Stop, and "See progress" opens the World builder page, which shows the build as it runs.
// What is waiting is kept in the world (2026-10-17: storyBuildsWaiting), so closing the app loses nothing: it starts
// when the world next opens. A story planned from a recipe brings the recipe's cast roles and devices.

import type { ID } from '@shared/types'
import type { StoryBuildWaiting, WorldBuildDone } from '@shared/contracts/worldBuilder'
import { toast, useToasts } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'
import { openWorldBuilder } from './open'

/** How long a keep waits for the next one before the build starts. */
export const STORY_BUILD_WAIT_MS = 4000

/** The world the waiting stories belong to: never another world's story is sent. */
let worldId: ID | null = null
/** The stories waiting, each with the recipe it was planned from (null for none). */
const waiting = new Map<ID, ID | null>()
/** The recipe each story of this world was planned from, once known this session. */
const recipes = new Map<ID, ID>()
let timer: ReturnType<typeof setTimeout> | null = null
/** The build this started, and its toast, while it runs. */
let ours: { buildId: ID; toastId: number; stopping: boolean } | null = null

/** "3 characters, 2 places and 1 plot thread"; '' for nothing. */
export function madeWords(done: Pick<WorldBuildDone, 'made'>): string {
  const live = done.made.filter((m) => m.what === 'entry' && !m.undone)
  const count = (kind: string, one: string, many: string): string => {
    const n = live.filter((m) => m.kind === kind).length
    return n ? `${n} ${n === 1 ? one : many}` : ''
  }
  const parts = [
    count('character', 'character', 'characters'),
    count('place', 'place', 'places'),
    count('thread', 'plot thread', 'plot threads'),
    count('group', 'group', 'groups'),
    count('item', 'item', 'items'),
    count('lore', 'piece of lore', 'pieces of lore')
  ].filter(Boolean)
  if (parts.length < 2) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

const seeProgress = { label: 'See progress', run: () => openWorldBuilder() }

const openWorld = (): ID | null => useApp.getState().world?.id ?? null

/** Keeps what is waiting in its world, so it is there when the world next opens. */
function keep(): void {
  if (!worldId || worldId !== openWorld()) return
  const list: StoryBuildWaiting[] = [...waiting].map(([storyId, recipeId]) => ({ storyId, recipeId }))
  void api.setStoryBuildsWaiting({ worldId, waiting: list }).catch(() => undefined)
}

function startSoon(delay: number): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void start(), delay)
}

async function start(): Promise<void> {
  timer = null
  if (!worldId || worldId !== openWorld()) return
  for (const [storyId, recipeId] of [...waiting]) {
    const buildId = crypto.randomUUID()
    let out: { started: boolean; busy: boolean }
    try {
      out = await api.buildStoryWorld({ buildId, storyId, recipeId })
    } catch (e) {
      waiting.delete(storyId)
      keep()
      toast((e as Error).message || 'Couldn’t build the story’s characters and places. Try Build from a summary.', { tone: 'danger' })
      continue
    }
    // Busy: asked again when the running build ends.
    if (out.busy) return
    waiting.delete(storyId)
    keep()
    if (!out.started) continue
    ours = {
      buildId,
      stopping: false,
      toastId: toast('Building your story’s characters, places and plot threads…', {
        action: seeProgress,
        secondary: { label: 'Stop', run: () => void stop(buildId) },
        progress: null
      })
    }
    return
  }
}

/** Stop on the toast: the build stops, and what it made so far stays (one Undo on the World builder page takes it away). */
async function stop(buildId: ID): Promise<void> {
  if (ours?.buildId !== buildId || ours.stopping) return
  ours.stopping = true
  useToasts.getState().update(ours.toastId, { message: 'Stopping…', secondary: undefined })
  try {
    await api.cancelWorldBuild(buildId)
  } catch (e) {
    if (ours?.buildId === buildId) ours.stopping = false
    toast(`Couldn’t stop building. ${(e as Error).message}`, { tone: 'danger' })
  }
}

/**
 * A keep named characters, places or plot threads the world didn't have: build what the story needs, soon.
 * `recipeId`: the recipe the story was planned from, when it was.
 */
export function buildStoryWorldSoon(storyId: ID, recipeId?: ID | null): void {
  const here = openWorld()
  if (!here) return
  if (worldId !== here) follow(here)
  if (recipeId) recipes.set(storyId, recipeId)
  waiting.set(storyId, recipes.get(storyId) ?? waiting.get(storyId) ?? null)
  keep()
  startSoon(STORY_BUILD_WAIT_MS)
}

/**
 * Another world opened: what waited in the last one stays kept there, and what waits in this one (a keep made just
 * before the app closed) starts shortly.
 */
function follow(id: ID | null): void {
  if (id === worldId) return
  worldId = id
  waiting.clear()
  recipes.clear()
  if (timer) clearTimeout(timer)
  timer = null
  if (!id) return
  api
    .storyBuildsWaiting()
    .then((kept) => {
      if (kept.worldId !== id || worldId !== id) return
      for (const w of kept.waiting) {
        if (!waiting.has(w.storyId)) waiting.set(w.storyId, w.recipeId)
        if (w.recipeId) recipes.set(w.storyId, w.recipeId)
      }
      if (waiting.size && !timer) startSoon(STORY_BUILD_WAIT_MS)
    })
    // Not known: the next keep in this world builds its story as usual.
    .catch(() => undefined)
}

follow(openWorld())
useApp.subscribe((s) => follow(s.world?.id ?? null))

onEvent('worldBuilder:progress', (p) => {
  if (ours?.buildId !== p.buildId || ours.stopping) return
  useToasts.getState().update(ours.toastId, { message: `Building your story’s world: ${p.step}` })
})

onEvent('worldBuilder:done', (d) => {
  if (ours?.buildId === d.buildId) {
    const { toastId, stopping } = ours
    ours = null
    useToasts.getState().dismiss(toastId)
    if (d.status === 'complete') {
      const words = madeWords(d)
      toast(words ? `Your story’s world is ready: ${words}.` : 'Your story’s world is ready.', {
        tone: 'success',
        action: { label: 'See it', run: () => openWorldBuilder() }
      })
    } else if (d.status === 'error') {
      toast(d.error || 'Building the story’s world stopped. Open the World builder to try again.', { tone: 'danger', action: seeProgress })
    } else if (stopping) {
      const words = madeWords(d)
      toast(words ? `Stopped building. Kept what was made: ${words}.` : 'Stopped building.', { action: seeProgress })
    }
  }
  // A keep made while a build ran is built now.
  if (waiting.size && !timer) startSoon(0)
})
