import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

export const newId = (): string => randomUUID()
let lastNow = 0
let lastClock = 0
/**
 * The time now. Two calls never give the same instant: each is at least a millisecond after the
 * last, running a little ahead of the clock through a burst of saves, until the clock itself is set
 * back by more than a second. A scene's or entry's `updated_at` tells caches it changed, so two saves
 * in one millisecond must still look different, and what's made later must never sort first.
 */
export const now = (): string => {
  const t = Date.now()
  lastNow = t > lastNow || t < lastClock - 1000 ? t : lastNow + 1
  lastClock = t
  return new Date(lastNow).toISOString()
}

/** An error whose message is safe to show to Adam as-is. */
export class UserError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message)
  }
}

// On Windows a file that was just written is often held open for a moment by antivirus or a
// cloud sync app (OneDrive, Dropbox), and renaming it fails with EPERM/EBUSY/EACCES. Try again
// briefly before giving up.
const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_TRIES = 8
const RENAME_WAIT_MS = 125
export const isLocked = (e: unknown): boolean => LOCKED.has((e as { code?: string })?.code ?? '')

/** renameSync, retried for up to about a second while the file is locked by another program. */
export function renameRetrySync(from: string, to: string, tries = RENAME_TRIES, waitMs = RENAME_WAIT_MS): void {
  for (let i = 1; ; i++) {
    try {
      renameSync(from, to)
      return
    } catch (e) {
      if (i >= tries || !isLocked(e)) throw e
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs)
    }
  }
}

/** The same without blocking: used for files written while Adam works. */
export async function renameRetry(from: string, to: string, tries = RENAME_TRIES, waitMs = RENAME_WAIT_MS): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await rename(from, to)
      return
    } catch (e) {
      if (i >= tries || !isLocked(e)) throw e
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }
}

let tmpSeq = 0
/** A temp name next to the file, never shared by two writes in flight. */
const tmpFor = (path: string): string => `${path}.${process.pid}.${++tmpSeq}.tmp`

/** What Adam reads when a small file (settings, keys, preferences) can't be saved. Other errors pass through. */
function plainSaveError(e: unknown): unknown {
  if (isLocked(e)) {
    return new UserError("Couldn't save this because another program (often OneDrive or antivirus) is using the file. Try again in a moment.", 'file-locked')
  }
  if ((e as { code?: string })?.code === 'ENOSPC') {
    return new UserError("Couldn't save this because the disk is full. Free up some space, then try again.", 'disk-full')
  }
  return e
}

/**
 * Writes a file atomically (write to temp, flush to disk, then rename), so a crash or power cut
 * never leaves half a file. A rename blocked for a moment by another program is tried again,
 * and a failed write leaves no temp file behind.
 */
export function writeFileAtomic(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = tmpFor(path)
  try {
    const fd = openSync(tmp, 'w')
    try {
      writeFileSync(fd, data, 'utf8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameRetrySync(tmp, path)
  } catch (e) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* already gone, or locked too: nothing more to do */
    }
    throw plainSaveError(e)
  }
}

/** The same without blocking the app while a locked file is waited for. */
export async function writeFileAtomicAsync(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = tmpFor(path)
  try {
    const fh = await open(tmp, 'w')
    try {
      await fh.writeFile(data, 'utf8')
      await fh.sync()
    } finally {
      await fh.close()
    }
    await renameRetry(tmp, path)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw plainSaveError(e)
  }
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
