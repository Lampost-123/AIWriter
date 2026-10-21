// The computer's own handlers that touch files outside a world: crash-recovery files and Show folder (review #1).
// A made-up data folder; nothing real is opened.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const openPath = vi.fn(async () => '')
const showOpenDialog = vi.fn()
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.0.0' },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: { showOpenDialog },
  shell: { openPath }
}))

const dir = mkdtempSync(join(tmpdir(), 'aiwrite-core-'))
let coreHandlers: (typeof import('./core'))['coreHandlers']
let settings: typeof import('../settings')
let world: typeof import('../world')

beforeAll(async () => {
  process.env.AIWRITE_DATA_DIR = dir
  coreHandlers = (await import('./core')).coreHandlers
  settings = await import('../settings')
  world = await import('../world')
})

afterAll(() => {
  world.closeWorld()
  delete process.env.AIWRITE_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe('recovery files', () => {
  it('keeps a scene’s recovery file and clears it again', async () => {
    const id = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'
    await coreHandlers.writeRecovery({ worldId: 'w', sceneId: id, doc: {}, text: 'Hello', savedAt: '2026-10-21T00:00:00Z' } as never)
    expect((await coreHandlers.listRecovery()).map((r) => r.sceneId)).toContain(id)
    await coreHandlers.clearRecovery(id)
    expect((await coreHandlers.listRecovery()).map((r) => r.sceneId)).not.toContain(id)
  })

  it('refuses a scene id that reaches outside the recovery folder', async () => {
    const keys = join(dir, 'keys.json')
    writeFileSync(keys, '{}')
    for (const sceneId of ['../keys', '..\\keys', 'a/b', '', 'C:x']) {
      await expect(async () => coreHandlers.writeRecovery({ worldId: 'w', sceneId, doc: {}, text: '', savedAt: '' } as never)).rejects.toThrow(
        /scene could not be found/
      )
      await expect(async () => coreHandlers.clearRecovery(sceneId)).rejects.toThrow(/scene could not be found/)
    }
    expect(existsSync(keys)).toBe(true)
  })
})

describe('Show folder', () => {
  it('opens the library folder and the second backup folder, and nothing else', async () => {
    const library = join(dir, 'library')
    const extra = join(dir, 'extra')
    settings.updateSettings({ libraryPath: library, backup: { extraFolder: extra } })
    await coreHandlers.showInFolder(library)
    await coreHandlers.showInFolder(join(extra, '.'))
    expect(openPath).toHaveBeenCalledTimes(2)
    for (const path of [join(library, 'world', 'world.db'), 'C:\\Windows\\System32\\calc.exe', dir]) {
      await expect(coreHandlers.showInFolder(path)).rejects.toThrow(/only opens its library folder/)
    }
    expect(openPath).toHaveBeenCalledTimes(2)
  })
})

describe('choosing a library folder', () => {
  it('keeps the world open when the folder chosen can’t be used', async () => {
    const library = join(dir, 'library-choose')
    settings.updateSettings({ libraryPath: library })
    const open = world.createWorld('Quay')
    // A file where the folder should be: it can't be made into a folder.
    const blocked = join(dir, 'not-a-folder')
    writeFileSync(blocked, 'x')
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [join(blocked, 'library')] })
    await expect(coreHandlers.chooseLibraryFolder()).rejects.toThrow(/can't use that folder/)
    expect(world.maybeCurrentWorld()?.id).toBe(open.id)
    expect(settings.getSettings().libraryPath).toBe(library)

    const next = join(dir, 'library-next')
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [next] })
    expect(await coreHandlers.chooseLibraryFolder()).toBe(next)
    expect(world.maybeCurrentWorld()).toBeNull()
    expect(existsSync(next)).toBe(true)
  })
})
