import { dialog, shell, BrowserWindow, app } from 'electron'
import { join } from 'node:path'
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import type { Handlers } from './index'
import type { RecoveryItem } from '@shared/types'
import * as repo from '../db/repo'
import * as world from '../world'
import { ensureLibraryFolder, getSettings, getWritingPrefs, setWritingPrefs, updateSettings } from '../settings'
import { userDataDir } from '../paths'
import { readJson, UserError, writeFileAtomicAsync } from '../util'
import { resolveFlush } from '../flush'
import { refreshDefaultExistsPoints } from '../db/memory'
import { entryEditedByHand, memorySettingsChanged, sceneSaved, scenesDeleted, scenesRestored } from '../keeper'

const recoveryDir = (): string => join(userDataDir(), 'recovery')
const recoveryFile = (sceneId: string): string => join(recoveryDir(), `${sceneId}.json`)

/** Writes and clears of one recovery file run one at a time, in the order they were asked for. */
const recoveryQueue = new Map<string, Promise<void>>()
function inOrder(file: string, fn: () => Promise<void> | void): Promise<void> {
  const run = (recoveryQueue.get(file) ?? Promise.resolve()).then(fn)
  const settled = run.catch(() => undefined)
  recoveryQueue.set(file, settled)
  void settled.then(() => {
    if (recoveryQueue.get(file) === settled) recoveryQueue.delete(file)
  })
  return run
}

/** Removes temp files left by a recovery write the app quit or crashed in the middle of. */
function removeStaleTemps(dir: string): void {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.tmp')) continue
    try {
      if (Date.now() - statSync(join(dir, f)).mtimeMs > 60_000) rmSync(join(dir, f), { force: true })
    } catch {
      /* gone already, or in use: try again next time */
    }
  }
}

type CoreMethods =
  | 'getAppInfo' | 'getSettings' | 'updateSettings' | 'getWritingPrefs' | 'setWritingPrefs' | 'chooseLibraryFolder'
  | 'showInFolder' | 'flushDone' | 'showWindow'
  | 'listWorlds' | 'createWorld' | 'openWorld' | 'getWorld' | 'updateWorld'
  | 'listSeries' | 'listStories' | 'createStory' | 'updateStory' | 'deleteStory'
  | 'getOutline' | 'createChapter' | 'updateChapter' | 'deleteChapter' | 'moveChapter'
  | 'createScene' | 'getScene' | 'updateScene' | 'saveSceneText' | 'updateSceneCard' | 'deleteScene' | 'moveScene'
  | 'listEntries' | 'getEntry' | 'createEntry' | 'updateEntry' | 'deleteEntry'
  | 'restoreDeleted' | 'listDeleted'
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
  updateSettings: (patch) => {
    const settings = updateSettings(patch)
    // A memory model chosen (or changed), or its thinking: the memory tries the scenes it couldn't read straight away.
    if (patch.models || patch.thinking?.memory) memorySettingsChanged()
    return settings
  },
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
  deleteStory: (id) =>
    write(() => {
      repo.deleteStory(world.db(), id)
      // The world's first story may have changed: entries that exist from its start follow it.
      refreshDefaultExistsPoints(world.db())
      scenesDeleted(world.db())
    }),

  getOutline: (storyId) => repo.getOutline(world.db(), storyId),
  createChapter: (storyId, input) => write(() => repo.createChapter(world.db(), storyId, input)),
  updateChapter: (id, patch) => write(() => repo.updateChapter(world.db(), id, patch)),
  deleteChapter: (id) =>
    write(() => {
      repo.deleteChapter(world.db(), id)
      scenesDeleted(world.db())
    }),
  moveChapter: (id, index) => write(() => repo.moveChapter(world.db(), id, index)),
  createScene: (chapterId, input) => write(() => repo.createScene(world.db(), chapterId, input)),
  getScene: (id) => repo.getScene(world.db(), id),
  updateScene: (id, patch) => write(() => repo.updateScene(world.db(), id, patch)),
  saveSceneText: (id, doc, text) => write(() => sceneSaved(id, repo.saveSceneText(world.db(), id, doc, text))),
  updateSceneCard: (id, card) => write(() => repo.updateSceneCard(world.db(), id, card)),
  deleteScene: (id) =>
    write(() => {
      repo.deleteScene(world.db(), id)
      scenesDeleted(world.db())
    }),
  moveScene: (id, chapterId, index) => write(() => repo.moveScene(world.db(), id, chapterId, index)),

  listEntries: (kind) => repo.listEntries(world.db(), kind),
  getEntry: (id) => repo.getEntry(world.db(), id),
  createEntry: (kind, input) => write(() => repo.createEntry(world.db(), kind, input)),
  updateEntry: (id, patch) =>
    write(() => {
      const db = world.db()
      return db.transaction(() => {
        const before = repo.getEntry(db, id)
        return entryEditedByHand(db, before, repo.updateEntry(db, id, patch))
      })()
    }),
  deleteEntry: (id) => write(() => repo.deleteEntry(world.db(), id)),
  restoreDeleted: (kind, id) =>
    write(() => {
      repo.restoreDeleted(world.db(), kind, id)
      if (kind === 'entry') return
      // A story brought back (with a chapter or scene of it, too) may be the world's first story again.
      refreshDefaultExistsPoints(world.db())
      scenesRestored(world.db())
    }),
  listDeleted: () => repo.listDeleted(world.db()),

  // Rewritten every half second or so while Adam types, so it never blocks the app: a file
  // held by antivirus is waited for in the background.
  writeRecovery: (item) => inOrder(recoveryFile(item.sceneId), () => writeFileAtomicAsync(recoveryFile(item.sceneId), JSON.stringify(item))),
  listRecovery: () => {
    mkdirSync(recoveryDir(), { recursive: true })
    removeStaleTemps(recoveryDir())
    return readdirSync(recoveryDir())
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson<RecoveryItem | null>(join(recoveryDir(), f), null))
      .filter((x): x is RecoveryItem => !!x)
  },
  clearRecovery: (sceneId) =>
    inOrder(recoveryFile(sceneId), () => {
      rmSync(recoveryFile(sceneId), { force: true })
    })
}
