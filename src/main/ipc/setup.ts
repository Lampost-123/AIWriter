// Milestone 6: the handlers for src/shared/contracts/setup.ts (the First run part). Where the setup stands is
// worked out in src/main/setup/state.ts; the sample world is made by src/main/setup/sampleWorld.ts.
import type { Handlers } from './index'
import type { SetupApi, SetupState, SetupStep } from '@shared/contracts/setup'
import { SETUP_STEPS } from '@shared/contracts/setup'
import type { FirstRun, ID } from '@shared/types'
import * as world from '../world'
import * as repo from '../db/repo'
import { ensureLibraryFolder, getSettings, updateSettings } from '../settings'
import { UserError } from '../util'
import { openSampleWorld, sampleWorlds } from '../setup/library'
import { isSampleWorld } from '../setup/sampleWorld'
import { setupAt, startAt, type SetupFacts } from '../setup/state'

/** What the setup's rules need to know, read now. */
function facts(): SetupFacts {
  const reachable = ensureLibraryFolder()
  const worlds = reachable ? world.listWorlds() : []
  const settings = getSettings()
  const sampleIds = sampleWorlds(worlds).map((w) => w.id)
  const last = settings.lastWorldId
  return {
    off: process.env.AIWRITE_SETUP === 'off',
    reachable,
    firstRun: settings.firstRun,
    openWorldId: world.maybeCurrentWorld()?.id ?? null,
    worldIds: worlds.map((w) => w.id),
    sampleIds,
    usedBefore: !!settings.models.writer || (!!last && last !== settings.firstRun?.worldId && !sampleIds.includes(last))
  }
}

/** The state to send, opening the world a resumed setup is for when it isn't open yet. */
function stateOf(f: SetupFacts, at: { step: SetupStep | null; worldId: ID | null }): SetupState {
  if (at.step && at.worldId && f.openWorldId !== at.worldId) world.openWorld(at.worldId)
  return { ...at, sampleWorldId: f.sampleIds[0] ?? null }
}

const remember = (firstRun: FirstRun | null): void => void updateSettings({ firstRun })

export const setupHandlers: Handlers<keyof SetupApi> = {
  getSetup: () => {
    // Nearly every launch: the last world reopened and no setup under way for another world. The answer then needs
    // no look through the library (which can be slow, on a network or a waking drive), so the window shows at once.
    const open = world.maybeCurrentWorld()
    const run = getSettings().firstRun
    if (open && (!run || run.step === 'guide' || run.worldId === open.id)) {
      const resume = run && run.step !== 'guide' && run.worldId === open.id ? { step: run.step, worldId: open.id } : null
      return { step: resume?.step ?? null, worldId: resume?.worldId ?? null, sampleWorldId: isSampleWorld(open.db) ? open.id : null }
    }
    const f = facts()
    // A setup whose world has gone (deleted outside AI Write) is forgotten; the rules start afresh.
    const was = f.firstRun
    if (f.reachable && was?.worldId && !f.worldIds.includes(was.worldId)) {
      remember(null)
      f.firstRun = null
    }
    return stateOf(f, setupAt(f))
  },
  startSetup: () => {
    const f = facts()
    return stateOf(f, startAt(f))
  },
  setSetupStep: (step) => {
    if (!SETUP_STEPS.includes(step)) throw new UserError("That step of the setup isn't known.")
    const open = world.maybeCurrentWorld()
    // Before the world is made there is nothing to resume: the first step shows by itself while the library is empty.
    if (open) remember({ worldId: open.id, step, sceneId: null })
    const f = facts()
    return { step, worldId: open?.id ?? null, sampleWorldId: f.sampleIds[0] ?? null }
  },
  finishSetup: () => {
    const w = world.currentWorld()
    const db = w.db
    const ids = db.transaction(() => {
      const story = repo.listStories(db)[0] ?? repo.createStory(db, { title: 'Book 1' })
      const outline = repo.getOutline(db, story.id)
      const chapterId = outline.chapters[0]?.id ?? repo.createChapter(db, story.id, { title: 'Chapter 1' }).id
      const sceneId = outline.scenes.find((s) => s.chapterId === chapterId)?.id ?? repo.createScene(db, chapterId, { title: 'Scene 1' }).id
      return { storyId: story.id, sceneId }
    })()
    repo.touchWorld(db)
    remember({ worldId: w.id, step: 'guide', sceneId: ids.sceneId })
    return ids
  },
  endFirstSceneGuide: () => {
    if (getSettings().firstRun) remember(null)
  },
  sampleWorldOpen: () => {
    const open = world.maybeCurrentWorld()
    return open && isSampleWorld(open.db) ? open.id : null
  },
  openSampleWorld: () => {
    try {
      return openSampleWorld()
    } catch (e) {
      if (e instanceof UserError) throw e
      console.warn('Could not open the sample world:', e)
      throw new UserError("AI Write couldn't open the sample world. Wait a moment, then try again.")
    }
  }
}
