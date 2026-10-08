// Automatic world backups.
// Spec: back up each world when it opens and every 30 minutes while something changed; keep the
// last 20 plus one a day for 30 days; restore any one, saving the current state first; back up
// before any database layout change; optionally copy every backup to a second folder.
// Backups hold world.db only. API keys live in the app's own data folder, never in a world.
import { BrowserWindow, dialog } from 'electron'
import { copyFileSync, rmSync } from 'node:fs'
import { copyFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import Database from 'better-sqlite3'
import type { BackupFolderStatus, BackupInfo, BackupPreview, World, WorldCounts } from '@shared/types'
import * as repo from '../db/repo'
import { purgeTrash } from '../db/trash'
import { emit } from '../events'
import { getSettings, updateSettings } from '../settings'
import { now, renameRetrySync, UserError } from '../util'
import { currentWorld, maybeCurrentWorld, onWorldOpened, openWorld, reopenCurrent, worldDbPath, type OpenWorld } from '../world'
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
/** Where a backup being restored is staged, next to world.db. */
const stagedPath = (worldFolder: string): string => `${worldDbPath(worldFolder)}.restoring`
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
    try {
      pruneBackups(folder)
    } catch {
      /* tidy-up only: the backup itself is made */
    }
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
  try {
    removeStalePartials(backupsFolder(w.folder))
    // Left over if the app closed in the middle of a restore (the world itself is intact).
    rmSync(stagedPath(w.folder), { force: true })
    rmSync(`${worldDbPath(w.folder)}.putback`, { force: true })
  } catch {
    /* tidy-up only */
  }
  if (launched.has(w.id)) return
  launched.add(w.id)
  // Just after opening, so the first paint isn't kept waiting.
  setTimeout(() => {
    if (!isOpen(w)) {
      launched.delete(w.id) // closed before we got to it: back it up next time it opens
      return
    }
    guarded('launch', () => {
      const newest = listBackupFiles(backupsFolder(w.folder))[0]
      if (!changedSinceLastBackup(w, newest)) return
      takeBackup(w, 'launch').catch(quiet('launch'))
    })
  }, LAUNCH_DELAY_MS)
}

/** Timer callbacks must never throw: in the main process that would show a crash box. */
function guarded(what: string, fn: () => void): void {
  try {
    fn()
  } catch (e) {
    quiet(what)(e)
  }
}

