// Milestone 6: the handlers for src/shared/contracts/importing.ts (the Manuscript import part). The work is done
// in src/main/importing/*; this file connects it to the open world, the memory keeper, the settings and the window.
import { BrowserWindow, dialog } from 'electron'
import type { Handlers } from './index'
import type { CatchUpState, ImportingApi } from '@shared/contracts/importing'
import * as world from '../world'
import * as repo from '../db/repo'
import * as idb from '../db/importing'
import { getSettings } from '../settings'
import { emit } from '../events'
import { currentKeeper, memoryModel, memoryStatus, onMemorySettingsChanged } from '../keeper'
import { pausedNote } from '../usage/gate'
import { UserError } from '../util'
import { MANUSCRIPT_EXTENSIONS, readManuscriptFile } from '../importing/read'
import { importPlan } from '../importing/save'
import { CatchUp } from '../importing/catchUp'
import { catchUpCost, guessCatchUp } from '../importing/estimate'

/** The open world's import catch-up (null when no world is open). */
let catchUp: CatchUp | null = null

const told = (s: CatchUpState): void => emit('importing:catchUp', s)

world.onWorldOpened((w) => {
  catchUp?.close()
  const mine = new CatchUp({
    db: w.db,
    keeper: () => (world.maybeCurrentWorld()?.db === w.db ? currentKeeper() : null),
    // While this month's spending has reached Adam's limit, the catch-up pauses with that reason, as the keeper does.
    model: () => {
      const paused = pausedNote()
      return paused ? { error: paused } : memoryModel()
    },
    emit: told
  })
  catchUp = mine
  // After the world has finished opening (the memory keeper starts as it opens, after this).
  setImmediate(() => {
    if (catchUp === mine && w.db.open) mine.resume()
  })
})

// A memory model chosen, or the spending limit lifted: a paused catch-up carries on by itself.
onMemorySettingsChanged(() => catchUp?.carryOn())

// Closing a world stops the catch-up first; what is left to read is kept in the world, for when it opens again.
world.onWorldClosing((w) => {
  if (catchUp && world.maybeCurrentWorld()?.db === w.db) {
    catchUp.close()
    catchUp = null
  }
})

const openCatchUp = (): CatchUp => {
  world.currentWorld()
  if (!catchUp) throw new UserError('No world is open. Pick or create a world first.')
  return catchUp
}

export const importingHandlers: Handlers<keyof ImportingApi> = {
  chooseManuscript: async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts: Electron.OpenDialogOptions = {
      title: 'Import a manuscript',
      buttonLabel: 'Import',
      properties: ['openFile'],
      filters: [
        { name: 'Manuscripts (Word, Markdown, text)', extensions: MANUSCRIPT_EXTENSIONS },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    return readManuscriptFile(res.filePaths[0])
  },
  importManuscript: (plan) => {
    const db = world.db()
    const result = importPlan(db, plan)
    // The binder's badges and the palette learn the story has unread scenes; the memory's own counts follow.
    emit('memory:status', memoryStatus())
    if (catchUp) told(catchUp.state())
    return result
  },
  getCatchUp: () => (catchUp && world.maybeCurrentWorld() ? catchUp.state() : { running: null, unread: {}, finished: null }),
  estimateCatchUp: (storyId) => {
    const db = world.db()
    repo.getStory(db, storyId)
    const scenes = idb.unreadSizes(db, storyId)
    const chapters = new Set(scenes.map((s) => s.chapterId)).size
    const words = scenes.reduce((n, s) => n + s.words, 0)
    const m = memoryModel()
    if ('error' in m) return { storyId, scenes: scenes.length, chapters, words, cost: null, model: null, problem: m.error }
    const guess = guessCatchUp(scenes, chapters, m.choice, getSettings().thinking?.memory ?? 'off')
    return {
      storyId,
      scenes: scenes.length,
      chapters,
      words,
      cost: catchUpCost(guess, m.choice),
      model: m.choice.label || m.choice.modelId,
      problem: null
    }
  },
  startCatchUp: (storyId) => {
    const c = openCatchUp()
    repo.getStory(world.db(), storyId)
    const m = memoryModel()
    if ('error' in m) throw new UserError(m.error, 'no-memory-model')
    c.start(storyId)
  },
  stopCatchUp: async () => {
    await catchUp?.stop()
  }
}
