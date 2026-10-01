// Automatic world backups.
// Spec: back up each world when it opens and every 30 minutes while something changed; keep the
// last 20 plus one a day for 30 days; restore any one, saving the current state first; back up
// before any database layout change; optionally copy every backup to a second folder.
// Backups hold world.db only. API keys live in the app's own data folder, never in a world.
import type Database from 'better-sqlite3'
import { BrowserWindow, dialog } from 'electron'
import { copyFileSync, existsSync, renameSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { BackupFolderStatus, BackupInfo, World } from '@shared/types'
import * as repo from '../db/repo'
import { purgeTrash } from '../db/trash'
import { emit } from '../events'
import { getSettings, updateSettings } from '../settings'
import { now, UserError } from '../util'
import { closeWorld, currentWorld, maybeCurrentWorld, onWorldOpened, openWorld, worldDbPath, type OpenWorld } from '../world'
import {
  checkBackupFile,
  copyBackupTo,
  isSameOrInside,
  listBackupFiles,
  pruneBackups,
  removeStalePartials,
  writeBackup,
  writeBackupSync,
  type BackupFile,
  type BackupReason
} from './backupFiles'

const TIMER_EVERY_MS = 30 * 60 * 1000
const TIMER_CHECK_MS = 60 * 1000
const LAUNCH_DELAY_MS = 800
const TRASH_DAYS = 30

const backupsFolder = (worldFolder: string): string => join(worldFolder, 'backups')
const toInfo = (worldId: string, b: BackupFile): BackupInfo => ({
  id: b.id,
  worldId,
  file: b.file,
  createdAt: b.createdAt,
  sizeBytes: b.sizeBytes,
  reason: b.reason
})

// ---------- Making backups ----------

/** Backups run one at a time, in order. */
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

const isOpen = (w: OpenWorld): boolean => maybeCurrentWorld()?.db === w.db && w.db.open

function takeBackup(w: OpenWorld, reason: BackupReason): Promise<BackupInfo> {
  return serial(async () => {
    if (!isOpen(w)) throw new UserError('The world was closed before it could be backed up.')
    const folder = backupsFolder(w.folder)
    const b = await writeBackup(w.db, folder, reason)
    pruneBackups(folder)
    const info = toInfo(w.id, b)
    emit('backup:done', info)
    // Not awaited: a slow cloud folder never holds up the next backup.
    void copyToExtraFolder(w.folder, b)
    return info
  })
}

/** True when the world has changed since its newest backup (or has none). */
function changedSinceLastBackup(w: OpenWorld, newest: BackupFile | undefined): boolean {
  if (!newest) return true
  const updatedAt = repo.getMeta(w.db, 'updated_at') ?? ''
  return updatedAt > newest.createdAt
}

const quiet = (what: string) => (e: unknown) => {
  if (e instanceof UserError) return
  console.warn(`Backup (${what}) failed:`, e instanceof Error ? e.message : e)
}

/** Worlds that already had their launch backup in this run of the app. */
const launched = new Set<string>()

function onOpened(w: OpenWorld): void {
  try {
    purgeTrash(w.db, TRASH_DAYS)
  } catch (e) {
    console.warn('Could not empty old items from the trash:', e instanceof Error ? e.message : e)
  }
  removeStalePartials(backupsFolder(w.folder))
  if (launched.has(w.id)) return
  launched.add(w.id)
  // Just after opening, so the first paint isn't kept waiting.
  setTimeout(() => {
    if (!isOpen(w)) {
      launched.delete(w.id) // closed before we got to it: back it up next time it opens
      return
    }
    const newest = listBackupFiles(backupsFolder(w.folder))[0]
    if (!changedSinceLastBackup(w, newest)) return
    takeBackup(w, 'launch').catch(quiet('launch'))
  }, LAUNCH_DELAY_MS)
}

function onTimer(): void {
  const w = maybeCurrentWorld()
  if (!w) return
  const newest = listBackupFiles(backupsFolder(w.folder))[0]
  if (newest) {
    const age = Date.now() - Date.parse(newest.createdAt)
    if (age >= 0 && age < TIMER_EVERY_MS) return
  }
  if (!changedSinceLastBackup(w, newest)) return
  takeBackup(w, 'timer').catch(quiet('timer'))
}

/** Called once at startup to hook into world open/close. */
export function initBackups(): void {
  onWorldOpened(onOpened)
  setInterval(onTimer, TIMER_CHECK_MS).unref()
}

/**
 * Called just before migrations change an existing world's database layout. Synchronous:
 * nothing else is using the database yet. If the copy can't be made, the world isn't changed.
 */
export function backupBeforeMigration(folder: string, db: Database.Database): void {
  let b: BackupFile
  try {
    b = writeBackupSync(db, backupsFolder(folder), 'before-migration')
  } catch (e) {
    console.warn('Backup before update failed:', e instanceof Error ? e.message : e)
    db.close()
    throw new UserError(
      "AI Write couldn't make a safety copy of this world before updating it, so it was left unchanged. Check there's free space on your disk, then open it again."
    )
  }
  try {
    pruneBackups(backupsFolder(folder))
  } catch {
    /* tidy-up only */
  }
  void copyToExtraFolder(folder, b)
}

// ---------- The Backups screen ----------

export function listBackups(): BackupInfo[] {
  const w = maybeCurrentWorld()
  if (!w) return []
  return listBackupFiles(backupsFolder(w.folder)).map((b) => toInfo(w.id, b))
}

export async function backupNow(): Promise<BackupInfo> {
  const w = currentWorld()
  try {
    return await takeBackup(w, 'manual')
  } catch (e) {
    if (e instanceof UserError) throw e
    console.warn('Manual backup failed:', e instanceof Error ? e.message : e)
    throw new UserError("Couldn't make a backup. Check there's free space on your disk, then try again.")
  }
}

/** Restores a backup of the open world, backing up the current state first. */
export async function restoreBackup(id: string): Promise<World> {
  const w = currentWorld()
  const folder = backupsFolder(w.folder)
  const target = listBackupFiles(folder).find((b) => b.id === id)
  if (!target) throw new UserError('That backup could not be found. It may have been tidied away; pick another one from the list.')
  const check = checkBackupFile(target.file, w.id)
  if (!check.ok) {
    throw new UserError(
      check.problem === 'other-world'
        ? "That backup is of a different world, so it can't be restored here."
        : "That backup is damaged and can't be restored. Pick an earlier one."
    )
  }

  // Stage a copy first: tidying up after the safety backup must not remove the one being restored.
  const dbFile = worldDbPath(w.folder)
  const staged = `${dbFile}.restoring`
  copyFileSync(target.file, staged)

  let safety: BackupInfo
  try {
    safety = await takeBackup(w, 'before-restore')
  } catch (e) {
    rmSync(staged, { force: true })
    if (e instanceof UserError) throw e
    throw new UserError("Couldn't save a copy of your current work first, so nothing was restored. Check there's free space on your disk, then try again.")
  }

  const swapIn = (source: string, move: boolean): World => {
    closeWorld()
    rmSync(`${dbFile}-wal`, { force: true })
    rmSync(`${dbFile}-shm`, { force: true })
    if (move) renameSync(source, dbFile)
    else copyFileSync(source, dbFile)
    return openWorld(w.id)
  }

  try {
    return swapIn(staged, true)
  } catch (e) {
    console.warn('Restore failed, putting the current work back:', e instanceof Error ? e.message : e)
    rmSync(staged, { force: true })
    try {
      swapIn(safety.file, false)
    } catch {
      /* the safety backup is still listed on the Backups screen */
    }
    throw new UserError('That backup could not be opened, so your world was left as it was.')
  }
}

// ---------- The second backup folder ----------

let extra: { ok: boolean; message: string | null; lastCopyAt: string | null } = { ok: true, message: null, lastCopyAt: null }

const MISSING_FOLDER =
  "Your second backup folder can't be found. If it's on a USB drive or in Dropbox, OneDrive or iCloud, check that's connected, or choose another folder."

function describeCopyError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? ''
  if (code === 'ENOENT') return MISSING_FOLDER
  if (code === 'ENOSPC') return 'Your second backup folder is full. Free up some space there, or choose another folder.'
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return "AI Write isn't allowed to save in your second backup folder. Choose another folder."
  return "Couldn't copy the latest backup to your second backup folder. Check the folder is still there, or choose another."
}

