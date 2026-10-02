import { beforeEach, describe, expect, it, vi } from 'vitest'

// Settings, API keys, writing preferences and recovery files are written whole (temp file, then
// rename). On Windows antivirus or OneDrive often holds a just-written file for a moment: the
// rename is tried again, a failure leaves no temp file behind, and the message is in plain words.
const calls = vi.hoisted(() => ({ sync: 0, async: 0, failFirst: 0, code: 'EPERM' }))

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    renameSync: (from: string, to: string) => {
      calls.sync++
      if (calls.sync <= calls.failFirst) throw Object.assign(new Error(`${calls.code}: operation not permitted, rename`), { code: calls.code })
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
      if (calls.async <= calls.failFirst) throw Object.assign(new Error(`${calls.code}: operation not permitted, rename`), { code: calls.code })
      return real.rename(from, to)
    }
  }
})

const { UserError, writeFileAtomic, writeFileAtomicAsync } = await import('../../src/main/util')
const { mkdtempSync, readdirSync, readFileSync, writeFileSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwrite-atomic-'))
  Object.assign(calls, { sync: 0, async: 0, failFirst: 0, code: 'EPERM' })
})

describe('writing a small file whole', () => {
  it('writes it, and makes missing folders', async () => {
    const file = join(dir, 'a', 'settings.json')
    writeFileAtomic(file, '{"theme":"dark"}')
    expect(readFileSync(file, 'utf8')).toBe('{"theme":"dark"}')
    await writeFileAtomicAsync(join(dir, 'b', 'r.json'), 'x')
    expect(readFileSync(join(dir, 'b', 'r.json'), 'utf8')).toBe('x')
    expect(readdirSync(join(dir, 'a'))).toEqual(['settings.json'])
  })

  it('waits for a file another program holds for a moment', async () => {
    const file = join(dir, 'keys.json')
    writeFileSync(file, 'old')
    calls.failFirst = 2
    writeFileAtomic(file, 'new')
    expect(calls.sync).toBe(3)
    expect(readFileSync(file, 'utf8')).toBe('new')
    expect(readdirSync(dir)).toEqual(['keys.json'])

    calls.code = 'EBUSY'
    await writeFileAtomicAsync(file, 'newer')
    expect(calls.async).toBe(3)
    expect(readFileSync(file, 'utf8')).toBe('newer')
    expect(readdirSync(dir)).toEqual(['keys.json'])
  })

  it('gives up in plain words, keeps the old file and leaves no temp file behind', async () => {
    const file = join(dir, 'writing-preferences.json')
    writeFileSync(file, 'old')
    calls.failFirst = 1000
    let err: unknown
    try {
      writeFileAtomic(file, 'new')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(UserError)
    expect((err as InstanceType<typeof UserError>).code).toBe('file-locked')
    expect((err as Error).message).toMatch(/another program \(often OneDrive or antivirus\) is using the file/)
    expect((err as Error).message).not.toMatch(/EPERM|tmp/)
    expect(readFileSync(file, 'utf8')).toBe('old')
    expect(readdirSync(dir)).toEqual(['writing-preferences.json'])

    await expect(writeFileAtomicAsync(file, 'new')).rejects.toBeInstanceOf(UserError)
    expect(readFileSync(file, 'utf8')).toBe('old')
    expect(readdirSync(dir)).toEqual(['writing-preferences.json'])
  })

  it('passes other problems through untouched, and still tidies up', () => {
    calls.failFirst = 1
    calls.code = 'ENOENT'
    expect(() => writeFileAtomic(join(dir, 'x.json'), 'x')).toThrow(/ENOENT/)
    expect(calls.sync).toBe(1)
    expect(readdirSync(dir)).toEqual([])
  })
})