function onTimer(): void {
  const w = maybeCurrentWorld()
  if (!w || !isOpen(w)) return
  guarded('timer', () => {
    const newest = listBackupFiles(backupsFolder(w.folder))[0]
    if (newest) {
      const age = Date.now() - Date.parse(newest.createdAt)
      if (age >= 0 && age < TIMER_EVERY_MS) return
    }
    if (!changedSinceLastBackup(w, newest)) return
    takeBackup(w, 'timer').catch(quiet('timer'))
  })
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

/** A world's backups, newest first, with a plain message if the folder can't be read. */
function backupsOf(w: OpenWorld): BackupFile[] {
  try {
    return listBackupFiles(backupsFolder(w.folder))
  } catch (e) {
    console.warn('Could not list backups:', e instanceof Error ? e.message : e)
    throw new UserError("Couldn't read this world's backups folder. Check it hasn't been moved or renamed, then try again.")
  }
}

export function listBackups(): BackupInfo[] {
  const w = maybeCurrentWorld()
  if (!w) return []
  return backupsOf(w).map((b) => toInfo(w.id, b))
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
  const target = backupsOf(w).find((b) => b.id === id)
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
  const staged = stagedPath(w.folder)
  try {
    await copyFile(target.file, staged)
  } catch (e) {
    rmSync(staged, { force: true })
    console.warn('Could not stage the backup:', e instanceof Error ? e.message : e)
    throw new UserError("Couldn't read that backup, so nothing was restored. Check there's free space on your disk, then try again.")
  }

  let safety: BackupInfo
  try {
    safety = await takeBackup(w, 'before-restore')
  } catch (e) {
    rmSync(staged, { force: true })
    if (e instanceof UserError) throw e
    throw new UserError("Couldn't save a copy of your current work first, so nothing was restored. Check there's free space on your disk, then try again.")
  }
  if (!isOpen(w)) {
    rmSync(staged, { force: true })
    throw new UserError('The world was closed before the backup could be restored. Open it again, then try once more.')
  }

  // From here on everything is synchronous, so nothing else can use the world while its file is
  // swapped. The database is closed directly (not with closeWorld) so that reopenCurrent() opens
  // this exact folder again: a copy of the world elsewhere in the library has the same id.
  let swapped = false
  try {
    try {
      w.db.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      /* closing checkpoints anyway */
    }
    w.db.close()
    rmSync(`${dbFile}-wal`, { force: true })
    rmSync(`${dbFile}-shm`, { force: true })
    renameRetrySync(staged, dbFile)
    swapped = true
    return reopenCurrent()
  } catch (e) {
    console.warn('Restore failed, putting the current work back:', e instanceof Error ? e.message : e)
    rmSync(staged, { force: true })
    if (swapped) {
      // world.db now holds a backup that wouldn't open: put the copy made just now back, whole.
      const putBack = `${dbFile}.putback`
      try {
        copyFileSync(safety.file, putBack)
        rmSync(`${dbFile}-wal`, { force: true })
        rmSync(`${dbFile}-shm`, { force: true })
        renameRetrySync(putBack, dbFile)
      } catch (e2) {
        rmSync(putBack, { force: true })
        console.warn('Could not put the current work back:', e2 instanceof Error ? e2.message : e2)
      }
    }
    if (!reopenAfterFailedRestore(w)) {
      throw new UserError(
        "AI Write couldn't reopen this world. Close AI Write and open it again. Your work from just before the restore is kept as a backup."
      )
    }
    throw new UserError(
      swapped
        ? 'That backup could not be opened, so your world was left as it was.'
        : "Another program is using this world's file (often a cloud sync app or antivirus), so nothing was restored. Wait a moment, then try again."
    )
  }
}

/** Opens the world again after a restore went wrong. True when it is open. */
function reopenAfterFailedRestore(w: OpenWorld): boolean {
  const open = maybeCurrentWorld()
  if (open && open.db.open) return true
  try {
    if (open) reopenCurrent()
    else openWorld(w.id)
  } catch (e) {
    console.warn('Could not reopen the world after a failed restore:', e instanceof Error ? e.message : e)
  }
  return !!maybeCurrentWorld()?.db.open
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

/**
 * True when the folder is there. Asynchronous on purpose: a folder on a network drive that has
 * gone offline can take many seconds to answer, and the window must never freeze meanwhile.
 */
async function folderExists(folder: string): Promise<boolean> {
  try {
    return (await stat(folder)).isDirectory()
  } catch {
    return false
  }
}

async function copyToExtraFolder(worldFolder: string, b: BackupFile): Promise<void> {
  const root = getSettings().backup?.extraFolder
  if (!root) return
  try {
    // Never create the chosen folder itself: if it's missing, its drive or cloud folder is offline.
    if (!(await folderExists(root))) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
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
  let newest: BackupFile | undefined
  try {
    newest = w ? listBackupFiles(backupsFolder(w.folder))[0] : undefined
  } catch {
    /* the next backup is copied anyway */
  }
  if (w && newest) await copyToExtraFolder(w.folder, newest)
  return folder
}

export function clearBackupFolder(): void {
  updateSettings({ backup: { extraFolder: null } })
  extra = { ok: true, message: null, lastCopyAt: null }
}

export async function getBackupFolderStatus(): Promise<BackupFolderStatus> {
  const folder = getSettings().backup?.extraFolder ?? null
  if (!folder) return { folder: null, ok: true, message: null, lastCopyAt: null }
  if (!(await folderExists(folder))) return { folder, ok: false, message: MISSING_FOLDER, lastCopyAt: extra.lastCopyAt }
  // The drive or cloud folder is back: the next backup is copied there again.
  if (!extra.ok && extra.message === MISSING_FOLDER) return { folder, ok: true, message: null, lastCopyAt: extra.lastCopyAt }
  return { folder, ...extra }
}

// ---------- Previewing a backup ----------

/** What a world's database holds (nothing in Recently deleted). Null when it can't be read. */
export function countWorld(db: Database.Database): WorldCounts | null {
  try {
    const one = (sql: string): number => (db.prepare(sql).get() as { n: number | null }).n ?? 0
    const storyList = db
      .prepare(
        `SELECT st.title AS title, coalesce(sum(CASE WHEN c.id IS NOT NULL THEN s.word_count END), 0) AS words
         FROM stories st
         LEFT JOIN chapters c ON c.story_id = st.id AND c.deleted_at IS NULL
         LEFT JOIN scenes s ON s.chapter_id = c.id AND s.deleted_at IS NULL
         WHERE st.deleted_at IS NULL
         GROUP BY st.id ORDER BY st.position, st.rowid`
      )
      .all() as { title: string; words: number }[]
    return {
      stories: storyList.length,
      chapters: one(
        'SELECT count(*) AS n FROM chapters c JOIN stories st ON st.id = c.story_id WHERE c.deleted_at IS NULL AND st.deleted_at IS NULL'
      ),
      scenes: one(
        `SELECT count(*) AS n FROM scenes s JOIN chapters c ON c.id = s.chapter_id JOIN stories st ON st.id = c.story_id
         WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL AND st.deleted_at IS NULL`
      ),
      words: storyList.reduce((a, s) => a + s.words, 0),
      entries: one('SELECT count(*) AS n FROM entries WHERE deleted_at IS NULL'),
      storyList: storyList.map((s) => ({ title: s.title?.trim() || 'Untitled story', words: s.words }))
    }
  } catch (e) {
    console.warn('Could not count a world for a backup preview:', e instanceof Error ? e.message : e)
    return null
  }
}

/** What a backup of the open world holds, beside the world as it is now. Read only. */
export function previewBackup(id: string): BackupPreview {
  const w = currentWorld()
  const target = backupsOf(w).find((b) => b.id === id)
  if (!target) throw new UserError('That backup could not be found. It may have been tidied away; pick another one from the list.')
  let d: Database.Database | null = null
  let backup: WorldCounts | null = null
  try {
    d = new Database(target.file, { readonly: true, fileMustExist: true })
    backup = countWorld(d)
  } catch (e) {
    console.warn('Could not open a backup to preview it:', e instanceof Error ? e.message : e)
  } finally {
    try {
      d?.close()
    } catch {
      /* a read-only handle */
    }
  }
  return { backup, now: countWorld(w.db) }
}
