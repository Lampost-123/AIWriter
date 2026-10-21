// A provider's key belongs to the address it was pasted for (review #1). A made-up data folder and key.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const dir = mkdtempSync(join(tmpdir(), 'aiwrite-providers-'))
let providers: typeof import('./providers')

beforeAll(async () => {
  process.env.AIWRITE_DATA_DIR = dir
  providers = await import('./providers')
})

afterAll(() => {
  delete process.env.AIWRITE_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe('saving a provider', () => {
  it('keeps the key while the address stays, and forgets it when the address changes', () => {
    const made = providers.saveProvider({ kind: 'custom', name: 'Mine', baseUrl: 'https://api.example.com/v1', apiKey: 'made-up-key' })
    expect(made.hasKey).toBe(true)
    expect(providers.saveProvider({ id: made.id, kind: 'custom', name: 'Renamed', baseUrl: 'https://api.example.com/v1' }).hasKey).toBe(true)
    const moved = providers.saveProvider({ id: made.id, kind: 'custom', name: 'Renamed', baseUrl: 'https://elsewhere.example/v1' })
    expect(moved.hasKey).toBe(false)
    expect(providers.providerTarget(moved).apiKey).toBeNull()
  })

  it('keeps a key given with the new address', () => {
    const made = providers.saveProvider({ kind: 'custom', name: 'Two', baseUrl: 'https://api.example.com/v1', apiKey: 'first' })
    const moved = providers.saveProvider({ id: made.id, kind: 'custom', name: 'Two', baseUrl: 'https://other.example/v1', apiKey: 'second' })
    expect(providers.providerTarget(moved).apiKey).toBe('second')
  })
})
