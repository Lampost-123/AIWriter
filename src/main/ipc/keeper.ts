// Marking scenes done and the memory keeper (milestone 2). The work is done in src/main/keeper/*;
// this file connects it to the open world and the window.
import type Database from 'better-sqlite3'
import type { Handlers } from './index'
import type { ID, MemoryLogItem, RereadEstimate, RereadTarget } from '@shared/types'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import * as world from '../world'
import { emit } from '../events'
import { labeler } from '../memory/line'
import { currentKeeper, markSceneDone, memoryModel, memoryStatus } from '../keeper'
import { guessReread, rereadCost } from '../importing/estimate'
import { getSettings } from '../settings'
import { isLocalUrl } from '../ai/errors'
import { UserError } from '../util'
import { sceneMarkedDone } from '../history'
import { loadShapeSafe } from '../keeper/places'
import { answerItem, undoItem, type Outcome } from '../keeper/undo'
import type { Undo } from '../keeper/apply'
import { isWorldLine } from '../worldBuilder/lines'
import { checkWhenDone } from '../checks/runs'
import { keepMemoryChecks, listMemoryChecks, removeMemoryCheck, undoMemoryCheck } from '../keeper/checkQueue'
import { runOrWait } from '../usage'

type KeeperMethods =
  | 'markSceneDone'
  | 'reopenScene'
  | 'sceneLeft'
  | 'getMemoryStatus'
  | 'listMemoryLog'
  | 'undoMemoryItem'
  | 'answerMemoryQuestion'
  | 'updateMemoryNow'
  | 'checkMemoryAgain'
  | 'estimateReread'
  | 'startReread'
  | 'stopReread'
  | 'listMemoryChecks'
  | 'keepMemoryChecks'
  | 'removeMemoryCheck'
  | 'undoMemoryCheck'

/** Wraps a write so the world's "last changed" time moves (backups watch it). */
function write<T>(fn: () => T): T {
  const db = world.db()
  const result = db.transaction(fn)()
  repo.touchWorld(db)
  return result
}

function changed(o: Outcome): void {
  emit('memory:changed', { sceneId: o.sceneId, entryIds: [...new Set(o.entryIds)] })
  emit('memory:status', memoryStatus())
}

/** Where each line's change comes from, in plain words: "Book 1, Ch 2, Sc 3"; for a roll-up "Book 1, Ch 2", "Book 1" or the series. */
function withWhere(rows: kdb.LogRow[]): MemoryLogItem[] {
  const db = world.db()
  const shape = loadShapeSafe(db)
  const label = shape ? labeler(shape) : null
  const stories = new Map(shape?.stories.map((s) => [s.id, s]) ?? [])
  const sceneStory = new Map<ID, ID>()
  for (const s of shape?.stories ?? []) for (const c of s.chapters) for (const sc of c.scenes) sceneStory.set(sc.id, s.id)
  let series: Map<ID, string> | null = null
  const where = (r: kdb.LogRow): string => {
    if (isWorldLine(r)) return 'Built from your summary' // a world build's line (milestone 4)
    if (!label) return ''
    if (r.sceneId) return label({ storyId: sceneStory.get(r.sceneId) ?? null, sceneId: r.sceneId })
    const u = r.undo as Undo | null
    if (u?.op !== 'summary') return ''
    if (u.level === 'chapter') return label({ storyId: u.place.storyId, chapterId: u.targetId })
    if (u.level === 'story') return stories.get(u.targetId)?.title ?? ''
    series ??= new Map(repo.listSeries(db).map((s) => [s.id, s.name]))
    return series.get(u.targetId) ?? ''
  }
  return rows.map(({ undo, ...r }) => ({ ...r, where: where({ ...r, undo }) }))
}

