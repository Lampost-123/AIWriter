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
