import { beforeEach, describe, expect, it, vi } from 'vitest'

// On Windows, antivirus or a cloud sync app often holds a just-written file for a moment.
// Renames are retried while the file is locked, and fail at once for anything else.
const calls = vi.hoisted(() => ({ sync: 0, async: 0, failFirst: 0, code: 'EPERM' }))

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    renameSync: (from: string, to: string) => {
      calls.sync++
      if (calls.sync <= calls.failFirst) throw Object.assign(new Error(`${calls.code}: rename`), { code: calls.code })
      return real.renameSync(from, to)
    }
  }
})
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    rename: async (from: string, to: string) => {
      calls.async++
      if (calls.async <= calls.failFirst) throw Object.assign(new Error(`${calls.code}: rename`), { code: calls.code })
      return real.rename(from, to)
    }
  }
})

const { renameRetry, renameRetrySync } = await import('../../src/main/services/backupFiles')
const { existsSync, mkdtempSync, writeFileSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwrite-rename-'))
  writeFileSync(join(dir, 'a'), 'x')
  Object.assign(calls, { sync: 0, async: 0, failFirst: 0, code: 'EPERM' })
})

describe('renaming a file another program briefly holds', () => {
  it('succeeds once the lock is released', async () => {
    calls.failFirst = 3
    renameRetrySync(join(dir, 'a'), join(dir, 'b'), 8, 1)
    expect(calls.sync).toBe(4)
    expect(existsSync(join(dir, 'b'))).toBe(true)

    calls.code = 'EBUSY'
    await renameRetry(join(dir, 'b'), join(dir, 'c'), 8, 1)
    expect(calls.async).toBe(4)
    expect(existsSync(join(dir, 'c'))).toBe(true)
  })

  it('gives up after a few tries, and at once for errors that are not a lock', async () => {
    calls.failFirst = 100
    expect(() => renameRetrySync(join(dir, 'a'), join(dir, 'b'), 3, 1)).toThrow(/EPERM/)
    expect(calls.sync).toBe(3)
    await expect(renameRetry(join(dir, 'a'), join(dir, 'b'), 3, 1)).rejects.toThrow(/EPERM/)
    expect(calls.async).toBe(3)

    Object.assign(calls, { sync: 0, async: 0, failFirst: 0 })
    expect(() => renameRetrySync(join(dir, 'missing'), join(dir, 'b'))).toThrow(/ENOENT/)
    expect(calls.sync).toBe(1)
    await expect(renameRetry(join(dir, 'missing'), join(dir, 'b'))).rejects.toThrow(/ENOENT/)
    expect(calls.async).toBe(1)
  })
})
