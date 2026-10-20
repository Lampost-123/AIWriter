// The Plan hub's facts (2026-10-20; contracts/planHub.ts), all with no AI call: where the story has got to (the last scene
// with words, and what happens in it: the story index's gist, else its summary), the plot threads open there (the story
// index's, else the memory's), and where the planned scenes after it no longer fit what has been written. That last is the
// free card check before writing (plan/cardCheck.ts) run on each planned scene card after the last written scene, against
// the memory as the story stands: a planned scene that has someone use what they gave up, someone who has died, a When
// earlier than the scenes written... Reads the database; no Electron imports.

import type Database from 'better-sqlite3'
import type { HubDrift, HubThread, PlanHubFacts } from '@shared/contracts/planHub'
import type { EntryState, ID, RelationshipState, SceneCard } from '@shared/types'
import { emptySceneCard } from '@shared/defaults'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as sidx from '../db/storyIndex'
import { storyCards } from '../db/acts'
import { buildStoryIndex, openThreads } from '../storyIndex'
import { memoryAt } from '../memory/asOf'
import { cardCheck } from '../plan/cardCheck'

type DB = Database.Database

/** How many planned scenes after the last written one are held to the story (the nearest first). */
export const DRIFT_SCENES_MOST = 12
/** How many of them the hub names at most. */
export const DRIFT_MOST = 4
/** How many plot threads the hub offers at most. */
export const THREADS_MOST = 6

/** One scene of the story in reading order, with where it sits. */
export interface OrderedScene {
  id: ID
  chapterId: ID
  /** "Ch 4, Sc 2": live chapters and scenes counted from 1, as the story index says it. */
  label: string
  title: string
  words: number
}

/** The story's scenes in reading order (chapters by their place in the story, scenes by theirs). */
export function sceneOrder(db: DB, storyId: ID): OrderedScene[] {
  const o = repo.getOutline(db, storyId)
  const out: OrderedScene[] = []
  o.chapters.forEach((c, ci) => {
    o.scenes
      .filter((s) => s.chapterId === c.id)
      .sort((a, b) => a.position - b.position)
      .forEach((s, si) => out.push({ id: s.id, chapterId: c.id, label: `Ch ${ci + 1}, Sc ${si + 1}`, title: s.title, words: s.wordCount }))
  })
  return out
}

/** Where the last scene with words is in the order (-1: nothing written yet). */
export function lastWrittenAt(order: readonly Pick<OrderedScene, 'words'>[]): number {
  for (let i = order.length - 1; i >= 0; i--) if (order[i].words > 0) return i
  return -1
}

/** "Ch 2, Sc 3" gives "Ch 2": a thread's chip says the chapter it was opened in. */
export const chapterOf = (label: string): string => /^Ch \d+/.exec(label.trim())?.[0] ?? ''

/** A planned scene's card says something to hold to the story (else there is nothing on it to have drifted). */
export function cardSaysSomething(card: Partial<SceneCard>): boolean {
  const c = { ...emptySceneCard(), ...card }
  return !!(c.povId || c.presentIds.length || c.locationId || [c.when, c.goal, c.outcome, c.conflict, ...c.beats].some((v) => String(v ?? '').trim()))
}

/** What happens in a scene, in a line or two: the story index's gist, else its summary, else ''. */
function gistOf(db: DB, storyId: ID, sceneId: ID): string {
  const fromIndex = sidx.indexScene(db, sceneId)?.gist?.trim()
  if (fromIndex) return fromIndex
  try {
    const s = mem.storySummaries(db, storyId).find((x) => x.level === 'scene' && x.targetId === sceneId)
    return s?.text.trim() ?? ''
  } catch {
    return ''
  }
}

/** The plot threads open at a scene, from the story index; the memory's open threads when the index has none. */
function threadsAt(db: DB, storyId: ID, sceneId: ID | null, quietly: <T>(fn: () => T, fallback: T) => T): HubThread[] {
  const fromIndex = sceneId
    ? quietly(
        () =>
          openThreads(db, storyId, sceneId).threads.map((t): HubThread => ({ id: t.threadId, name: t.name, since: chapterOf(t.since), quiet: t.quietScenes })),
        [] as HubThread[]
      )
    : []
  if (fromIndex.length) return [...fromIndex].sort((a, b) => b.quiet - a.quiet || a.name.localeCompare(b.name)).slice(0, THREADS_MOST)
  // The memory's own open threads as the story ends (a story with nothing written, or an index with no thread events).
  return quietly(() => {
    const at = memoryAt(db, { kind: 'end', storyId })
    const title = repo.getStory(db, storyId).title
    // "Since Ch 2" only for a thread opened in this story (one from a story before it says no chapter).
    const sinceHere = (setUp: string): string => (setUp.startsWith(`${title}, `) ? chapterOf(setUp.slice(title.length + 2)) : '')
    return at.state.threads
      .filter((t) => t.status === 'open' && !t.planned)
      .flatMap((t): HubThread[] => {
        const e = at.state.entries.get(t.entryId)
        return e?.name.trim() ? [{ id: e.id, name: e.name.trim(), since: sinceHere(t.setUp), quiet: t.quiet ?? 0 }] : []
      })
      .sort((a, b) => b.quiet - a.quiet || a.name.localeCompare(b.name))
      .slice(0, THREADS_MOST)
  }, [] as HubThread[])
}