async function copyToExtraFolder(worldFolder: string, b: BackupFile): Promise<void> {
  const root = getSettings().backup?.extraFolder
  if (!root) return
  try {
    // Never create the chosen folder itself: if it's missing, its drive or cloud folder is offline.
    if (!existsSync(root)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    const dest = join(root, basename(worldFolder))
    await copyBackupTo(b, dest)
    pruneBackups(dest)
    extra = { ok: true, message: null, lastCopyAt: now() }
  } catch (e) {
    extra = { ok: false, message: describeCopyError(e), lastCopyAt: extra.lastCopyAt }
  }
}

export async function chooseBackupFolder(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow()
  const opts: Electron.OpenDialogOptions = {
    title: 'Choose a second backup folder',
    buttonLabel: 'Use this folder',
    properties: ['openDirectory', 'createDirectory']
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  const folder = res.canceled ? null : (res.filePaths[0] ?? null)
  if (!folder) return null
  if (isSameOrInside(folder, getSettings().libraryPath)) {
    throw new UserError(
      'Pick a folder outside your AI Write library, so the copies are kept apart from your worlds. A Dropbox, OneDrive or iCloud folder works well.'
    )
  }
  updateSettings({ backup: { extraFolder: folder } })
  extra = { ok: true, message: null, lastCopyAt: null }
  // Copy the open world's newest backup straight away, so the folder is useful at once.
  const w = maybeCurrentWorld()
  const newest = w ? listBackupFiles(backupsFolder(w.folder))[0] : undefined
  if (w && newest) await copyToExtraFolder(w.folder, newest)
  return folder
}

export function clearBackupFolder(): void {
  updateSettings({ backup: { extraFolder: null } })
  extra = { ok: true, message: null, lastCopyAt: null }
}

export function getBackupFolderStatus(): BackupFolderStatus {
  const folder = getSettings().backup?.extraFolder ?? null
  if (!folder) return { folder: null, ok: true, message: null, lastCopyAt: null }
  if (!existsSync(folder)) return { folder, ok: false, message: MISSING_FOLDER, lastCopyAt: extra.lastCopyAt }
  return { folder, ...extra }
}