export const keeperHandlers: Handlers<KeeperMethods> = {
  markSceneDone: (id) => {
    const meta = write(() => markSceneDone(id) ?? kdb.markSceneDone(world.db(), id))
    sceneMarkedDone(id)
    // Milestone 5: its facts, knowledge and timeline are checked in the background (nothing at all without a model).
    // Milestone 6: while this month's AI spending has reached Adam's limit, the check waits until he carries on.
    const db = world.db()
    runOrWait(`done-check:${id}`, db, () => checkWhenDone(db, id))
    emit('memory:status', memoryStatus())
    return meta
  },
  reopenScene: (id) => write(() => kdb.reopenScene(world.db(), id)),
  sceneLeft: (id) => {
    currentKeeper()?.sceneLeft(id)
  },

  getMemoryStatus: () => memoryStatus(),
  listMemoryLog: (options) => withWhere(kdb.listLog(world.db(), options ?? {})),
  undoMemoryItem: (id) => {
    changed(write(() => undoItem(world.db(), id)))
  },
  answerMemoryQuestion: (id, optionId) => {
    const out = write(() => answerItem(world.db(), id, optionId))
    if (out.writeSummary) currentKeeper()?.refreshSummary(out.writeSummary.sceneId, out.writeSummary.logId)
    changed(out)
  },
  updateMemoryNow: (sceneId) => {
    currentKeeper()?.updateNow(sceneId)
  },
  checkMemoryAgain: (sceneId) => {
    currentKeeper()?.checkAgain(sceneId)
  },

  // Re-read a scene or a whole story (World Memory Overhaul B8).
  estimateReread: (target) => rereadEstimate(world.db(), target),
  startReread: (target) => {
    const db = world.db()
    const m = memoryModel()
    if ('error' in m) throw new UserError(m.error, 'no-memory-model')
    const ids = kdb.scenesToReread(db, target).map((s) => s.id)
    if (!ids.length) throw new UserError('There are no words to read there yet.')
    currentKeeper()?.reread(ids)
    emit('memory:status', memoryStatus())
  },
  stopReread: () => {
    currentKeeper()?.stopReread()
    emit('memory:status', memoryStatus())
  },

  // The memory check list (World Memory Overhaul B3).
  listMemoryChecks: () => listMemoryChecks(world.db()),
  keepMemoryChecks: (facts) => {
    const undo = write(() => keepMemoryChecks(world.db(), facts ?? []))
    checksChanged()
    return undo
  },
  removeMemoryCheck: (fact) => {
    const undo = write(() => removeMemoryCheck(world.db(), fact))
    checksChanged()
    return undo
  },
  undoMemoryCheck: (undo) => {
    write(() => undoMemoryCheck(world.db(), undo))
    checksChanged()
  }
}

/**
 * Roughly what a re-read costs (B8): the memory keeper's reading requests for those scenes (importing/estimate.ts), at
 * what the memory model has lately cost per token in its own runs' records, else at its prices. Free when it runs on
 * this computer; unknown (null) when neither is known.
 */
export function rereadEstimate(db: Database.Database, target: RereadTarget): RereadEstimate {
  if ('sceneId' in target) repo.getScene(db, target.sceneId)
  else repo.getStory(db, target.storyId)
  const scenes = kdb.scenesToReread(db, target)
  const words = scenes.reduce((n, s) => n + s.words, 0)
  const m = memoryModel()
  if ('error' in m) return { scenes: scenes.length, words, cost: null, free: false, model: null, problem: m.error }
  const model = m.choice.label || m.choice.modelId
  const free = m.target.kind === 'custom' && isLocalUrl(m.target.baseUrl)
  if (free) return { scenes: scenes.length, words, cost: 0, free, model, problem: null }
  const guess = guessReread(scenes, m.choice, getSettings().thinking?.memory ?? 'off')
  return { scenes: scenes.length, words, cost: rereadCost(guess, m.choice, kdb.memoryCostPerToken(db, m.choice.modelId)), free, model, problem: null }
}

/** A Keep, Remove or Undo on the memory check list changed facts: the pages showing them read them again. */
function checksChanged(): void {
  emit('memory:changed', { sceneId: null, entryIds: [] })
  emit('memory:status', memoryStatus())
}
