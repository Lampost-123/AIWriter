// Milestone 4: the handlers for src/shared/contracts/outline.ts (one part owns both files). See
// docs/ARCHITECTURE.md, "Milestone 4". The SQL is in src/main/db/acts.ts and the rest in
// src/main/outline/*; this file connects them to the open world, the settings and the window.
import type { Handlers } from './index'
import type { OutlineApi } from '@shared/contracts/outline'
import * as world from '../world'
import * as repo from '../db/repo'
import * as acts from '../db/acts'
import * as providers from '../ai/providers'
import { jobModel } from '../ai/jobModel'
import { getSettings } from '../settings'
import { emit } from '../events'
import { refreshDefaultExistsPoints, loadShape } from '../db/memory'
import { scenesDeleted, scenesRestored } from '../keeper'
import { actDeleteNotes, createChapterAt, keepOutline } from '../outline/structure'
import { startIdeasJob, startOutlineJob, type JobDeps } from '../outline/jobs'

/** Wraps a write so the world's "last changed" time moves (backups watch it). */
function write<T>(fn: () => T): T {
  const result = fn()
  repo.touchWorld(world.db())
  return result
}

/** What an AI call needs: the open world and the chat and brainstorm model (or, in plain words, why there is none). */
function jobDeps(): JobDeps {
  const model = jobModel('chat', { settings: getSettings(), getProvider: providers.getProvider, providerTarget: providers.providerTarget })
  return { db: world.db(), model, emit, onKeyRejected: () => providers.markCheck(model.target.id, false) }
}

export const outlineHandlers: Handlers<keyof OutlineApi> = {
  createAct: (storyId, input) => write(() => acts.createAct(world.db(), storyId, { title: input?.title, afterId: input?.afterId ?? null })),
  updateAct: (id, patch) => write(() => acts.updateAct(world.db(), id, patch ?? {})),
  deleteAct: (id) => {
    const out = write(() => acts.deleteAct(world.db(), id))
    // The memory sets aside what its scenes said, as it does when a chapter is deleted.
    scenesDeleted(world.db())
    return out
  },
  restoreAct: (id) => {
    write(() => acts.restoreAct(world.db(), id))
    refreshDefaultExistsPoints(world.db())
    scenesRestored(world.db())
  },
  actDeleteNotes: (id) => {
    const db = world.db()
    const act = acts.getAct(db, id)
    const chapterIds = repo
      .getOutline(db, act.storyId)
      .chapters.filter((c) => c.actId === id)
      .map((c) => c.id)
    return actDeleteNotes(loadShape(db), chapterIds)
  },
  createChapterAt: (storyId, place) => write(() => createChapterAt(world.db(), storyId, place ?? { actId: null })),
  placeChapter: (chapterId, place) => write(() => acts.placeChapter(world.db(), chapterId, place ?? { actId: null })),

  startOutline: (input) => startOutlineJob(jobDeps(), input),
  keepOutline: (storyId, items) => write(() => keepOutline(world.db(), storyId, items ?? [])),
  unkeepOutline: (kept) => {
    const out = write(() => acts.takeBackKept(world.db(), kept ?? []))
    if (out.sceneIds.length) scenesDeleted(world.db())
    return { sceneIds: out.sceneIds }
  },

  startSceneIdeas: (input) => startIdeasJob(jobDeps(), input)
}
