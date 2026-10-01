// Automatic world backups. OWNED BY THE BACKUPS/PACKAGING WORKER: replace these stubs.
// Spec: backup on launch and every 30 minutes while something changed; keep the last 20
// plus one a day for 30 days; a Backups screen restores any one, saving the current state first;
// a backup is taken before any database layout change.
import type Database from 'better-sqlite3'
import type { BackupInfo } from '@shared/types'
import { UserError } from '../util'

export function backupBeforeMigration(_folder: string, _db: Database.Database): void {
  // TODO(backups worker)
}

export function listBackups(): BackupInfo[] {
  return []
}

export function backupNow(): BackupInfo {
  throw new UserError('Backups are not ready yet.')
}

export function restoreBackup(_id: string): never {
  throw new UserError('Backups are not ready yet.')
}

/** Called once at startup to hook into world open/close. */
export function initBackups(): void {}
