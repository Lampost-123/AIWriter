// The writer model's reading limit (Adam, 2026-10-15): a model on DeepSeek's own API whose list didn't say how much it
// reads gets the limit DeepSeek publishes, on opening and after each change, never the 16,000-token guess.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwrite-settings-'))
  process.env.AIWRITE_DATA_DIR = dir
  vi.resetModules()
})

afterEach(() => {
  delete process.env.AIWRITE_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

const choice = (modelId: string, contextLength: number | null) => ({
  providerId: 'ds',
  modelId,
  label: modelId,
  contextLength,
  promptPrice: null,
  completionPrice: null
})

function store(models: Record<string, unknown>): void {
  mkdirSync(join(dir, 'app'), { recursive: true })
  writeFileSync(
    join(dir, 'app', 'settings.json'),
    JSON.stringify({ providers: [{ id: 'ds', name: 'DeepSeek', kind: 'custom', baseUrl: 'https://api.deepseek.com/v1', hasKey: true }], models })
  )
}

describe('reading limits in settings', () => {
  it('fills in the limit DeepSeek publishes when the stored choice has none, and keeps one Adam typed', async () => {
    store({ writer: choice('deepseek-flash', null), memory: choice('deepseek-flash', 48_000) })
    const { getSettings } = await import('./settings')
    expect(getSettings().models.writer?.contextLength).toBe(1_000_000)
    expect(getSettings().models.memory?.contextLength).toBe(48_000)
  })

  it('fills it in again when a change clears it', async () => {
    store({ writer: choice('deepseek-chat', 32_000) })
    const { getSettings, updateSettings } = await import('./settings')
    expect(getSettings().models.writer?.contextLength).toBe(32_000)
    const after = updateSettings({ models: { writer: { contextLength: null } } } as never)
    expect(after.models.writer?.contextLength).toBe(64_000)
    expect(getSettings().models.writer?.contextLength).toBe(64_000)
  })
})

// Classic was retired (Adam, 2026-10-19): settings that still keep it are moved to the New look, every other setting
// kept, with one note saying so; nothing can choose Classic again.
describe('Classic retired', () => {
  const keep = (settings: Record<string, unknown>): void => {
    mkdirSync(join(dir, 'app'), { recursive: true })
    writeFileSync(join(dir, 'app', 'settings.json'), JSON.stringify(settings))
  }
  const ON_CLASSIC = { look: 'classic', theme: 'sepia', accent: 'teal', arrangement: 'panels', editor: { fontSize: 21 }, layout: { binderOpen: true, inspectorOpen: true } }

  beforeEach(() => {
    delete process.env.AIWRITE_LOOK
  })

  it('moves someone on Classic to the New look, keeping every other setting, and tells them once', async () => {
    keep(ON_CLASSIC)
    const { getSettings, updateSettings } = await import('./settings')
    const s = getSettings()
    expect(s).toMatchObject({ look: 'new', classicNote: true, lookNote: false, arrangementNote: false, theme: 'sepia', accent: 'teal', arrangement: 'panels' })
    expect(s.editor.fontSize).toBe(21)
    expect(s.layout).toMatchObject({ binderOpen: true, inspectorOpen: true })
    // Put away: kept on the New look, never told again.
    updateSettings({ classicNote: false })
    vi.resetModules()
    const again = (await import('./settings')).getSettings()
    expect(again).toMatchObject({ look: 'new', classicNote: false, theme: 'sepia', arrangement: 'panels' })
  })

  it('keeps telling them until the note is put away, even after other settings are saved', async () => {
    keep(ON_CLASSIC)
    const first = await import('./settings')
    first.getSettings()
    first.updateSettings({ editor: { fontSize: 22 } })
    vi.resetModules()
    expect((await import('./settings')).getSettings()).toMatchObject({ look: 'new', classicNote: true, editor: { fontSize: 22 } })
  })

  it('never chooses Classic again, and app tests start with no note', async () => {
    keep(ON_CLASSIC)
    process.env.AIWRITE_LOOK = 'new'
    const { getSettings, updateSettings } = await import('./settings')
    expect(getSettings()).toMatchObject({ look: 'new', classicNote: false })
    expect(updateSettings({ look: 'classic' }).look).toBe('new')
    delete process.env.AIWRITE_LOOK
  })

  it('tells someone from before the New look about it, and a fresh install nothing', async () => {
    keep({ theme: 'light' })
    expect((await import('./settings')).getSettings()).toMatchObject({ look: 'new', lookNote: true, classicNote: false })
    rmSync(join(dir, 'app', 'settings.json'))
    vi.resetModules()
    expect((await import('./settings')).getSettings()).toMatchObject({ look: 'new', lookNote: false, classicNote: false })
  })
})
