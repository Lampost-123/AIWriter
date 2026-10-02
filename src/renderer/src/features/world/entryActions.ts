import type { Entry, EntryKind, EntryInput } from '@shared/types'
import { KIND_LABELS } from '@shared/fields'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { announceDelete } from '@/lib/undoDelete'
import { forgetDraft, markFresh } from './entryDrafts'

/** What goes to the database from a form's copy of an entry. */
export const toPatch = (e: Entry): EntryInput => ({
  name: e.name,
  aliases: e.aliases,
  summary: e.summary,
  description: e.description,
  tags: e.tags,
  notes: e.notes,
  fields: e.fields,
  parentId: e.parentId,
  hardRule: e.hardRule
})

/** The name a new entry gets until Adam types one. */
export const newEntryName = (kind: EntryKind): string => `New ${KIND_LABELS[kind].one.toLowerCase()}`

/**
 * Creates an entry in the story Adam is working in (which decides where it first exists), and marks
 * it so its form opens with the name selected. `fresh: false` for entries made from a picker on
 * another page, which aren't opened.
 */
export async function createEntry(kind: EntryKind, name?: string, opts: { fresh?: boolean } = {}): Promise<Entry> {
  const e = await api.createEntry(kind, { name: name?.trim() || newEntryName(kind), originStoryId: useApp.getState().storyId })
  if (opts.fresh !== false) markFresh(e.id)
  useApp.getState().bumpEntries()
  return e
}

const label = (e: Entry): string => (e.name.trim() ? `"${e.name.trim()}"` : `the ${KIND_LABELS[e.kind].one.toLowerCase()}`)

/** Deletes straight away and offers Undo in a toast (and in Recently deleted). Returns false if it couldn't be deleted. */
export async function deleteEntryWithUndo(e: Entry): Promise<boolean> {
  try {
    await api.deleteEntry(e.id)
  } catch (err) {
    toast(`Couldn't delete ${label(e)}. ${(err as Error).message}`, { tone: 'danger' })
    return false
  }
  forgetDraft(e.id)
  useApp.getState().bumpEntries()
  const noun = KIND_LABELS[e.kind].one.toLowerCase()
  announceDelete({
    message: `Deleted ${label(e)}.`,
    noun: e.kind === 'lore' ? ['lore entry', 'lore entries'] : [noun, `${noun}s`],
    undo: () =>
      api
        .restoreDeleted('entry', e.id)
        .then(() => {
          const app = useApp.getState()
          app.bumpEntries()
          if (app.view.kind === 'entries' && app.view.entryKind === e.kind) app.navigate({ kind: 'entries', entryKind: e.kind, entryId: e.id })
        })
        .catch((err: Error) => void toast(`Couldn't bring back ${label(e)}. ${err.message}`, { tone: 'danger' }))
  })
  return true
}
