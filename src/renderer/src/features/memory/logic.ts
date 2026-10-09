// Pure helpers for the memory keeper's status and the "What changed" list. No React, no window,
// so they are unit-tested.

import type { ID, MemoryLogItem, MemoryStatus } from '@shared/types'

export type KeeperState = 'idle' | 'reading' | 'error'

/**
 * What the top bar shows. Reading wins over an older error (the memory is trying again); scenes
 * waiting their turn show nothing, so writing never makes the bar busy.
 */
export function keeperState(status: MemoryStatus | null): KeeperState {
  if (!status) return 'idle'
  if (status.reading) return 'reading'
  if (status.error) return 'error'
  return 'idle'
}

/**
 * After "Check again now" (World Memory Overhaul B2): why that read failed, once a status that came after the ask (not
 * `asked`, the one showing when it was asked) has the memory idle with an error. Then the line goes back from
 * "Checking…" to "Check again now", and the reason shows as it is. Null while it may still be reading, and when it read
 * without an error.
 */
export function checkAgainFailed(asked: MemoryStatus | null, now: MemoryStatus | null): string | null {
  if (!now || now === asked || now.reading || !now.error) return null
  return now.error
}

/** The tooltip while the memory reads: "Reading “The ferry”, then 2 more scenes." */
export function readingNote(status: MemoryStatus): string {
  const title = status.reading?.title.trim() || 'Untitled scene'
  const more = Math.max(0, status.behind - 1)
  const then = more === 0 ? '' : more === 1 ? ', then 1 more scene' : `, then ${more} more scenes`
  return `Reading “${title}”${then}. Click to see what the memory has changed.`
}

/**
 * The run behind a "Memory updated" note, or null: one that changed something since `sinceMs` (when
 * the world was opened), so an update from an earlier session never shows, and not one Adam has
 * already seen (`seen`).
 */
export function freshUpdate(status: MemoryStatus | null, seen: ID | null, sinceMs: number): { runId: ID; changes: number } | null {
  const u = status?.lastUpdate
  if (!u || u.changes <= 0 || u.runId === seen) return null
  const at = Date.parse(u.at)
  if (Number.isNaN(at) || at < sinceMs) return null
  return { runId: u.runId, changes: u.changes }
}

/** "1 change to the memory", "3 changes to the memory". */
export const changesNote = (n: number): string => `${n === 1 ? '1 change' : `${n.toLocaleString('en-GB')} changes`} to the memory`

/** True when a message's next step is in Settings, so a button can go there. */
export const pointsToSettings = (message: string): boolean => /\bSettings\b/.test(message)

export interface LogGroup {
  /** Stable key for the list. */
  key: string
  runId: ID
  /** The scene the run read, when it was one scene. */
  sceneId: ID | null
  /** "Book 1, Ch 2, Sc 3": where the run's changes come from. */
  where: string
  /** A heading of the run's own, which wins over the place: "Before Book 4 starts" for a story flow's run. */
  heading: string
  /** When the run happened (its newest line). */
  at: string
  items: MemoryLogItem[]
}

/** The heading of the notes about the whole world, at the top of the list. */
export const WHOLE_WORLD = 'Whole world'

/** A note about the whole world rather than one scene: the memory tidy-up's "N removed, M to check again". */
export const worldNote = (item: MemoryLogItem): boolean => !!item.note && !item.sceneId && !item.entryId

/**
 * The list grouped by run, keeping its order (newest first). Lines next to each other from the same
 * run and scene share one heading: a run that spans several scenes (the memory tidy-up) gets a
 * heading for each. `headings` gives some runs a heading of their own (the story flows' runs, which
 * belong to no scene). Notes about the whole world come first, under a heading of their own.
 */
export function groupLog(items: MemoryLogItem[], headings: ReadonlyMap<ID, string> = new Map()): LogGroup[] {
  const groups: LogGroup[] = []
  const world = items.filter(worldNote)
  if (world.length) {
    groups.push({
      key: `world:${world[0].id}`,
      runId: world[0].runId,
      sceneId: null,
      where: '',
      heading: WHOLE_WORLD,
      at: world[0].createdAt,
      items: world
    })
  }
  for (const item of items) {
    if (worldNote(item)) continue
    const last = groups[groups.length - 1]
    const own = headings.has(item.runId)
    const otherScene = !!last && !own && !!last.sceneId && !!item.sceneId && last.sceneId !== item.sceneId
    if (last && last.runId === item.runId && !last.key.startsWith('world:') && !otherScene) {
      last.items.push(item)
      continue
    }
    groups.push({
      key: `${item.runId}:${item.id}`,
      runId: item.runId,
      sceneId: item.sceneId,
      where: item.where.trim(),
      heading: headings.get(item.runId)?.trim() ?? '',
      at: item.createdAt,
      items: [item]
    })
  }
  return groups
}

/** The heading for a group: the run's own, else where its changes came from, else a plain fallback. */
export const groupHeading = (g: LogGroup): string => g.heading || g.where || (g.sceneId ? 'A scene' : 'Across the story')

/** How a line shows its change: what it was (struck through) and what it is now. Either may be missing. */
export function beforeAfter(item: MemoryLogItem): { before: string | null; after: string | null } {
  const before = item.before.trim() || null
  const after = item.after.trim() || null
  // Nothing to compare: the line's own words say it.
  if (before === after) return { before: null, after: null }
  return { before, after }
}

/**
 * True when a line's quoted words are no longer in its scene, so there is nothing there to show:
 * a fact taken away because its words were deleted or changed (and an entry gone to the Trash
 * because no scene mentions it), or Adam's own fact whose words in the scene were deleted.
 */
export const wordsGone = (item: Pick<MemoryLogItem, 'action' | 'text'>): boolean =>
  item.action === 'removed' || (item.action === 'updated' && /the scene['’]s words for it were deleted$/.test(item.text))

/** Marks one line undone, leaving the rest (and their order) alone. */
export const markUndone = (items: MemoryLogItem[], id: ID, undone = true): MemoryLogItem[] =>
  items.map((i) => (i.id === id ? { ...i, undone } : i))

/** Records Adam's answer to a question-marked line. */
export const markAnswered = (items: MemoryLogItem[], id: ID, answer: string | null): MemoryLogItem[] =>
  items.map((i) => (i.id === id && i.question ? { ...i, question: { ...i.question, answer } } : i))

/** Lines that can be undone: not failures, and not undone already. */
export const canUndo = (item: MemoryLogItem): boolean => item.action !== 'failed' && !item.undone
