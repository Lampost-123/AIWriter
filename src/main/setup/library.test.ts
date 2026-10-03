// The sample world in a real library folder (milestone 6): opening it again never makes a second one, and a
// deleted one is made afresh.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, BrowserWindow: { getAllWindows: () => [] } }))

const dir = mkdtempSync(join(tmpdir(), 'aiwrite-sample-'))
let world: typeof import('../world')
let library: typeof import('./library')

beforeAll(async () => {
  process.env.AIWRITE_DATA_DIR = dir
  world = await import('../world')
  library = await import('./library')
})

afterAll(() => {
  world.closeWorld()
  delete process.env.AIWRITE_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe('the sample world in the library', () => {
  it('is made once: opening it again opens the same world', () => {
    const first = library.openSampleWorld()
    world.closeWorld()
    const again = library.openSampleWorld()
    expect(again.id).toBe(first.id)
    expect(library.openSampleWorld().id).toBe(first.id)
    expect(world.listWorlds()).toHaveLength(1)
    expect(library.sampleWorlds().map((w) => w.id)).toEqual([first.id])
  })

  it('is made again once deleted, and a world of Adam’s own is never taken for it', () => {
    const old = library.openSampleWorld()
    world.closeWorld()
    rmSync(old.folder, { recursive: true, force: true })
    world.createWorld('The Northern Reaches')
    const made = library.openSampleWorld()
    expect(made.id).not.toBe(old.id)
    expect(world.listWorlds()).toHaveLength(2)
    expect(library.sampleWorlds().map((w) => w.id)).toEqual([made.id])
  })
})
