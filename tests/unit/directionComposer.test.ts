// The direction composer's calls (contracts/direction.ts, ipc/direction.ts): the directions given before, read from
// the open world's records, and the starred ones, kept in the writing preferences file beside the other preferences.
// Made-up values only.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { memoryWorld } from './helpers'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

/** The world the handlers see as open (null: none). */
let open: Database.Database | null = null
vi.mock('../../src/main/world', () => ({
  maybeCurrentWorld: () => (open ? { db: open } : null),
  db: () => {
    if (!open) throw new Error('No world is open.')
    return open
  }
}))

let dir: string
let lib: string
const prefsFile = (): string => join(lib, 'writing-preferences.json')
const onDisk = (): Record<string, unknown> => JSON.parse(readFileSync(prefsFile(), 'utf8')) as Record<string, unknown>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwrite-direction-'))
  lib = join(dir, 'library')
  process.env.AIWRITE_DATA_DIR = dir
  open = null
  vi.resetModules()
})

afterEach(() => {
  delete process.env.AIWRITE_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe('the starred directions', () => {
  it('are kept in the writing preferences file, beside the other preferences, and read back', async () => {
    mkdirSync(lib, { recursive: true })
    writeFileSync(prefsFile(), JSON.stringify({ spelling: 'US', voiceNotes: 'Dry wit' }))
    const { directionHandlers } = await import('../../src/main/ipc/direction')
    expect(await directionHandlers.directionFavourites()).toEqual([])
    expect(await directionHandlers.setDirectionFavourite('Make it tense', true)).toEqual(['Make it tense'])
    expect(await directionHandlers.setDirectionFavourite('More dialogue', true)).toEqual(['More dialogue', 'Make it tense'])
    expect(onDisk()).toEqual({ spelling: 'US', voiceNotes: 'Dry wit', favouriteDirections: ['More dialogue', 'Make it tense'] })
    expect(await directionHandlers.setDirectionFavourite('make it tense.', false)).toEqual(['More dialogue'])
    expect(await directionHandlers.directionFavourites()).toEqual(['More dialogue'])
  })

  it('are never taken back by saving the other preferences from a page opened before a star was given', async () => {
    const settings = await import('../../src/main/settings')
    const page = settings.getWritingPrefs()
    settings.setDirectionFavourite('End on a hook', true)
    // The preferences page saves what it opened with (no favourites in it), with Adam's change.
    const saved = settings.setWritingPrefs({ ...page, voiceNotes: 'Warmer' })
    expect(saved.favouriteDirections).toEqual(['End on a hook'])
    expect(onDisk()).toMatchObject({ voiceNotes: 'Warmer', favouriteDirections: ['End on a hook'] })
    // Nor given back by one opened while it was starred.
    const later = settings.getWritingPrefs()
    settings.setDirectionFavourite('End on a hook', false)
    expect(settings.setWritingPrefs(later).favouriteDirections).toBeUndefined()
    expect(settings.directionFavourites()).toEqual([])
  })

  it('start afresh from a preferences file that is not what it should be, keeping nothing broken', async () => {
    mkdirSync(lib, { recursive: true })
    writeFileSync(prefsFile(), '["not", "preferences"]')
    const { directionFavourites, setDirectionFavourite } = await import('../../src/main/settings')
    expect(directionFavourites()).toEqual([])
    expect(setDirectionFavourite('Slow the pace down.', true)).toEqual(['Slow the pace down.'])
    expect(onDisk()).toEqual({ favouriteDirections: ['Slow the pace down.'] })
  })
})

describe('recentDirections', () => {
  it('reads the open world, in one story when asked, and nothing with no world open', async () => {
    const { directionHandlers } = await import('../../src/main/ipc/direction')
    expect(await directionHandlers.recentDirections(null, 10, 'scene')).toEqual([])
    open = memoryWorld()
    const gens = await import('../../src/main/db/generations')
    const repo = await import('../../src/main/db/repo')
    const [story] = repo.listStories(open)
    const sceneId = repo.getOutline(open, story.id).scenes[0].id
    gens.insertGeneration(open, {
      id: 'g1',
      sceneId,
      job: 'draft',
      providerId: 'p',
      providerName: 'Fake',
      modelId: 'fake/writer',
      params: { temperature: 0.8, top_p: 0.95, max_tokens: 1500 },
      direction: 'End on the knock',
      blocks: [],
      messages: [],
      budget: { contextLength: 8000, reserved: 1500, available: 6500, used: 100 },
      entries: [],
      createdAt: '2026-10-19T08:00:00.000Z'
    })
    expect(await directionHandlers.recentDirections(story.id, 10, 'scene')).toEqual([
      { text: 'End on the knock', at: '2026-10-19T08:00:00.000Z', source: 'draft', uses: 1 }
    ])
    // What the window sends is checked: an unknown kind is the default, a limit that isn't a number is left out.
    expect(await directionHandlers.recentDirections(undefined, Number.NaN, 'everything' as never)).toHaveLength(1)
    expect(await directionHandlers.recentDirections(story.id, 10, 'rewrite')).toEqual([])
  })
})