/**
 * The planned scenes after the last one written whose cards the story has moved on from (see the top of this file): the
 * nearest DRIFT_SCENES_MOST are checked, and at most DRIFT_MOST named, one line each.
 */
export function planDrift(db: DB, storyId: ID, order: readonly OrderedScene[], last: number): HubDrift[] {
  if (last < 0) return []
  const planned = order.slice(last + 1).filter((s) => s.words === 0)
  if (!planned.length) return []
  let memory: { entries: EntryState[]; relationships: RelationshipState[] } | null = null
  try {
    const at = memoryAt(db, { kind: 'end', storyId })
    memory = { entries: [...at.state.entries.values()], relationships: at.state.relationships }
  } catch (e) {
    console.warn('The Plan hub could not read the memory to check the plan', e)
    return []
  }
  const title = repo.getStory(db, storyId).title
  const out: HubDrift[] = []
  for (const s of planned.slice(0, DRIFT_SCENES_MOST)) {
    if (out.length >= DRIFT_MOST) break
    let card: SceneCard
    try {
      card = { ...emptySceneCard(), ...repo.getScene(db, s.id).card }
    } catch {
      continue
    }
    if (!cardSaysSomething(card)) continue
    const found = cardCheck({
      db,
      storyId,
      sceneId: s.id,
      card,
      direction: '',
      entries: memory.entries,
      relationships: memory.relationships,
      present: [card.povId, ...card.presentIds].filter((id): id is ID => !!id),
      asItBegins: true,
      storyTitle: title
    })
    if (!found.length) continue
    out.push({ sceneId: s.id, chapterId: s.chapterId, label: s.label, title: plainTitle(s.title), text: found[0].text })
  }
  return out
}

/** A scene card with nothing to go on: no goal and no beats (a title, perhaps a When or who is in it, at most). */
export const emptyCard = (c: { goal?: string; beats?: string[] } | undefined): boolean => !c || (!String(c.goal ?? '').trim() && !(c.beats ?? []).some((b) => String(b).trim()))

/** The scenes whose cards are empty, by chapter, in story order (see PlanHubFacts.emptyCards). */
export function emptyCards(db: DB, storyId: ID, order: readonly OrderedScene[]): Record<ID, ID[]> {
  const cards = storyCards(db, storyId)
  const out: Record<ID, ID[]> = {}
  for (const s of order) if (emptyCard(cards.get(s.id))) (out[s.chapterId] ??= []).push(s.id)
  return out
}

/** A scene's own title, or '' for one still called "Scene 3". */
const plainTitle = (t: string): string => (/^\s*(scene\s*\d*|untitled scene)?\s*$/i.test(t) ? '' : t.replace(/\s+/g, ' ').trim())

/** Everything the hub shows that comes from the main process (contracts/planHub.ts PlanHubFacts). Never throws past a missing story. */
export function planHubFacts(db: DB, storyId: ID): PlanHubFacts {
  repo.getStory(db, storyId)
  const quietly = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn()
    } catch (e) {
      console.warn('The Plan hub could not read part of the story', e)
      return fallback
    }
  }
  // Brought up to date first (hash-guarded: only scenes that changed are built again).
  quietly(() => buildStoryIndex(db, storyId), null)
  const order = sceneOrder(db, storyId)
  const last = lastWrittenAt(order)
  const lastScene = last >= 0 ? order[last] : null
  return {
    storyId,
    lastSceneId: lastScene?.id ?? null,
    lastGist: lastScene ? quietly(() => gistOf(db, storyId, lastScene.id), '') : '',
    threads: threadsAt(db, storyId, lastScene?.id ?? null, quietly),
    drift: quietly(() => planDrift(db, storyId, order, last), []),
    emptyCards: quietly(() => emptyCards(db, storyId, order), {})
  }
}
