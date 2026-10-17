// A new story's world (Adam, 2026-10-17): once he keeps an outline (the outline helper, a recipe's story, a chapter's
// plan) that names characters, places or plot threads the world didn't have, the World builder lays out what the
// story needs in the background (buildStoryWorld): full character profiles with looks and traits, places, groups,
// items, lore, plot threads and relationships, so nothing starts blind. Keeps made close together wait for each
// other (one build for them all); one made while a build runs is built once that build ends. A toast says how it
// goes, and "See progress" opens the World builder page, which shows the build as it runs.

import type { ID } from '@shared/types'
import type { WorldBuildDone } from '@shared/contracts/worldBuilder'
import { toast, useToasts } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { openWorldBuilder } from './open'

/** How long a keep waits for the next one before the build starts. */
export const STORY_BUILD_WAIT_MS = 4000

const waiting = new Set<ID>()
let timer: ReturnType<typeof setTimeout> | null = null
/** The build this started, and its toast, while it runs. */
let ours: { buildId: ID; toastId: number } | null = null

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

async function start(): Promise<void> {
  timer = null
  for (const storyId of [...waiting]) {
    const buildId = crypto.randomUUID()
    let out: { started: boolean; busy: boolean }
    try {
      out = await api.buildStoryWorld({ buildId, storyId })
    } catch (e) {
      waiting.delete(storyId)
      toast((e as Error).message || 'Couldn’t build the story’s characters and places. Try Build from a summary.', { tone: 'danger' })
      continue
    }
    // Busy: asked again when the running build ends.
    if (out.busy) return
    waiting.delete(storyId)
    if (!out.started) continue
    ours = {
      buildId,
      toastId: toast('Building your story’s characters, places and plot threads…', { action: seeProgress, progress: null })
    }
    return
  }
}

/** A keep named characters, places or plot threads the world didn't have: build what the story needs, soon. */
export function buildStoryWorldSoon(storyId: ID): void {
  waiting.add(storyId)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void start(), STORY_BUILD_WAIT_MS)
}

onEvent('worldBuilder:progress', (p) => {
  if (ours?.buildId !== p.buildId) return
  useToasts.getState().update(ours.toastId, { message: `Building your story’s world: ${p.step}` })
})

onEvent('worldBuilder:done', (d) => {
  if (ours?.buildId === d.buildId) {
    const { toastId } = ours
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
    }
  }
  // A keep made while a build ran is built now.
  if (waiting.size && !timer) timer = setTimeout(() => void start(), 0)
})
