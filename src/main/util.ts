import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

export const newId = (): string => randomUUID()
export const now = (): string => new Date().toISOString()

/** An error whose message is safe to show to Adam as-is. */
export class UserError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message)
  }
}

/** Writes a file atomically (write to temp, then rename), so a crash never leaves half a file. */
export function writeFileAtomic(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, data, 'utf8')
  renameSync(tmp, path)
}

export function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Names Windows reserves for devices: a folder called "Con" or "Nul" can't be opened, synced or copied. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i

/** A safe folder name for a world on Windows, macOS and cloud-sync folders. Keeps letters in any language. */
export function slugify(name: string): string {
  let s = name
    .normalize('NFKC')
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, '') // drops punctuation and characters Windows forbids; keeps é, Æ, ø, Мир, 日本
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .replace(/\s+$/, '') // Windows and OneDrive reject a name ending in a space
  if (WINDOWS_RESERVED.test(s)) s += ' world'
  return s || 'World'
}
