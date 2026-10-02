// Milestone 5, AI checks part: issues and check runs. The work is done in src/main/checks/* and the SQL is in
// db/checks.ts; this file connects them to the open world, the settings, the memory keeper and the window.
import type { Handlers } from './index'
import type { Issue } from '@shared/contracts/checks'
import type { EntryInput, ID } from '@shared/types'
import * as repo from '../db/repo'
import * as cdb from '../db/checks'
import * as world from '../world'
import * as providers from '../ai/providers'
import { getSettings, getWritingPrefs } from '../settings'
import { emit } from '../events'
import { jobModel } from '../ai/jobModel'
import { catchUpBeforeDraft } from '../ai/gather'
import { currentKeeper, entryEditedByHand, memoryStatus } from '../keeper'
import { loadShapeSafe } from '../keeper/places'
import { labeler } from '../memory/line'
import { UserError } from '../util'
import { closeRunsFor, setRunDeps, startCheck, stopCheck } from '../checks/runs'

/** How long a check waits for the memory to catch up before checking with what it has. */
const CATCH_UP_MS = 60_000

const modelSources = () => ({ settings: getSettings(), getProvider: providers.getProvider, providerTarget: providers.providerTarget })

/** Resolves when the promise does, after `ms`, or as soon as `signal` is aborted, whichever is first. */
const within = (p: Promise<unknown>, ms: number, signal: AbortSignal): Promise<void> =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const done = (): void => {
      clearTimeout(t)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const t = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    void p.finally(done)
  })

setRunDeps({
  model: () => jobModel('check', modelSources()),
  prefs: getWritingPrefs,
  emit,
  // As drafting does: queued or failed reads of earlier scenes on the line first, then the scene's own queued
  // read (so a clash the memory keeper raises from it isn't raised again by the check).
  // Stop and the world closing end the wait at once.
  beforeScene: async (db, sceneId, signal) => {
    await catchUpBeforeDraft(db, sceneId, CATCH_UP_MS, signal)
    const k = currentKeeper()
    if (k && k.db === db && !signal.aborted) await within(k.whenRead(sceneId), CATCH_UP_MS, signal)
  },
  onKeyRejected: (model) => providers.markCheck(model.target.id, false)
})

// Issues that change (a check, an ignore, the memory keeper raising one) are told to the window.
cdb.onIssuesTouched((storyId, sceneIds) => emit('issues:changed', { storyId, sceneIds }))

// Closing a world stops its checks first; nothing is written after.
world.onWorldClosing((w) => closeRunsFor(w.db))

/** The rows as issues, with entries' names and places as they are now. */
function asIssues(rows: Record<string, unknown>[]): Issue[] {
  const db = world.db()
  const entries = cdb.entryNamesFor(db, rows)
  let label: ((p: { storyId: ID | null; sceneId: ID }) => string) | null = null
  const sceneStory = new Map<ID, ID>()
  let titles: Map<ID, string> | null = null
  const names: cdb.IssueNames = {
    entry: (id) => {
      const e = entries.get(id)
      if (!e) return null
      return { name: e.name, kind: e.kind, value: e.value, isAdams: (field) => cdb.fieldOriginOf(e.origin, e.fieldOrigins, field) === 'adam' }
    },
    sceneLabel: (id) => {
      if (!label) {
        const shape = loadShapeSafe(db)
        const l = shape ? labeler(shape) : null
        for (const s of shape?.stories ?? []) for (const c of s.chapters) for (const sc of c.scenes) sceneStory.set(sc.id, s.id)
        label = (p) => (l ? l(p) : '')
      }
      return sceneStory.has(id) ? label({ storyId: sceneStory.get(id) ?? null, sceneId: id }) || null : null
    },
    storyTitle: (id) => (titles ??= cdb.storyTitles(db)).get(id) ?? null
  }
  return rows.map((r) => cdb.readIssue(r, names))
}

function sorted(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const texts = cdb.sceneTexts(
    world.db(),
    rows.flatMap((r) => (r.scene_id ? [r.scene_id as ID] : []))
  )
  return cdb.sortIssues(rows, (id) => texts.get(id) ?? '')
}

/** Changes an issue's status and returns it as it is now. */
function setStatus(id: ID, status: Issue['status']): Issue {
  const db = world.db()
  const row = cdb.setIssueStatus(db, id, status)
  if (!row) throw new UserError('That issue is no longer there.')
  repo.touchWorld(db)
  return asIssues([row])[0]
}

/** The patch that sets one field (kind-specific, or the entry's own summary or description). */
const patchFor = (field: string, value: string): EntryInput =>
  field === 'summary' || field === 'description' ? { [field]: value } : { fields: { [field]: value } }

export const issuesHandlers: Handlers<
  | 'listIssues'
  | 'listStoryIssues'
  | 'issueCounts'
  | 'ignoreIssue'
  | 'reopenIssue'
  | 'markIssueFixed'
  | 'updateMemoryFromIssue'
  | 'startCheck'
  | 'stopCheck'
> = {
  listIssues: (sceneId) => {
    const db = world.db()
    cdb.sweepGone(db, { sceneId })
    return asIssues(sorted(cdb.sceneIssueRows(db, sceneId)))
  },
  listStoryIssues: (storyId) => {
    const db = world.db()
    cdb.sweepGone(db, { storyId })
    return asIssues(sorted(cdb.storyIssueRows(db, storyId)))
  },
  issueCounts: (storyId) => {
    const db = world.db()
    cdb.sweepGone(db, { storyId })
    return cdb.openCounts(db, storyId)
  },
  ignoreIssue: (id) => setStatus(id, 'ignored'),
  // A live flag Adam ignored goes (as unignoreLive does) rather than becoming an open issue.
  reopenIssue: (id) => {
    const db = world.db()
    const row = cdb.reopenIssue(db, id)
    if (!row) throw new UserError('That issue is no longer there.')
    repo.touchWorld(db)
    return asIssues([row])[0]
  },
  markIssueFixed: (id) => setStatus(id, 'fixed'),
  updateMemoryFromIssue: (id) => {
    const db = world.db()
    const row = cdb.issueRow(db, id)
    if (!row) throw new UserError('That issue is no longer there.')
    const fix = asIssues([row])[0].memoryFix
    if (!fix) throw new UserError('This one can’t be settled by changing the memory. Fix the text, or ignore it.')
    let entry: ReturnType<typeof repo.getEntry>
    try {
      entry = repo.getEntry(db, fix.entryId)
    } catch {
      throw new UserError('That entry is no longer in the world, so the memory can’t be changed from here.')
    }
    // The same path as Adam editing the entry himself: the field becomes his, with a version in its history.
    db.transaction(() => {
      entryEditedByHand(db, entry, repo.updateEntry(db, fix.entryId, patchFor(fix.field, fix.value)))
      cdb.setIssueStatus(db, id, 'fixed')
    })()
    repo.touchWorld(db)
    emit('memory:changed', { sceneId: null, entryIds: [fix.entryId] })
    emit('memory:status', memoryStatus())
    return asIssues([cdb.issueRow(db, id)!])[0]
  },
  startCheck: (input) => startCheck(world.db(), input),
  stopCheck: (runId) => stopCheck(runId)
}
