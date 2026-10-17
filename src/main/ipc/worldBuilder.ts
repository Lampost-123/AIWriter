// Milestone 4: the handlers for src/shared/contracts/worldBuilder.ts (one part owns both files). The work is
// done in src/main/worldBuilder/*; this file connects it to the open world, the settings and the window.
import type { Handlers } from './index'
import type { WorldBuildInput, WorldBuilderApi } from '@shared/contracts/worldBuilder'
import type { ID } from '@shared/types'
import * as world from '../world'
import * as repo from '../db/repo'
import * as providers from '../ai/providers'
import { getSettings, getWritingPrefs } from '../settings'
import { emit } from '../events'
import { jobModel } from '../ai/jobModel'
import { memoryStatus } from '../keeper'
import { voiceLater } from '../readAloud'
import { UserError } from '../util'
import { entryNames } from '../db/worldBuilder'
import { buildRunning, buildState, cancelBuild, closeBuildsFor, startBuild } from '../worldBuilder/run'
import { storySummary } from '../worldBuilder/storySummary'
import { redoBuild, undoBuild } from '../worldBuilder/lines'
import { estimateCost, guessBuild } from '../worldBuilder/estimate'
import { askQuestion } from '../worldBuilder/interview'

/** Where the summary is kept in the world (its meta table), so the page reopens with it. */
const SUMMARY_KEY = 'world_summary'

// Closing a world cancels its build first, finishing its run while the database is still open.
world.onWorldClosing((w) => closeBuildsFor(w.db))

const modelSources = () => ({ settings: getSettings(), getProvider: providers.getProvider, providerTarget: providers.providerTarget })

/** The read-aloud model, which Suggest uses for a character's voice; null when there is none to use. */
function voiceModel(): ReturnType<typeof jobModel> | null {
  try {
    return jobModel('speech', modelSources())
  } catch {
    return null
  }
}

/** Keeps the summary as given (unless it is already kept), so the page reopens with it. */
function keepSummary(summary: unknown): void {
  const db = world.db()
  const text = typeof summary === 'string' ? summary : ''
  if ((repo.getMeta(db, SUMMARY_KEY) ?? '') === text) return
  repo.setMeta(db, SUMMARY_KEY, text)
  repo.touchWorld(db)
}

/** The memory changed: lists and pages showing these entries reload, and the top bar's note says so. */
function changed(entryIds: ID[]): void {
  emit('memory:changed', { sceneId: null, entryIds: [...new Set(entryIds)] })
  emit('memory:status', memoryStatus())
}

/** Starts a build in the open world with the World builder model; its events say how it goes. */
function startIn(input: WorldBuildInput): void {
  const w = world.currentWorld()
  const model = jobModel('world', modelSources())
  void startBuild(
    {
      db: w.db,
      worldId: w.id,
      model,
      voiceModel: voiceModel(),
      voiceLater: (entryIds) => voiceLater(w.db, entryIds),
      prefs: getWritingPrefs(),
      emit,
      onSaved: (entryIds) => {
        if (!w.db.open) return
        repo.touchWorld(w.db)
        emit('memory:changed', { sceneId: null, entryIds })
      },
      onFinished: () => emit('memory:status', memoryStatus()),
      onKeyRejected: () => providers.markCheck(model.target.id, false)
    },
    input
  )
}

export const worldBuilderHandlers: Handlers<keyof WorldBuilderApi> = {
  getWorldBuilder: () => {
    const w = world.currentWorld()
    return buildState(w.db, w.id, repo.getMeta(w.db, SUMMARY_KEY) ?? '')
  },
  saveWorldSummary: (summary) => keepSummary(summary),
  estimateWorldBuild: (input) => {
    const db = world.db()
    try {
      const model = jobModel('world', modelSources())
      const guess = guessBuild(String(input?.summary ?? ''), model.choice, entryNames(db).length, model.thinking)
      return { cost: estimateCost(guess, model.choice), model: model.choice.label || model.choice.modelId, problem: null, code: null }
    } catch (e) {
      if (e instanceof UserError) return { cost: null, model: null, problem: e.message, code: e.code ?? null }
      throw e
    }
  },
  startWorldBuild: (input) => {
    // Kept first, so the summary is there even when the build can't start.
    keepSummary(input?.summary)
    startIn(input)
  },
  buildStoryWorld: (input) => {
    const w = world.currentWorld()
    const storyId = String(input?.storyId ?? '')
    // Nothing planned to build from, or a build already running (the window tries again once it ends).
    if (buildRunning()) return { started: false, busy: true }
    if (!repo.listStories(w.db).some((s) => s.id === storyId)) return { started: false, busy: false }
    const summary = storySummary(w.db, storyId)
    if (!summary) return { started: false, busy: false }
    // The story's plan is never kept as the World builder page's summary: that stays Adam's.
    startIn({ buildId: String(input?.buildId ?? ''), summary, storyId })
    return { started: true, busy: false }
  },
  cancelWorldBuild: (buildId) => cancelBuild(buildId),
  undoWorldBuild: (runId) => {
    const db = world.db()
    const out = db.transaction(() => undoBuild(db, runId))()
    repo.touchWorld(db)
    changed(out.entryIds)
    return { lineIds: out.lineIds }
  },
  redoWorldBuild: (runId, lineIds) => {
    const db = world.db()
    const out = db.transaction(() => redoBuild(db, runId, Array.isArray(lineIds) ? lineIds : []))()
    repo.touchWorld(db)
    changed(out.entryIds)
  },
  askWorldQuestion: (input) => {
    const model = jobModel('world', modelSources())
    return askQuestion({ db: world.db(), model, emit, onKeyRejected: () => providers.markCheck(model.target.id, false) }, input)
  }
}
