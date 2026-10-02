// Pure helpers for the memory keeper's status and the "What changed" list. No React, no window,
// so they are unit-tested.

import type { ID, MemoryLogItem, MemoryStatus } from '@shared/types'

export type KeeperState = 'idle' | 'reading' | 'error'

/**
 * What the top bar shows. Reading wins over an older error (the keeper is trying again);
 * scenes waiting their turn show nothing, so typing never makes the bar busy.
 */
export function keeperState(status: MemoryStatus | null): KeeperState {
  if (!status) return 'idle'
  if (status.reading) return 'reading'
  if (status.error) return 'error'
  return 'idle'
}

/** The tooltip while the keeper reads: "Reading “The ferry”, then 2 more scenes." */
export function readingNote(status: MemoryStatus): string {
  const title = status.reading?.title.trim() || 'Untitled scene'
  const more = Math.max(0, status.behind - 1)
  const then = more === 0 ? '' : more === 1 ? ', then 1 more scene' : `, then ${more} more scenes`
  return `Reading “${title}”${then}. Click to see what the memory has changed.`
}

/** True when a message's next step is in Settings, so a button can go there. */
export const pointsToSettings = (message: string): boolean => /\bSettings\b/.test(message)

export interface LogGroup {
  /** Stable key for the list. */
  key: string
  sceneId: ID | null
  /** "Book 1, Ch 2, Sc 3", or what the group is about when it isn't one scene. */
  where: string
  items: MemoryLogItem[]
}

/**
 * The list grouped by scene, keeping its order (newest first). Items next to each other from the
 * same scene share one heading; a scene that comes up again further down gets a heading there too,
 * so the list stays in the order things happened.
 */
export function groupLog(items: MemoryLogItem[]): LogGroup[] {
  const groups: LogGroup[] = []
  for (const item of items) {
    const where = item.where.trim()
    const last = groups[groups.length - 1]
    if (last && last.sceneId === item.sceneId && (item.sceneId !== null || last.where === where)) {
      last.items.push(item)
      continue
    }
    groups.push({ key: `${item.sceneId ?? where}:${item.id}`, sceneId: item.sceneId, where, items: [item] })
  }
  return groups
}

/** The heading for a group: where it happened, or a plain fallback when that isn't known. */
export const groupHeading = (g: LogGroup): string => g.where || (g.sceneId ? 'A scene' : 'Across the story')

/** Marks one item undone, leaving the rest (and their order) alone. */
export const markUndone = (items: MemoryLogItem[], id: ID): MemoryLogItem[] => items.map((i) => (i.id === id ? { ...i, undone: true } : i))
