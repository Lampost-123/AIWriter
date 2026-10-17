// Milestone 4: the handlers for src/shared/contracts/outline.ts (one part owns both files). See
// docs/ARCHITECTURE.md, "Milestone 4". The SQL is in src/main/db/acts.ts and the rest in
// src/main/outline/*; this file connects them to the open world, the settings and the window.
import type { Handlers } from './index'
import type { KeptItem, OutlineApi } from '@shared/contracts/outline'
import type { ID } from '@shared/types'
import * as world from '../world'
import * as repo from '../db/repo'
import * as acts from '../db/acts'
import * as providers from '../ai/providers'
import { jobModel } from '../ai/jobModel'
import { getSettings } from '../settings'
import { emit } from '../events'
import { refreshDefaultExistsPoints, loadShape } from '../db/memory'
import { scenesDeleted, scenesRestored } from '../keeper'
import { actDeleteNotes, createChapterAt, keepOutline, unkeepOutline } from '../outline/structure'
import { startIdeasJob, startOutlineJob, type JobDeps } from '../outline/jobs'
import { isBlankPlan, storyPlan } from '../outline/context'
import { askPlanQuestion, fillSceneCard, startChapterPlan } from '../outline/interview'
import { cancelBuildFor } from '../worldBuilder/run'

/** Wraps a write so the world's "last changed" time moves (backups watch it). */
function write<T>(fn: () => T): T {
  const result = fn()
  repo.touchWorld(world.db())
  return result
}

/** The codex and pages showing the plot threads, characters and places a keep made (or its Undo took back) reload. */
function madeChanged(kept: KeptItem[]): void {
  const entryIds = [...new Set((Array.isArray(kept) ? kept : []).flatMap((k) => [...(k?.threadIds ?? []), ...(k?.entryIds ?? [])]))]
  if (entryIds.length) emit('memory:changed', { sceneId: null, entryIds })
}

/** The stories a keep's items are in (what is gone already counts for none). */
function keptStories(db: ReturnType<typeof world.db>, kept: KeptItem[]): ID[] {
  const out = new Set<ID>()
  for (const k of Array.isArray(kept) ? kept : []) {
    try {
      if (k?.kind === 'act') out.add(acts.getAct(db, k.id).storyId)
      else if (k?.kind === 'chapter') out.add(repo.getChapter(db, k.id).storyId)
      else if (k?.kind === 'scene') out.add(repo.getChapter(db, repo.getScene(db, k.id).chapterId).storyId)
    } catch {
      // Gone already: nothing of it to stop a build for.
    }
  }
  return [...out]
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
  startActAt: (chapterId) => write(() => acts.startActAt(world.db(), chapterId)),
  joinActBack: (id) => write(() => acts.joinActBack(world.db(), id)),

  outlineBlank: (storyId) => isBlankPlan(storyPlan(world.db(), storyId)),
  startOutline: (input) => startOutlineJob(jobDeps(), input),
  keepOutline: (storyId, items) => {
    const kept = write(() => keepOutline(world.db(), storyId, items ?? []))
    madeChanged(kept)
    return kept
  },
  unkeepOutline: async (kept) => {
    // The story's World build, when one runs, stops first (2026-10-17), so it never fills in a page this takes away.
    await cancelBuildFor(world.db(), keptStories(world.db(), kept ?? []))
    // Its chapter cards, and the plot threads, characters and places it made, go back too (unkeepOutline).
    const out = write(() => unkeepOutline(world.db(), kept ?? []))
    madeChanged(kept ?? [])
    if (out.sceneIds.length) scenesDeleted(world.db())
    return { sceneIds: out.sceneIds }
  },

  startSceneIdeas: (input) => startIdeasJob(jobDeps(), input),

  askPlanQuestion: (input) => askPlanQuestion(jobDeps(), input),
  fillSceneCard: (input) => fillSceneCard(jobDeps(), input),
  startChapterPlan: (input) => startChapterPlan(jobDeps(), input)
}
