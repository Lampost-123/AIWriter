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

export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 60)
  return s || 'World'
}
