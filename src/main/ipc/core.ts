import { dialog, shell, BrowserWindow, app } from 'electron'
import { join } from 'node:path'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import type { Handlers } from './index'
import type { RecoveryItem } from '@shared/types'
import * as repo from '../db/repo'
import * as world from '../world'
import { ensureLibraryFolder, getSettings, getWritingPrefs, setWritingPrefs, updateSettings } from '../settings'
import { userDataDir } from '../paths'
import { readJson, UserError, writeFileAtomic } from '../util'
import { resolveFlush } from '../flush'

const recoveryDir = (): string => join(userDataDir(), 'recovery')

type CoreMethods =
  | 'getAppInfo' | 'getSettings' | 'updateSettings' | 'getWritingPrefs' | 'setWritingPrefs' | 'chooseLibraryFolder'
  | 'showInFolder' | 'flushDone' | 'showWindow'
  | 'listWorlds' | 'createWorld' | 'openWorld' | 'getWorld' | 'updateWorld'
  | 'listSeries' | 'listStories' | 'createStory' | 'updateStory' | 'deleteStory'
  | 'getOutline' | 'createChapter' | 'updateChapter' | 'deleteChapter' | 'moveChapter'
  | 'createScene' | 'getScene' | 'updateScene' | 'saveSceneText' | 'updateSceneCard' | 'deleteScene' | 'moveScene'
  | 'listEntries' | 'getEntry' | 'createEntry' | 'updateEntry' | 'deleteEntry'
  | 'restoreDeleted'
  | 'writeRecovery' | 'listRecovery' | 'clearRecovery'

/** Wraps a write so the world's "last changed" time moves (backups watch it). */
function write<T>(fn: () => T): T {
  const result = fn()
  repo.touchWorld(world.db())
  return result
}

export const coreHandlers: Handlers<CoreMethods> = {
  getAppInfo: () => ({
    version: app.getVersion(),
    platform: process.platform,
    libraryPath: getSettings().libraryPath,
    dataPath: userDataDir(),
    libraryReachable: ensureLibraryFolder()
  }),
  getSettings: () => getSettings(),
  updateSettings: (patch) => updateSettings(patch),
  getWritingPrefs: () => getWritingPrefs(),
  setWritingPrefs: (prefs) => setWritingPrefs(prefs),
  chooseLibraryFolder: async () => {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { title: 'Choose your AI Write library folder', properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    world.closeWorld()
    mkdirSync(res.filePaths[0], { recursive: true })
    updateSettings({ libraryPath: res.filePaths[0], lastWorldId: null, lastStoryId: null, lastSceneId: null })
    return res.filePaths[0]
  },
  showInFolder: async (path) => {
    await shell.openPath(path)
  },
  flushDone: () => resolveFlush(),
  showWindow: () => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && !w.isVisible()) w.show()
  },

  listWorlds: () => world.listWorlds(),
  createWorld: (name) => world.createWorld(name),
  openWorld: (id) => {
    try {
      return world.openWorld(id)
    } catch (e) {
      if (e instanceof UserError) throw e
      console.warn('Could not open a world:', e)
      throw new UserError(
        "AI Write couldn't open that world. Its folder may be damaged, or another program may be using it (often a cloud sync app or antivirus). Wait a moment, then try again."
      )
    }
  },
  getWorld: () => world.getWorld(),
  updateWorld: (patch) => world.updateWorld(patch),

  listSeries: () => repo.listSeries(world.db()),
  listStories: () => repo.listStories(world.db()),
  createStory: (input) => write(() => repo.createStory(world.db(), input)),
  updateStory: (id, patch) => write(() => repo.updateStory(world.db(), id, patch)),
  deleteStory: (id) => write(() => repo.deleteStory(world.db(), id)),

  getOutline: (storyId) => repo.getOutline(world.db(), storyId),
  createChapter: (storyId, input) => write(() => repo.createChapter(world.db(), storyId, input)),
  updateChapter: (id, patch) => write(() => repo.updateChapter(world.db(), id, patch)),
  deleteChapter: (id) => write(() => repo.deleteChapter(world.db(), id)),
  moveChapter: (id, index) => write(() => repo.moveChapter(world.db(), id, index)),
  createScene: (chapterId, input) => write(() => repo.createScene(world.db(), chapterId, input)),
  getScene: (id) => repo.getScene(world.db(), id),
  updateScene: (id, patch) => write(() => repo.updateScene(world.db(), id, patch)),
  saveSceneText: (id, doc, text) => write(() => repo.saveSceneText(world.db(), id, doc, text)),
  updateSceneCard: (id, card) => write(() => repo.updateSceneCard(world.db(), id, card)),
  deleteScene: (id) => write(() => repo.deleteScene(world.db(), id)),
  moveScene: (id, chapterId, index) => write(() => repo.moveScene(world.db(), id, chapterId, index)),

  listEntries: (kind) => repo.listEntries(world.db(), kind),
  getEntry: (id) => repo.getEntry(world.db(), id),
  createEntry: (kind, input) => write(() => repo.createEntry(world.db(), kind, input)),
  updateEntry: (id, patch) => write(() => repo.updateEntry(world.db(), id, patch)),
  deleteEntry: (id) => write(() => repo.deleteEntry(world.db(), id)),
  restoreDeleted: (kind, id) => write(() => repo.restoreDeleted(world.db(), kind, id)),

  writeRecovery: (item) => {
    writeFileAtomic(join(recoveryDir(), `${item.sceneId}.json`), JSON.stringify(item))
  },
  listRecovery: () => {
    mkdirSync(recoveryDir(), { recursive: true })
    return readdirSync(recoveryDir())
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson<RecoveryItem | null>(join(recoveryDir(), f), null))
      .filter((x): x is RecoveryItem => !!x)
  },
  clearRecovery: (sceneId) => {
    rmSync(join(recoveryDir(), `${sceneId}.json`), { force: true })
  }
}
