// Adapted from mcreader-v2, src/server/speech/cache.ts (reading aloud's own text-to-speech code; Adam's rule,
// 2 October 2026).
//
// Spoken clips on disk, so a passage heard once plays again at once and isn't spoken twice. It is a cache in the
// app's user data folder: never in a world folder or a backup. Files are named only by the hash of what was asked
// for (`keyOf`), under `<first two hex>/<hash>.wav`, so no path ever comes from a request. Past the limit Adam
// picks, the clips played longest ago go first. A clip that can't be deleted (in use, on Windows) is left for next
// time.
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AudioCacheStats } from '@shared/contracts/readAloud'
import { UserError } from '../util'

export const GB = 1024 ** 3

/** One clip kept: its size, and when it was last played. */
interface Kept {
  bytes: number
  used: number
}

export class AudioCache {
  private index: Map<string, Kept> | null = null
  private total = 0
  private loading: Promise<void> | null = null
  /** Pruning and clearing, one at a time, so no clip's size is taken off the total twice. */
  private removing: Promise<unknown> = Promise.resolve()

  constructor(
    readonly dir: string,
    private limitBytes: () => number
  ) {}

  /** The key for one clip: everything that changes how it sounds, hashed. */
  static keyOf(parts: unknown): string {
    return createHash('sha256').update(stableJson(parts)).digest('hex')
  }

  private fileOf(key: string): string {
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('Bad audio cache key')
    return path.join(this.dir, key.slice(0, 2), `${key}.wav`)
  }

  private async load(): Promise<Map<string, Kept>> {
    if (this.index) return this.index
    this.loading ??= (async () => {
      const index = new Map<string, Kept>()
      let total = 0
      const shards = await fs.readdir(this.dir).catch(() => [] as string[])
      for (const shard of shards) {
        if (!/^[0-9a-f]{2}$/.test(shard)) continue
        const names = await fs.readdir(path.join(this.dir, shard)).catch(() => [] as string[])
        for (const name of names) {
          const match = name.match(/^([0-9a-f]{64})\.wav$/)
          if (!match) continue
          const stat = await fs.stat(path.join(this.dir, shard, name)).catch(() => null)
          if (!stat) continue
          index.set(match[1]!, { bytes: stat.size, used: stat.mtimeMs })
          total += stat.size
        }
      }
      this.index = index
      this.total = total
    })().finally(() => {
      this.loading = null
    })
    await this.loading
    return this.index!
  }

  async get(key: string): Promise<Buffer | null> {
    const index = await this.load()
    const entry = index.get(key)
    if (!entry) return null
    const file = this.fileOf(key)
    const audio = await fs.readFile(file).catch(() => null)
    if (!audio) {
      this.forget(key, entry)
      return null
    }
    // Played again: the newest use keeps it longest. The file's time records it across restarts.
    entry.used = Date.now()
    const now = new Date()
    await fs.utimes(file, now, now).catch(() => undefined)
    return audio
  }

  async put(key: string, audio: Buffer): Promise<void> {
    const index = await this.load()
    const file = this.fileOf(key)
    await fs.mkdir(path.dirname(file), { recursive: true })
    // Written beside it and renamed, so a half-written clip is never served.
    const temp = `${file}.${randomUUID()}.tmp`
    await fs.writeFile(temp, audio)
    await fs.rename(temp, file)
    const previous = index.get(key)
    if (previous) this.total -= previous.bytes
    index.set(key, { bytes: audio.length, used: Date.now() })
    this.total += audio.length
    await this.prune()
  }

  /** Takes a clip out of the index, unless that was done already (or a newer copy has taken its place). */
  private forget(key: string, entry: Kept): void {
    if (this.index?.get(key) !== entry) return
    this.index.delete(key)
    this.total -= entry.bytes
  }

  /** Deletes one clip's file; false when it can't be deleted now (in use, on Windows). */
  private async remove(key: string): Promise<boolean> {
    try {
      await fs.rm(this.fileOf(key), { force: true })
      return true
    } catch (e) {
      console.warn('[read aloud] could not delete a saved clip', e)
      return false
    }
  }

  private oneAtATime<T>(job: () => Promise<T>): Promise<T> {
    const run = this.removing.then(job, job)
    this.removing = run.catch(() => undefined)
    return run
  }

  /** Removes the clips played longest ago until the total is under the limit. */
  prune(): Promise<number> {
    return this.oneAtATime(async () => {
      const index = await this.load()
      const limit = this.limitBytes()
      if (this.total <= limit) return 0
      const oldest = [...index].sort((a, b) => a[1].used - b[1].used)
      let removed = 0
      for (const [key, entry] of oldest) {
        if (this.total <= limit) break
        // Gone already, or kept again since: left as it is.
        if (index.get(key) !== entry || !(await this.remove(key))) continue
        this.forget(key, entry)
        removed++
      }
      return removed
    })
  }

  async stats(): Promise<AudioCacheStats> {
    const index = await this.load()
    return { files: index.size, bytes: this.total, limitBytes: this.limitBytes() }
  }

  /**
   * Deletes every clip. Only the cache's own shard folders are touched. A clip in use (on Windows) stays, and a
   * plain-words error says so once the rest are gone.
   */
  clear(): Promise<void> {
    return this.oneAtATime(async () => {
      const index = await this.load()
      let stuck = 0
      for (const [key, entry] of [...index]) {
        if (await this.remove(key)) this.forget(key, entry)
        else stuck++
      }
      // Anything else in the shard folders (a clip half written when the app closed), then the folders once empty.
      const shards = await fs.readdir(this.dir).catch(() => [] as string[])
      for (const shard of shards) {
        if (!/^[0-9a-f]{2}$/.test(shard)) continue
        const folder = path.join(this.dir, shard)
        for (const name of await fs.readdir(folder).catch(() => [] as string[])) {
          if (index.has(name.replace(/\.wav$/, ''))) continue
          await fs.rm(path.join(folder, name), { recursive: true, force: true }).catch(() => undefined)
        }
        await fs.rmdir(folder).catch(() => undefined)
      }
      if (stuck) throw new UserError("Some saved audio is in use and couldn't be cleared. Try again in a moment.")
    })
  }
}

/** JSON with object keys sorted, so equal requests always hash the same. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}
