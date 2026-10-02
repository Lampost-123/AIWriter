// Adapted from mcreader-v2, src/server/speech/cache.ts (reading aloud's own text-to-speech code; Adam's rule,
// 2 October 2026).
//
// Spoken clips on disk, so a passage heard once plays again at once and isn't spoken twice. It is a cache in the
// app's user data folder: never in a world folder or a backup. Files are named only by the hash of what was asked
// for (`keyOf`), under `<first two hex>/<hash>.wav`, so no path ever comes from a request. Past the limit Adam
// picks, the clips played longest ago go first.
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AudioCacheStats } from '@shared/contracts/readAloud'

export const GB = 1024 ** 3

export class AudioCache {
  private index: Map<string, { bytes: number; used: number }> | null = null
  private total = 0
  private loading: Promise<void> | null = null

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

  private async load(): Promise<Map<string, { bytes: number; used: number }>> {
    if (this.index) return this.index
    this.loading ??= (async () => {
      const index = new Map<string, { bytes: number; used: number }>()
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
      index.delete(key)
      this.total -= entry.bytes
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

  /** Removes the clips played longest ago until the total is under the limit. */
  async prune(): Promise<number> {
    const index = await this.load()
    const limit = this.limitBytes()
    if (this.total <= limit) return 0
    const oldest = [...index].sort((a, b) => a[1].used - b[1].used)
    let removed = 0
    for (const [key, entry] of oldest) {
      if (this.total <= limit) break
      await fs.rm(this.fileOf(key), { force: true })
      index.delete(key)
      this.total -= entry.bytes
      removed++
    }
    return removed
  }

  async stats(): Promise<AudioCacheStats> {
    const index = await this.load()
    return { files: index.size, bytes: this.total, limitBytes: this.limitBytes() }
  }

  /** Deletes every clip. Only the cache's own shard folders are touched. */
  async clear(): Promise<void> {
    const index = await this.load()
    const shards = await fs.readdir(this.dir).catch(() => [] as string[])
    for (const shard of shards) {
      if (/^[0-9a-f]{2}$/.test(shard)) await fs.rm(path.join(this.dir, shard), { recursive: true, force: true })
    }
    index.clear()
    this.total = 0
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
