// Memory over time, summaries and briefing choices (milestone 2). The work is done in
// src/main/memory/* and src/main/db/memory.ts; this file connects it to the open world.
// Everything here is Adam's own doing (origin 'adam'), so the memory keeper never overwrites it.
import type { Handlers } from './index'
import type { Change, ChangeView, Entry, ID, SummaryLevel } from '@shared/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as history from '../db/history'
import * as world from '../world'
import { changeViews } from '../memory/scene'
import { emit } from '../events'
import { UserError } from '../util'

// prettier-ignore
type MemoryMethods =
  | 'setStoryPlacement'
  | 'listChanges' | 'createChange' | 'updateChange' | 'deleteChange' | 'restoreChange'
  | 'listFacts' | 'listExistsPoints' | 'listSceneChanges'
  | 'getSummary' | 'setSummary' | 'listStorySummaries'
  | 'setPin' | 'setBlockMode'
  | 'listEntryHistory' | 'restoreEntryVersion' | 'listEntryLinks'

/** Wraps a write so the world's "last changed" time moves (backups watch it). */
function write<T>(fn: () => T): T {
  const db = world.db()
  const result = db.transaction(fn)()
  repo.touchWorld(db)
  return result
}

/** Tells every window the memory changed, so lists, the scene card and the Context tab reload. */
const changed = (sceneId: ID | null, entryIds: ID[]): void => emit('memory:changed', { sceneId, entryIds: [...new Set(entryIds)] })

const view = (c: Change): ChangeView =>
  changeViews(world.db(), [c])[0] ?? { ...c, where: '', links: history.linksForFact(world.db(), 'change', c.id) }

const LEVELS: SummaryLevel[] = ['scene', 'chapter', 'story', 'series']
function checkLevel(level: SummaryLevel): void {
  if (!LEVELS.includes(level)) throw new UserError("That kind of summary isn't known.")
}

export const memoryHandlers: Handlers<MemoryMethods> = {
  setStoryPlacement: (id, placement) => {
    const entryIds = write(() => mem.setStoryPlacement(world.db(), id, placement))
    // What counts everywhere may have changed: every view of the memory reloads.
    changed(null, entryIds)
    return repo.getStory(world.db(), id)
  },

  listChanges: (entryId) => {
    const db = world.db()
    repo.getEntry(db, entryId)
    return changeViews(db, mem.changesForEntry(db, entryId))
  },
  createChange: (input) => {
    const c = write(() => {
      const clean = mem.cleanChangeInput(world.db(), input)
      return mem.insertChange(world.db(), { ...clean, origin: 'adam' })
    })
    changed(c.sceneId, mem.entriesTouched(c))
    return view(c)
  },
  updateChange: (id, input) => {
    // Adam's edit makes the change his: the keeper never changes it again (its source links stay, for reference).
    const [before, after] = write(() => {
      const old = mem.getChange(world.db(), id)
      const clean = mem.cleanChangeInput(world.db(), input)
      return [old, mem.replaceChange(world.db(), id, { ...clean, origin: 'adam' })] as const
    })
    changed(after.sceneId, [...mem.entriesTouched(before), ...mem.entriesTouched(after)])
    if (before.sceneId && before.sceneId !== after.sceneId) changed(before.sceneId, [])
    return view(after)
  },
  deleteChange: (id) => {
    const db = world.db()
    let old: Change
    try {
      old = mem.getChange(db, id)
    } catch {
      return // already gone
    }
    write(() => mem.deleteChange(db, id, { origin: 'adam' }))
    changed(old.sceneId, mem.entriesTouched(old))
  },
  restoreChange: (id) => {
    write(() => mem.restoreChange(world.db(), id, { origin: 'adam' }))
    const c = mem.getChange(world.db(), id)
    changed(c.sceneId, mem.entriesTouched(c))
  },
  listFacts: () => mem.listFacts(world.db()),
  listExistsPoints: (entryId) => mem.listExistsPoints(world.db(), entryId),
  listSceneChanges: (sceneId) => {
    const db = world.db()
    repo.getSceneMeta(db, sceneId)
    return changeViews(db, mem.changesInScene(db, sceneId))
  },

  getSummary: (level, targetId) => {
    checkLevel(level)
    return mem.getSummary(world.db(), level, targetId)
  },
  setSummary: (level, targetId, text) => {
    checkLevel(level)
    const db = world.db()
    if (!mem.summaryTargetExists(db, level, targetId)) throw new UserError(`That ${level} no longer exists.`)
    const words = typeof text === 'string' ? text.trim() : ''
    const summary = write(() => {
      // Adam's words are kept from then on. Clearing them hands the summary back to the app, which writes it again.
      if (words) return mem.putSummary(db, { level, targetId, text: words, origin: 'adam' })
      mem.putSummary(db, { level, targetId, text: '', origin: 'text' })
      mem.markSummaryStale(db, level, targetId)
      return mem.getSummary(db, level, targetId)!
    })
    changed(level === 'scene' ? targetId : null, [])
    return summary
  },
  listStorySummaries: (storyId) => {
    const db = world.db()
    repo.getStory(db, storyId)
    return mem.storySummaries(db, storyId)
  },

  setPin: (entryId, scope, scopeId, action) => write(() => mem.setPin(world.db(), entryId, scope, scopeId, action)),
  setBlockMode: (sceneId, blockId, mode) => write(() => mem.setBlockMode(world.db(), sceneId, blockId, mode)),

  listEntryHistory: (entryId) => history.entryHistory(world.db(), entryId),
  restoreEntryVersion: (entryId, versionId) => {
    const db = world.db()
    const v = history.getVersion(db, versionId)
    if (!v || v.factKind !== 'entry' || v.factId !== entryId) throw new UserError('That earlier version could not be found.')
    if (!v.data) throw new UserError('That version is from when the entry was removed. Pick an earlier one.')
    const old = v.data as Entry
    // Its own fields come back as they were; this writes a new version, so it can be undone too.
    const entry = write(() =>
      repo.updateEntry(
        db,
        entryId,
        {
          name: old.name,
          aliases: old.aliases ?? [],
          summary: old.summary ?? '',
          description: old.description ?? '',
          tags: old.tags ?? [],
          notes: old.notes ?? '',
          fields: old.fields ?? {},
          parentId: old.parentId ?? null,
          hardRule: !!old.hardRule
        },
        { origin: 'adam' }
      )
    )
    changed(null, [entryId])
    return entry
  },
  listEntryLinks: (entryId) => history.linksForEntry(world.db(), entryId)
}
