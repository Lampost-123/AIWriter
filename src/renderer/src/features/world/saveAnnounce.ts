// When an entry page's own save tells the rest of the app (bumpEntries). Each bump makes every list, codex, check and
// open page in the app load again, so the page doesn't announce each pause in its typing: its own list is already up to
// date (onLiveChange). It announces at once only what other screens can't do without: the names it goes by (the scenes'
// name highlighting, the spelling word list, the palette, Read aloud's cast), where a place sits, and the tags and the
// hard rule (the codex). Anything else waits until Adam leaves the page (useEntryEditor).
import type { Entry } from '@shared/types'

export type Announced = Pick<Entry, 'name' | 'aliases' | 'parentId' | 'hardRule' | 'tags'>

export const announcedOf = (e: Announced): Announced => ({
  name: e.name,
  aliases: e.aliases,
  parentId: e.parentId,
  hardRule: e.hardRule,
  tags: e.tags
})

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

/** Whether a save changed something other screens show, since the copy they last heard about. */
export function othersNeedToKnow(before: Announced, saved: Announced): boolean {
  return (
    before.name !== saved.name ||
    !sameList(before.aliases, saved.aliases) ||
    (before.parentId ?? null) !== (saved.parentId ?? null) ||
    before.hardRule !== saved.hardRule ||
    !sameList(before.tags, saved.tags)
  )
}
