// Settings saved by the released app (0.8.1, e3bb8dc1) load in this version with every value kept: settings.json with
// every value changed from its default (once on the Classic look with panels, once on the New look's desk) and
// writing-preferences.json (tests/fixtures/settings/settings-0.8.1.json holds what that code saved and what it read
// back). Automatic AI (shared/automaticAi.ts) reads the switches as they were saved and changes none of them.
// Invented values only; no keys (they are never in settings).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTOMATIC_AI_KEYS, automaticAiLevel } from '../../src/shared/automaticAi'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

interface Saved {
  raw: Record<string, unknown>
  read: Record<string, unknown>
}
const fixture = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'settings', 'settings-0.8.1.json'), 'utf8')) as {
  classic: Saved
  newLook: Saved
  prefs: Saved
}

let dir: string
let lib: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwrite-settings-carry-'))
  lib = join(dir, 'library')
  process.env.AIWRITE_DATA_DIR = dir
  for (const k of ['AIWRITE_LOOK', 'AIWRITE_THEME', 'AIWRITE_ARRANGEMENT', 'AIWRITE_TOUR', 'AIWRITE_DESK_READY']) delete process.env[k]
  vi.resetModules()
})

afterEach(() => {
  delete process.env.AIWRITE_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

/** The fixture's values with this test's library folder in place of the one it was saved with. */
const here = <T>(v: T): T => JSON.parse(JSON.stringify(v).split('<LIBRARY>').join(JSON.stringify(lib).slice(1, -1))) as T

/**
 * Settings that are new since 0.8.1, with the value a 0.8.1 file reads as: they are added, never in place of an old
 * value. classicNote: the one-time note that Classic is retired (shown only to someone who was on Classic).
 */
const NEW_SINCE_081 = (look: string): Record<string, unknown> => ({ classicNote: look === 'classic' })

/** Settings as read now, without the ones new since 0.8.1 (checked on their own). */
function withoutNew<T extends Record<string, unknown>>(v: T, look: string): T {
  const out = { ...v }
  for (const [k, want] of Object.entries(NEW_SINCE_081(look))) {
    expect(out[k]).toEqual(want)
    delete out[k]
  }
  return out
}

function store(saved: Saved): void {
  mkdirSync(join(dir, 'app'), { recursive: true })
  writeFileSync(join(dir, 'app', 'settings.json'), JSON.stringify(here(saved.raw), null, 2))
  mkdirSync(lib, { recursive: true })
  writeFileSync(join(lib, 'writing-preferences.json'), JSON.stringify(fixture.prefs.raw, null, 2))
}

describe('settings saved by AI Write 0.8.1', () => {
  it('on the New look: every value reads as 0.8.1 read it', async () => {
    store(fixture.newLook)
    const { getSettings, getWritingPrefs } = await import('../../src/main/settings')
    expect(withoutNew(getSettings() as unknown as Record<string, unknown>, 'new')).toEqual(here(fixture.newLook.read))
    expect(getWritingPrefs()).toEqual(fixture.prefs.read)
  })

  it('on the Classic look: every other value is kept, whatever the look becomes', async () => {
    store(fixture.classic)
    const { getSettings } = await import('../../src/main/settings')
    const { look, ...rest } = withoutNew(getSettings() as unknown as Record<string, unknown>, 'classic')
    const { look: was, ...restWas } = here(fixture.classic.read)
    expect(was).toBe('classic')
    // Classic is retired (2026-10-19): it becomes the New look on update, with a one-time note; every other value stays.
    expect(look).toBe('new')
    expect(rest).toEqual(restWas)
  })

  it('every value in the saved file is still there after a change is saved', async () => {
    store(fixture.newLook)
    const { getSettings, updateSettings } = await import('../../src/main/settings')
    updateSettings({ editor: { fontSize: 22 } })
    const onDisk = JSON.parse(readFileSync(join(dir, 'app', 'settings.json'), 'utf8')) as Record<string, unknown>
    const want = here(fixture.newLook.read) as Record<string, unknown>
    expect(withoutNew(onDisk, 'new')).toEqual({ ...want, editor: { ...(want.editor as object), fontSize: 22 } })
    expect(getSettings().editor.fontSize).toBe(22)
  })

  it('Automatic AI reads the saved switches and changes none of them', async () => {
    store(fixture.classic)
    const { getSettings } = await import('../../src/main/settings')
    const s = getSettings()
    for (const k of AUTOMATIC_AI_KEYS) expect(s[k], k).toBe(fixture.classic.read[k])
    // planFirst, contracts, brief, new words, after a draft and second opinions off; done and the critic on: no level.
    expect(automaticAiLevel(s)).toBe('custom')
  })

  it('a settings file from before any of the switches existed reads as Full, as the app behaved then', async () => {
    store({ raw: { libraryPath: '<LIBRARY>', theme: 'light' }, read: {} })
    const { getSettings } = await import('../../src/main/settings')
    expect(automaticAiLevel(getSettings())).toBe('full')
    expect(getSettings().theme).toBe('light')
  })
})
