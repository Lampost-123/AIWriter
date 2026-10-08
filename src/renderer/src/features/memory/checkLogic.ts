// The memory check list's words and grouping (World Memory Overhaul B3): what the memory isn't sure about, under
// plain headings. Pure (no React, no API), so it is unit-tested (checkLogic.test.ts).

import type { MemoryCheckGroup, MemoryCheckItem } from '@shared/types'

export interface CheckGroupInfo {
  id: MemoryCheckGroup
  title: string
  /** One line under the heading saying what the group means. */
  help: string
}

/** The groups in the order they show. */
export const CHECK_GROUPS: CheckGroupInfo[] = [
  {
    id: 'unconfirmed',
    title: 'Words you’ve edited since',
    help: 'The memory read these from words you’ve changed since, and hasn’t confirmed them yet. The AI leaves them out until it does.'
  },
  {
    id: 'guess',
    title: 'The AI’s guesses',
    help: 'Details the AI filled in that nothing in your story says yet. The AI is told they’re guesses.'
  },
  {
    id: 'summary',
    title: 'Summaries being updated',
    help: 'These scenes have changed since their summary was written. The memory updates them by itself before long.'
  },
  {
    id: 'note',
    title: 'Your facts the story no longer says',
    help: 'You wrote these yourself, so they stay as you wrote them. The scene’s words no longer say the same.'
  }
]

export interface CheckGroup extends CheckGroupInfo {
  items: MemoryCheckItem[]
}

/** The items under their headings, in the fixed order, leaving out empty groups. */
export function groupChecks(items: MemoryCheckItem[]): CheckGroup[] {
  return CHECK_GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.group === g.id) })).filter((g) => g.items.length > 0)
}

/** "3 things to check". */
export function checkCountLabel(n: number): string {
  if (n <= 0) return 'Nothing to check'
  return n === 1 ? '1 thing to check' : `${n} things to check`
}

/** True when Show me has somewhere to go: a scene (with or without words in it). */
export const showsWords = (item: MemoryCheckItem): boolean => !!item.sceneId

/** The list without these items (after Keep or Remove). */
export function dropChecks(items: MemoryCheckItem[], keys: string[]): MemoryCheckItem[] {
  const gone = new Set(keys)
  return items.filter((i) => !gone.has(i.key))
}

/** What the toast says after Keep (one item) or Keep all. */
export function keptToast(items: MemoryCheckItem[]): string {
  if (items.length > 1) return `Kept ${items.length}. They're yours now.`
  switch (items[0]?.group) {
    case 'unconfirmed':
      return "Kept. It's yours now, and stays as it is when the words change."
    case 'summary':
      return 'Kept. The summary stays until the scene changes again.'
    case 'note':
      return 'Kept as you wrote it.'
    default:
      return "Kept. It's yours now."
  }
}

const quoted = (s: string, max = 60): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return `“${t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t}”`
}

/** What the toast says after Remove (it carries Undo). */
export function removedToast(item: MemoryCheckItem): string {
  const name = item.entryName.trim()
  const what = checkWhat(item)
  return name ? `Removed ${quoted(what)} from ${name}.` : `Removed ${quoted(what)}.`
}

/** What a row is about, without a note's "the scene no longer says this" tail. */
export function checkWhat(item: MemoryCheckItem): string {
  return item.group === 'note' ? item.text.replace(/:\s*the scene no longer says this.*$/i, '') : item.text
}
